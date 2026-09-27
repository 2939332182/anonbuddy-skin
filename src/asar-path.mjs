// 定位 WorkBuddy 的 app.asar 路径（供诊断脚本共用）
//
// 为什么需要：这类脚本原本硬编码 "E:\workbuudy\WorkBuddyAI\resources\app.asar"，
// 换台电脑 / 别人 clone 后就全跑不了。这里统一按"工作区相对路径 + 常见安装位置"找。
//
// 优先级：
//   1. WORKBUDDY_ASAR 环境变量
//   2. 工作区同级的 workbuudy/WorkBuddyAI/resources/app.asar 等常见布局
//   3. 常见安装位置（LOCALAPPDATA / ProgramFiles / ProgramData）
//   4. 从正在运行的 WorkBuddy 进程反推（Windows）

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXE_NAMES = ["WorkBuddy.exe", "WorkBuddyAI.exe"];

function candidates() {
  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };

  push(process.env.WORKBUDDY_ASAR);

  // 工作区与上级目录的常见布局（便携版 / 开发 checkout）
  const parents = [REPO_ROOT, dirname(REPO_ROOT)];
  for (const parent of parents) {
    for (const app of ["workbuudy/WorkBuddyAI", "WorkBuddyAI", "WorkBuddy"]) {
      for (const exe of EXE_NAMES) {
        push(join(parent, app, "resources", "app.asar"));
        push(join(parent, app, exe, "resources", "app.asar"));
      }
    }
  }

  // 常见安装位置
  const env = process.env;
  const roots = [
    env.LOCALAPPDATA,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramData,
    join(homedir(), "AppData", "Local"),
  ].filter(Boolean);
  const subs = [
    "workbuddy", "WorkBuddy", "Programs/workbuddy", "Programs/WorkBuddy",
    "WorkBuddyAI", "workbuudy/WorkBuddyAI",
  ];
  for (const r of roots) {
    for (const s of subs) push(join(r, s, "resources", "app.asar"));
  }

  return out;
}

/** @returns {string|null} app.asar 的绝对路径，找不到返回 null */
export function findAsar() {
  for (const c of candidates()) {
    try {
      if (c && existsSync(c)) return c;
    } catch {
      /* 无权限等情况直接跳过 */
    }
  }
  // 最后兜底：从可执行文件位置反推安装目录（覆盖任意安装路径）
  const exe = findExe();
  if (exe) {
    const derived = join(dirname(exe), "resources", "app.asar");
    try {
      if (existsSync(derived)) return derived;
    } catch {
      /* skip */
    }
  }
  return null;
}

/** 从注册表卸载项解析安装位置（仅 Windows）。
 *  取值顺序与 scripts/workbuddy-path.ps1 对齐：DisplayIcon 最准，其次是 InstallLocation。
 *  换台机器 / 换盘重装后环境变量与硬编码候选都会失效，只有这里跟得住真实安装位置。 */
export function exeFromRegistry() {
  if (process.platform !== "win32") return null;
  const script = [
    "$keys = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',",
    "  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',",
    "  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')",
    "Get-ChildItem $keys -ErrorAction SilentlyContinue | ForEach-Object {",
    "  $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue",
    "  if ($p -and $p.DisplayName -like '*WorkBuddy*') {",
    "    foreach ($v in @($p.DisplayIcon, $p.InstallLocation, $p.UninstallString)) {",
    "      if ($v) { ($v.Trim('\"') -split ',')[0] }",
    "    }",
    "  }",
    "}",
  ].join("\n");
  let raw;
  try {
    raw = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 12000, windowsHide: true },
    );
  } catch {
    return null; // 注册表查不到就交给后面的进程反推
  }
  for (const line of raw.split(/\r?\n/)) {
    const value = line.trim().replace(/^"|"$/g, "");
    if (!value) continue;
    if (/\.exe$/i.test(value)) {
      try {
        if (existsSync(value)) return value;
      } catch {
        /* skip */
      }
      continue;
    }
    for (const name of EXE_NAMES) {
      const candidate = join(value, name);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

/** 找 WorkBuddy 可执行文件（用于反推安装目录） */
export function findExe() {
  const out = [];
  const push = (p) => p && !out.includes(p) && out.push(p);
  push(process.env.WORKBUDDY_EXE);

  const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  const subs = ["workbuddy", "WorkBuddy", "Programs/workbuddy", "Programs/WorkBuddy", "WorkBuddyAI", "workbuudy/WorkBuddyAI"];
  for (const r of roots) {
    for (const s of subs) for (const n of EXE_NAMES) push(join(r, s, n));
  }
  for (const c of out) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* skip */
    }
  }
  // 注册表兜底（仅 Windows）：换盘重装后 WORKBUDDY_EXE 与上面的硬编码候选都会失效，
  // 只有卸载项跟着真实安装位置走，所以这条比环境变量可靠。
  const fromRegistry = exeFromRegistry();
  if (fromRegistry) return fromRegistry;
  // 从正在运行的进程反推（仅 Windows，失败就算了）
  if (process.platform === "win32") {
    try {
      const ps = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='WorkBuddy.exe' or Name='WorkBuddyAI.exe'\" | Select-Object -First 1 -ExpandProperty ExecutablePath",
        ],
        { encoding: "utf8", timeout: 8000 },
      ).trim();
      if (ps && existsSync(ps)) return ps;
    } catch {
      /* 进程没跑或没有权限 */
    }
  }
  return null;
}

/** 拿到 asar 路径，拿不到就抛出带排查提示的错误 */
export function requireAsar(usage) {
  const asar = findAsar();
  if (asar) return asar;
  const hint = [
    "找不到 WorkBuddy 的 app.asar。",
    "请设置环境变量 WORKBUDDY_ASAR 指向它，例如：",
    '  PowerShell:  $env:WORKBUDDY_ASAR = "C:\\path\\to\\WorkBuddyAI\\resources\\app.asar"',
    '  bash:        export WORKBUDDY_ASAR="/c/path/to/WorkBuddyAI/resources/app.asar"',
    "",
    "已尝试过的位置：",
    ...candidates().map((c) => "  " + c),
  ].join("\n");
  const err = new Error(hint);
  if (usage) err.usage = usage;
  throw err;
}

/** 列出 asar 同目录下的资源（排查用） */
export function asarSiblings(asar) {
  try {
    return readdirSync(dirname(asar)).slice(0, 20);
  } catch {
    return [];
  }
}
