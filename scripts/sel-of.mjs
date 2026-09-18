// 列出 app.asar 里某个 CSS 片段（通常是变量或声明值）的所有使用者选择器。
// 排查"哪个容器用了这个原生变量/底色"时非常好用，比逐个 grep 上下文可靠。
// 用法：node scripts/sel-of.mjs "var(--wb-bg-content)"
import { readFileSync } from "node:fs";
import { requireAsar } from "../src/asar-path.mjs";

const ASAR = requireAsar('node scripts/sel-of.mjs "var(--wb-bg-content)"');
const needle = process.argv[2];
if (!needle) {
  console.error("用法：node scripts/sel-of.mjs <CSS 片段>");
  process.exit(1);
}

// 按 latin1 读，1 字节 = 1 字符，偏移量好算；取出来再按 utf8 解码，中文才不乱
const hay = readFileSync(ASAR).toString("latin1");
const n = Buffer.from(needle, "utf8").toString("latin1");
const seen = new Map();
let from = 0;
let total = 0;
while (true) {
  const at = hay.indexOf(n, from);
  if (at === -1) break;
  from = at + n.length;
  total += 1;
  // 往前找最近的 "{"，再往前取该规则的整段选择器
  const open = hay.lastIndexOf("{", at);
  if (open === -1) continue;
  const prevClose = hay.lastIndexOf("}", open);
  const sel = Buffer.from(hay.slice(prevClose + 1, open), "latin1").toString("utf8").replace(/\s+/g, " ").trim();
  if (!sel || sel.length > 240) continue;
  seen.set(sel, (seen.get(sel) ?? 0) + 1);
}
console.log(`「${needle}」共 ${total} 处，识别出 ${seen.size} 条规则：`);
for (const [sel, count] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${sel}${count > 1 ? `  (x${count})` : ""}`);
}
