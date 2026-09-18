// 最终删除：C盘软隔离项 + D盘隔离区遗留，并统计释放空间
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/workbuddy-skin-studio/cleanup-audit';
const log = [];
const say = s => { console.log(s); log.push(s); };

say('=== 最终删除 C盘软隔离项 ===\n');
let freed = 0, ok = 0, fail = 0;

const targets = [
  'C:/Users/ZhuanZ/AppData/Local/Temp/josqnmwc.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/avm0d5wc.muo.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/b0yr1ikf.1aq.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/co52jesx.s50.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/eaecctzw.ehq.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/jffiuisc.gq2.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/rtl0nssq.t3w.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/uo14stnq.pxe.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/uvitnhze.34e.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/wqdaxces.qhq.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/2ugemsxr.wz2.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/nswB0EA.tmp.__to_delete__',
  'C:/Users/ZhuanZ/AppData/Local/Temp/s0drcmot.kcx.__to_delete__',
  'C:/DrvPath.__to_delete__',
  'C:/rgloader.__to_delete__',
  'C:/ComboKey.__to_delete__',
];

function dirSize(d, n = 0) {
  if (n > 30) return 0;
  let s = 0, es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return 0; }
  for (const e of es) { const f = path.join(d, e.name); try { if (e.isFile()) s += fs.statSync(f).size; else if (e.isDirectory()) s += dirSize(f, n + 1); } catch {} }
  return s;
}

for (const p of targets) {
  if (!fs.existsSync(p)) { say(`[跳过] 不存在 ${p}`); continue; }
  let sz = 0; try { sz = dirSize(p); } catch {}
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
    say(`[OK] 删除 ${(sz / 1048576).toFixed(1)} MB  ${p}`);
    ok++; freed += sz;
  } catch (e) {
    say(`[失败] ${p}  ->  ${e.code} ${e.message}`);
    fail++;
  }
}

// D盘隔离区（若还有残留）
const QDIR = `${OUT}/_quarantine`;
if (fs.existsSync(QDIR)) {
  let sz = 0; try { sz = dirSize(QDIR); } catch {}
  try { fs.rmSync(QDIR, { recursive: true, force: true, maxRetries: 3 }); say(`[OK] 删除隔离区 ${(sz / 1048576).toFixed(1)} MB`); freed += sz; }
  catch (e) { say(`[失败] 隔离区 -> ${e.message}`); }
}

say(`\n删除完成: 成功 ${ok} 项 / 失败 ${fail} 项，释放约 ${(freed / 1073741824).toFixed(2)} GB`);
fs.writeFileSync(`${OUT}/clean-log-final.txt`, log.join('\n'), 'utf8');
