// WorkBuddy 安装位置与运行时解析（Windows）
//
// 这是路径解析的唯一真源。这套逻辑原本有两份 —— PowerShell 的
// scripts/workbuddy-path.ps1 和 Node 的 src/asar-path.mjs —— 改一处还得想着另一处。
// 现在统一到这里；仅剩的 setup-autoskin.ps1（要操作 .lnk 的 COM 接口）通过
// `node src/platform/workbuddy-path.mjs --json` 取结果，不再自己实现一份。
//
// 解析顺序：
//   1. 调用方显式指定 / WORKBUDDY_EXE —— 换盘、绿色版、多版本并存的兜底
//   2. 常见安装位置 —— 覆盖绝大多数机器，不用起子进程
//   3. 注册表卸载项 —— 换盘重装后只有这里跟得住（DisplayIcon 指向真实路径）
//
// 不做「从运行中进程反推」：WorkBuddy 带图灵盾保护，实测 ExecutablePath 读不出来
// （tasklist 也不给路径），留着只会白起一个子进程。

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXE_NAMES = ["WorkBuddy.exe", "WorkBuddyAI.exe"];

// 国内版 9334 / 国际版 9333，与各自 product.json 的默认端口对齐
const PORT_BY_LEAF = { workbuddy: 9334, workbuddyai: 9333 };

/** 静默执行，失败一律返回 null（注册表 key 不存在、权限不足都很常见） */
function tryExec(file, args, timeout = 15000) {
  try {
    return execFileSync(file, args, { encoding: "utf8", timeout, windowsHide: true });
  } catch {
    return null;
  }
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

/**
 * 常见安装位置。
 * workbuudy（拼写错误）是历史兼容：老版本确实装过那个目录名。
 */
function wellKnownPaths(env) {
  const out = [];
  const bases = [env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramData].filter(Boolean);
  const subs = [
    "workbuddy",
    "WorkBuddy",
    "Programs\\workbuddy",
    "Programs\\WorkBuddy",
    "WorkBuddyAI",
    "workbuudy\\WorkBuddyAI",
  ];
  for (const base of bases) {
    for (const sub of subs) {
      for (const name of EXE_NAMES) pushUnique(out, join(base, sub, name));
    }
  }
  return out;
}

/**
 * 注册表卸载项。三种值的形状都不一样：
 *   DisplayIcon     = D:\Apps\WorkBuddyAI\WorkBuddyAI.exe,0      （exe + 图标序号）
 *   InstallLocation = D:\Apps\WorkBuddyAI                        （目录）
 *   UninstallString = "D:\...\Uninstall WorkBuddy.exe" /currentuser（卸载器 + 参数）
 * 统一成「取所在目录 + 拼主程序名」。绝不能把 UninstallString 里的 exe 直接当候选 ——
 * 那是卸载程序，拿它启动会弹出卸载向导。
 */
function registryPaths() {
  const keys = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  ];
  const out = [];
  for (const key of keys) {
    const raw = tryExec("reg.exe", ["query", key, "/s", "/f", "WorkBuddy", "/d"]);
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/([A-Za-z]:\\[^"\r\n]*?)(?:,0)?\s*$/);
      if (!m) continue;
      let value = m[1].trim().replace(/^"|"$/g, "");
      if (/\.exe$/i.test(value)) value = value.slice(0, value.lastIndexOf("\\"));
      if (!value) continue;
      for (const name of EXE_NAMES) pushUnique(out, join(value, name));
    }
  }
  return out;
}

/** 全部候选，按信任度排序 */
export function workbuddyCandidates({ extra = "", env = process.env } = {}) {
  const out = [];
  pushUnique(out, extra);
  pushUnique(out, env.WORKBUDDY_EXE);
  for (const p of wellKnownPaths(env)) pushUnique(out, p);
  for (const p of registryPaths()) pushUnique(out, p);
  return out;
}

/**
 * 第一个真实存在的主程序。
 * prefer: "cn" | "intl" —— 两个版本都装着时用它挑，挑不到就退回通用顺序（软偏好）。
 */
export function findWorkBuddyExe({ extra = "", prefer = "", env = process.env } = {}) {
  const candidates = workbuddyCandidates({ extra, env });
  if (prefer) {
    const want = (prefer === "cn" ? "WorkBuddy.exe" : "WorkBuddyAI.exe").toLowerCase();
    const hit = candidates.find((p) => basename(p).toLowerCase() === want && existsSync(p));
    if (hit) return hit;
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** 由 exe 名推端口，两个版本各走各的 */
export function portForExe(exePath) {
  return PORT_BY_LEAF[basename(exePath, ".exe").toLowerCase()] ?? 9333;
}

export function processNameFor(exePath) {
  return basename(exePath, ".exe");
}

/** WorkBuddy 自带的 Node：国际版 ~/.workbuddy-ai，国内版 ~/.workbuddy */
export function findNode({ env = process.env } = {}) {
  const which = tryExec(process.platform === "win32" ? "where.exe" : "which", ["node"], 8000);
  if (which) {
    const first = which.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  }
  for (const base of [".workbuddy-ai", ".workbuddy"]) {
    const root = join(env.USERPROFILE || homedir(), base, "binaries", "node", "versions");
    if (!existsSync(root)) continue;
    const versions = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const exe = join(root, version, "node.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

// 直接执行时当个小 CLI 用，给还留在 PowerShell 的 setup-autoskin.ps1 取路径
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (isMain) {
  const preferAt = process.argv.indexOf("--prefer");
  const prefer = preferAt >= 0 ? process.argv[preferAt + 1] : "";
  const exe = findWorkBuddyExe({ prefer });
  const node = findNode();
  const result = {
    exe,
    node,
    port: exe ? portForExe(exe) : null,
    process: exe ? processNameFor(exe) : null,
  };
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`WorkBuddy.exe: ${exe ?? "(未找到)"}\n`);
    process.stdout.write(`node:          ${node ?? "(未找到)"}\n`);
  }
  if (!exe) process.exitCode = 1;
}
