// 给 WorkBuddy 快捷方式补上 CDP 调试参数（二进制补丁，带备份与回读校验）
//
// 为什么需要：WorkBuddy 重装或自动更新时会**重建快捷方式**，把
// `--remote-debugging-port=9333` 丢掉。没有这个参数，注入式换肤连不上 renderer，
// 监控脚本就只能去"杀掉再带参数重启"——那条路需要管理员权限，经常失败。
//
// 用法：
//   node scripts/patch-lnk.mjs                 # 自动发现所有 WorkBuddy 快捷方式
//   node scripts/patch-lnk.mjs "C:\...\x.lnk"  # 只处理指定文件
//
// 实现要点：只改 STRING_DATA 里的 Arguments 段。MS-SHLLINK 要求字符串段顺序为
// Name -> RelativePath -> WorkingDir -> Arguments -> IconLocation，所以新段必须插在
// IconLocation 之前；LinkTargetIDList / LinkInfo 一律不动，**目标路径不会被改写**。
// 若快捷方式原本已有别的参数，则在其后追加，不覆盖。

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ARG = "--remote-debugging-port=9333";
const PORT = Number(ARG.split("=")[1]);

const STRING_FIELDS = [
  [0x4, "NAME"],
  [0x8, "RELATIVE_PATH"],
  [0x10, "WORKING_DIR"],
  [0x20, "ARGS"],
  [0x40, "ICON_LOCATION"],
];

function parse(buf) {
  const headerSize = buf.readUInt32LE(0);
  const flags = buf.readUInt32LE(20);
  let off = headerSize;
  if (flags & 0x1) off += 2 + buf.readUInt16LE(off); // LinkTargetIDList
  let localBasePath = null;
  if (flags & 0x2) {
    const liSize = buf.readUInt32LE(off);
    const liFlags = buf.readUInt32LE(off + 8);
    const localOffset = buf.readUInt32LE(off + 16);
    if (liFlags & 0x1) {
      const base = off + localOffset;
      const end = buf.indexOf(0, base);
      localBasePath = buf.toString("latin1", base, end);
    }
    off += liSize;
  }
  const uni = (flags & 0x80) !== 0;
  const fields = {};
  for (const [bit, label] of STRING_FIELDS) {
    if (!(flags & bit)) continue;
    const len = buf.readUInt16LE(off);
    const bytes = len * (uni ? 2 : 1);
    fields[label] = {
      pos: off,
      size: 2 + bytes,
      value: buf.toString(uni ? "utf16le" : "latin1", off + 2, off + 2 + bytes),
    };
    off += 2 + bytes;
  }
  return { flags, uni, fields, stringDataEnd: off, localBasePath };
}

function block(str, uni) {
  const b = Buffer.alloc(2 + str.length * (uni ? 2 : 1));
  b.writeUInt16LE(str.length, 0);
  b.write(str, 2, uni ? "utf16le" : "latin1");
  return b;
}

// 自动发现：只扫用户自己的桌面与开始菜单（含公共位置），不需要管理员权限。
// 环境变量在部分 shell（如 Git Bash 里 spawn 的 node）可能缺失，所以一律带回退推导。
function findShortcuts() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const sysDrive = (process.env.SystemDrive || (process.env.SystemRoot || "C:\\").slice(0, 2)) + "\\";
  const appData = process.env.APPDATA || (home && join(home, "AppData", "Roaming"));
  const publicDir = process.env.PUBLIC || (home && join(home, "..", "Public"));
  const programData = process.env.ProgramData || join(sysDrive, "ProgramData");

  const roots = [];
  const add = (p) => {
    if (p && existsSync(p)) roots.push(p);
  };
  add(home && join(home, "Desktop"));
  add(publicDir && join(publicDir, "Desktop"));
  add(appData && join(appData, "Microsoft", "Windows", "Start Menu", "Programs"));
  add(join(programData, "Microsoft", "Windows", "Start Menu", "Programs"));

  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.toLowerCase().endsWith(".lnk") && /workbuddy/i.test(e.name)) out.push(p);
    }
  };
  for (const r of roots) walk(r, 0);
  return [...new Set(out)];
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const files = targets.length ? targets : findShortcuts();

if (!files.length) {
  console.log("没有找到任何 WorkBuddy 快捷方式。");
  console.log("  已搜索：桌面 / 公共桌面 / 用户与公共开始菜单");
  process.exitCode = 1;
}

for (const file of files) {
  if (!existsSync(file)) {
    console.log("MISSING  " + file);
    continue;
  }
  const buf = readFileSync(file);
  const info = parse(buf);
  console.log("=== " + file);
  console.log("  大小=" + buf.length + "  flags=0x" + info.flags.toString(16));
  console.log("  目标=" + (info.localBasePath ?? "(未记录 LinkInfo)"));

  if (info.localBasePath && !existsSync(info.localBasePath)) {
    console.log("  ⚠️ 目标文件不存在，快捷方式已断链 —— 需要重装或手动重建（本脚本不改目标路径）");
  }

  const args = info.fields.ARGS;
  const existing = args ? args.value : "";
  const m = existing.match(/--remote-debugging-port=(\d+)/);

  if (m && Number(m[1]) === PORT) {
    console.log("  已带 " + ARG + " -> 跳过");
    continue;
  }

  const nextArgs = existing.trim() ? `${existing.trim()} ${ARG}` : ARG;
  let out;
  if (args) {
    // 替换原 Arguments 段（等长或不等长都能处理，直接重排尾部）
    out = Buffer.concat([
      buf.subarray(0, args.pos),
      block(nextArgs, info.uni),
      buf.subarray(args.pos + args.size),
    ]);
  } else {
    const anchor = info.fields.ICON_LOCATION ? info.fields.ICON_LOCATION.pos : info.stringDataEnd;
    out = Buffer.concat([buf.subarray(0, anchor), block(nextArgs, info.uni), buf.subarray(anchor)]);
    out.writeUInt32LE(info.flags | 0x20, 20);
  }

  const bak = file + ".bak-autoskin";
  copyFileSync(file, bak);
  writeFileSync(file, out);

  const re = parse(readFileSync(file));
  const ok = re.fields.ARGS?.value.includes(ARG) && re.localBasePath === info.localBasePath;
  console.log("  补丁后：大小=" + out.length + "  ARGS=" + JSON.stringify(re.fields.ARGS?.value ?? null));
  console.log("  校验：" + (ok ? "PASS（参数已写入且目标路径未变）" : "FAIL —— 请用备份还原"));
  console.log("  备份=" + bak);
}
