// 在 app.asar 里搜字符串并打印上下文（WorkBuddy 是 file:// 页面，document.styleSheets 跨源不可读，
// 查原生样式只能直接翻 asar）。二进制文件，用 Node 按字节找，别用 grep。
// 用法：node scripts/asar-find.mjs <关键词> [前后字符数] [最多几条]
import { readFileSync } from "node:fs";
import { requireAsar } from "../src/asar-path.mjs";

const ASAR = requireAsar("node scripts/asar-find.mjs <关键词> [前后字符数] [最多几条]");
const [needle, padArg = "240", limitArg = "4"] = process.argv.slice(2);
if (!needle) {
  console.error("用法：node scripts/asar-find.mjs <关键词> [前后字符数] [最多几条]");
  process.exit(1);
}
const pad = Number(padArg);
const limit = Number(limitArg);

const buf = readFileSync(ASAR);
const hay = buf.toString("latin1");          // 1 字节 = 1 字符，偏移量好算
const needleLatin = Buffer.from(needle, "utf8").toString("latin1");

let from = 0;
let hits = 0;
while (hits < limit) {
  const at = hay.indexOf(needleLatin, from);
  if (at === -1) break;
  const start = Math.max(0, at - pad);
  const end = Math.min(hay.length, at + needleLatin.length + pad);
  const chunk = Buffer.from(hay.slice(start, end), "latin1").toString("utf8");
  console.log(`\n===== 命中 @${at}（±${pad} 字节）=====`);
  console.log(chunk.replace(/\u0000/g, "·"));
  from = at + needleLatin.length;
  hits += 1;
}
console.log(`\n共命中 ${hits} 处（上限 ${limit}）`);
