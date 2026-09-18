// 给 .lnk 快捷方式追加启动参数（二进制补丁，带备份与回读校验）
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

const ARG = "--remote-debugging-port=9333";
const FILES = [
  "C:/Users/Public/Desktop/WorkBuddy AI.lnk",
  "C:/ProgramData/Microsoft/Windows/Start Menu/Programs/WorkBuddy AI.lnk",
];

function parse(buf) {
  const headerSize = buf.readUInt32LE(0);
  const flags = buf.readUInt32LE(20);
  let off = headerSize;
  if (flags & 0x1) off += 2 + buf.readUInt16LE(off);
  if (flags & 0x2) off += buf.readUInt32LE(off);
  const uni = (flags & 0x80) !== 0;
  const positions = {};
  const values = {};
  const order = [[0x4, "NAME"], [0x8, "RELATIVE_PATH"], [0x10, "WORKING_DIR"], [0x20, "ARGS"], [0x40, "ICON_LOCATION"]];
  for (const [bit, label] of order) {
    if (flags & bit) {
      positions[label] = off;
      const len = buf.readUInt16LE(off);
      const bytes = len * (uni ? 2 : 1);
      values[label] = buf.toString(uni ? "utf16le" : "latin1", off + 2, off + 2 + bytes);
      off += 2 + bytes;
    }
  }
  return { headerSize, flags, positions, values };
}

for (const file of FILES) {
  if (!existsSync(file)) { console.log("MISSING  " + file); continue; }
  const buf = readFileSync(file);
  const info = parse(buf);
  console.log("=== " + file);
  console.log("  before: flags=0x" + info.flags.toString(16) + " size=" + buf.length);
  console.log("  anchor ICON_LOCATION@" + info.positions.ICON_LOCATION);

  if (info.flags & 0x20) {
    console.log("  already has ARGS=" + JSON.stringify(info.values.ARGS) + " -> skip");
    continue;
  }
  const insertAt = info.positions.ICON_LOCATION;
  if (insertAt === undefined) { console.log("  no ICON_LOCATION anchor -> skip"); continue; }

  const argBlock = Buffer.alloc(2 + ARG.length * 2);
  argBlock.writeUInt16LE(ARG.length, 0);
  argBlock.write(ARG, 2, "utf16le");

  const out = Buffer.concat([buf.subarray(0, insertAt), argBlock, buf.subarray(insertAt)]);
  out.writeUInt32LE(info.flags | 0x20, 20);

  const bak = file + ".bak-autoskin";
  copyFileSync(file, bak);
  writeFileSync(file, out);

  const re = parse(readFileSync(file));
  console.log("  after : flags=0x" + re.flags.toString(16) + " size=" + out.length);
  console.log("  verify ARGS=" + JSON.stringify(re.values.ARGS));
  console.log("  verify ICON=" + JSON.stringify(re.values.ICON_LOCATION));
  console.log("  backup=" + bak);
}
