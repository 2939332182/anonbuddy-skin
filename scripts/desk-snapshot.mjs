// 桌面快照 / 对比 —— 用来回答"跑完这个包，桌面上到底多了什么"。
//
// 用法：
//   node scripts/desk-snapshot.mjs show                       打印当前桌面条目
//   node scripts/desk-snapshot.mjs save  <快照文件>            存一份快照
//   node scripts/desk-snapshot.mjs diff  <快照文件>            和当前桌面比对
//
// 排查套路：跑包里的 .bat 之前 save 一份，跑完 diff 一下。
// 只读，不写桌面（自己的快照写到指定的临时文件里）。

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 桌面被重定向到别的盘时，%USERPROFILE%\Desktop 仍是指向真实位置的兼容视图，
// 所以从这里读就够了（本机实测 D:\UserData\Desktop 与它内容一致）。
const DESKTOP = join(homedir(), "Desktop");

function snapshot() {
  if (!existsSync(DESKTOP)) return {};
  const out = {};
  for (const name of readdirSync(DESKTOP)) {
    try {
      const s = statSync(join(DESKTOP, name));
      out[name] = `${s.isDirectory() ? "dir" : s.size}:${Math.round(s.mtimeMs)}`;
    } catch {
      out[name] = "unreadable";
    }
  }
  return out;
}

const [mode, file] = process.argv.slice(2);

if (mode === "save") {
  if (!file) throw new Error("save 需要一个快照文件路径");
  const snap = snapshot();
  writeFileSync(file, `${JSON.stringify(snap, null, 2)}\n`, "utf8");
  console.log(`已保存 ${Object.keys(snap).length} 项 -> ${file}`);
} else if (mode === "diff") {
  if (!file) throw new Error("diff 需要一个快照文件路径");
  const before = JSON.parse(readFileSync(file, "utf8"));
  const after = snapshot();
  const added = Object.keys(after).filter((k) => !(k in before));
  const removed = Object.keys(before).filter((k) => !(k in after));
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]);
  console.log(`桌面变化：新增 ${added.length} / 删除 ${removed.length} / 修改 ${changed.length}`);
  for (const k of added) console.log(`  + ${k}`);
  for (const k of removed) console.log(`  - ${k}`);
  for (const k of changed) console.log(`  ~ ${k}（内容或时间戳变了）`);
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log("  桌面没有任何变化。");
  }
} else {
  const snap = snapshot();
  for (const [name, meta] of Object.entries(snap)) console.log(`  ${name}  [${meta}]`);
  console.log(`共 ${Object.keys(snap).length} 项`);
}
