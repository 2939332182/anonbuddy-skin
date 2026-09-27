// C盘项目：同盘软隔离（重命名为 xxx.__to_delete__），确认后再删
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/anonbuddy-skin/cleanup-audit';
const MANIFEST = `${OUT}/delete-manifest.json`;
const items = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const log = [];
const say = s => { console.log(s); log.push(s); };

const SUFFIX = '.__to_delete__';
say('=== C盘同盘软隔离（重命名） ===\n');
let ok = 0, fail = 0, size = 0;
for (const it of items) {
  if (it.type === 'shell') continue;
  // 只处理 C 盘
  if (!/^C:/i.test(it.path)) continue;
  const src = it.path;
  if (!fs.existsSync(src)) { say(`[已不存在] ${src}`); continue; }
  const dst = src + SUFFIX;
  if (fs.existsSync(dst)) { say(`[已隔离过] ${dst}`); continue; }
  try {
    fs.renameSync(src, dst);
    say(`[OK] ${(it.size / 1048576).toFixed(1)} MB  ${src}  ->  +${SUFFIX}`);
    ok++; size += it.size;
  } catch (e) {
    say(`[失败] ${src}  ->  ${e.code} ${e.message}`);
    fail++;
  }
}
say(`\n完成: 成功 ${ok} 项 / 失败 ${fail} 项，共 ${(size / 1073741824).toFixed(2)} GB`);
fs.writeFileSync(`${OUT}/clean-log-c-soft.txt`, log.join('\n'), 'utf8');
