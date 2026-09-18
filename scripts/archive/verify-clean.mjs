// 清理后校验：隔离区核对 + 保留项确认 + 空间统计
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/workbuddy-skin-studio/cleanup-audit';
const QDIR = `${OUT}/_quarantine`;

function dirSize(d, n = 0) {
  if (n > 30) return { size: 0, count: 0 };
  let size = 0, count = 0, es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return { size: 0, count: 0 }; }
  for (const e of es) {
    const f = path.join(d, e.name);
    try { if (e.isFile()) { size += fs.statSync(f).size; count++; } else if (e.isDirectory()) { const r = dirSize(f, n + 1); size += r.size; count += r.count; } } catch {}
  }
  return { size, count };
}
const mb = n => (n / 1048576).toFixed(1);
const exists = p => fs.existsSync(p);

let rep = '===== 清理后校验报告 =====\n\n';

rep += '【1】隔离区内容（尚未彻底删除，确认后可清）\n';
if (exists(QDIR)) {
  const es = fs.readdirSync(QDIR, { withFileTypes: true });
  let tot = 0;
  for (const e of es) {
    const r = dirSize(path.join(QDIR, e.name));
    tot += r.size;
    rep += `  ${String(mb(r.size)).padStart(10)} MB  ${e.name}\n`;
  }
  rep += `  隔离区合计: ${mb(tot)} MB\n`;
} else rep += '  (无)\n';

rep += '\n【2】C盘软隔离项（.+.__to_delete__ 后缀，尚未删除）\n';
const cSoft = [
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
let cTot = 0;
for (const p of cSoft) {
  if (exists(p)) { const r = dirSize(p); cTot += r.size; rep += `  ✔ ${String(mb(r.size)).padStart(9)} MB  ${p}\n`; }
  else rep += `  ✗ 未找到(可能已删或未生成)  ${p}\n`;
}
rep += `  C盘软隔离合计: ${mb(cTot)} MB\n`;

rep += '\n【3】确认保留项仍存在（安全校验）\n';
const keep = [
  'C:/Users/ZhuanZ/AppData/Local/Temp/workbuddy-prompts',
  'D:/360Downloads/Microsoft VS Code',
  'D:/360Downloads/Free Download Manager',
  'D:/WeGameApps',
  'D:/qqnt',
  'D:/Pengu Loader',
  'D:/steam美化插件',
  'C:/Tangent',
  'D:/xwechat_files',
];
for (const p of keep) {
  rep += `  ${exists(p) ? '✔ 保留正常' : '⚠ 未找到'}  ${p}\n`;
}

rep += '\n【4】回收站当前体积\n';
for (const d of ['C:/$RECYCLE.BIN', 'D:/$RECYCLE.BIN']) {
  if (exists(d)) { const r = dirSize(d); rep += `  ${mb(r.size)} MB / ${r.count} 文件  ${d}\n`; }
  else rep += `  不存在  ${d}\n`;
}

// 原路径应已不存在
rep += '\n【5】原路径检查（应全部消失）\n';
for (const p of ['C:/Users/ZhuanZ/AppData/Local/Temp/josqnmwc', 'C:/DrvPath', 'C:/rgloader', 'C:/ComboKey', 'D:/5EDemocache']) {
  rep += `  ${exists(p) ? '⚠ 仍存在' : '✔ 已移走'}  ${p}\n`;
}

fs.writeFileSync(`${OUT}/清理校验报告.txt`, rep, 'utf8');
console.log(rep);
