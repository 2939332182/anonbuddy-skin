// 分析 Windows .lnk 结构（只读）
import { readFileSync } from "node:fs";

const file = process.argv[2];
const buf = readFileSync(file);
console.log("FILE=" + file);
console.log("SIZE=" + buf.length);

const headerSize = buf.readUInt32LE(0);
console.log("HEADER_SIZE=0x" + headerSize.toString(16));
const flags = buf.readUInt32LE(20);
console.log("LINK_FLAGS=0x" + flags.toString(16).padStart(8, "0"));
const names = [
  [0x00000001, "HasLinkTargetIDList"],
  [0x00000002, "HasLinkInfo"],
  [0x00000004, "HasName"],
  [0x00000008, "HasRelativePath"],
  [0x00000010, "HasWorkingDir"],
  [0x00000020, "HasArguments"],
  [0x00000040, "HasIconLocation"],
  [0x00000080, "IsUnicode"],
  [0x00000100, "ForceNoLinkInfo"],
  [0x00000200, "HasExpString"],
  [0x00001000, "HasExpIcon"],
  [0x00002000, "NoPidlAlias"],
];
for (const [bit, label] of names) {
  if (flags & bit) console.log("  FLAG " + label);
}
console.log("FILE_ATTRS=0x" + buf.readUInt32LE(24).toString(16));
console.log("ICON_INDEX=" + buf.readInt32LE(56));
console.log("SHOW_CMD=" + buf.readUInt32LE(60));

let off = headerSize;
if (flags & 0x00000001) {
  const idListSize = buf.readUInt16LE(off);
  console.log("IDLIST_SIZE=" + idListSize + " (at " + off + ")");
  off += 2 + idListSize;
}
if (flags & 0x00000002) {
  const liSize = buf.readUInt32LE(off);
  const liFlags = buf.readUInt32LE(off + 8);
  const volOffset = buf.readUInt32LE(off + 12);
  const localOffset = buf.readUInt32LE(off + 16);
  console.log("LINKINFO_SIZE=" + liSize + " flags=0x" + liFlags.toString(16) + " localBasePathOffset=" + localOffset);
  if (liFlags & 1) {
    const base = off + localOffset;
    const end = buf.indexOf(0, base);
    console.log("  LOCAL_BASE_PATH=" + buf.toString("latin1", base, end));
  }
  off += liSize;
}
console.log("STRINGDATA_START=" + off);
const readStr = (pos, unicode) => {
  const len = buf.readUInt16LE(pos);
  const bytes = len * (unicode ? 2 : 1);
  const s = buf.toString(unicode ? "utf16le" : "latin1", pos + 2, pos + 2 + bytes);
  return { s, next: pos + 2 + bytes };
};
const uni = (flags & 0x00000080) !== 0;
for (const [bit, label] of [[0x00000004, "NAME"], [0x00000008, "RELATIVE_PATH"], [0x00000010, "WORKING_DIR"], [0x00000020, "ARGS"], [0x00000040, "ICON_LOCATION"]]) {
  if (flags & bit) {
    const r = readStr(off, uni);
    console.log(label + "=" + JSON.stringify(r.s) + " (ends at " + r.next + ")");
    off = r.next;
  }
}
console.log("EXTRADATA_START=" + off + " (bytes left: " + (buf.length - off) + ")");
console.log("TAIL_HEX=" + buf.subarray(off, Math.min(off + 16, buf.length)).toString("hex"));
