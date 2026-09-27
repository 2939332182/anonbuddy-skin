// 清点用户选中的 8 项清理目标的完整内容
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/anonbuddy-skin/cleanup-audit';
fs.mkdirSync(OUT, { recursive: true });

function dirSize(d, n = 0) {
  if (n > 30) return { size: 0, count: 0 };
  let size = 0, count = 0, es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return { size: 0, count: 0 }; }
  for (const e of es) {
    const f = path.join(d, e.name);
    try {
      if (e.isFile()) { size += fs.statSync(f).size; count++; }
      else if (e.isDirectory()) { const r = dirSize(f, n + 1); size += r.size; count += r.count; }
    } catch {}
  }
  return { size, count };
}
const mb = n => +(n / 1048576).toFixed(2);
const fmt = ms => { try { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); } catch { return '?'; } };

let rep = '';
let grand = 0;
const sec = (t) => { rep += `\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}\n`; };

// ---------- 1. josqnmwc ----------
sec('【1】temp-josqnmwc  →  C:\\Users\\ZhuanZ\\AppData\\Local\\Temp\\josqnmwc');
{
  const p = 'C:/Users/ZhuanZ/AppData/Local/Temp/josqnmwc';
  if (fs.existsSync(p)) {
    const r = dirSize(p);
    grand += r.size;
    rep += `总大小: ${(r.size / 1048576).toFixed(1)} MB   文件数: ${r.count}\n\n`;
    const es = fs.readdirSync(p, { withFileTypes: true });
    rep += `顶层子目录 ${es.length} 个，明细：\n`;
    for (const e of es.slice(0, 60)) {
      const sz = dirSize(path.join(p, e.name));
      rep += `  ${String(mb(sz.size)).padStart(9)} MB  ${e.name}\n`;
    }
    if (es.length > 60) rep += `  ... 其余 ${es.length - 60} 项\n`;
  } else rep += '不存在\n';
}

// ---------- 2. Temp 其余 ----------
sec('【2】temp-others  →  Temp 目录里 VS 安装残留（排除正在使用的）');
{
  const tmp = 'C:/Users/ZhuanZ/AppData/Local/Temp';
  const KEEP = /^(workbuddy|dsh|VS$|Microsoft|vscode|npm|node|NuGet|clr-debug)/i;
  const es = fs.readdirSync(tmp, { withFileTypes: true });
  let rows = [];
  for (const e of es) {
    const f = path.join(tmp, e.name);
    let st; try { st = fs.statSync(f); } catch { continue; }
    const sz = e.isFile() ? st.size : dirSize(f).size;
    if (sz < 1024 * 1024) continue;           // < 1MB 忽略
    if (KEEP.test(e.name)) continue;          // 正在使用的跳过
    // VS 随机名目录特征：xxxx.xxx （6-8位小写\\.3位）或 odis_ / 纯随机
    const isVS = /^[a-z0-9]{6,8}\.[a-z0-9]{3}$/i.test(e.name) || /^odis_/i.test(e.name) || /\.tmp$/i.test(e.name);
    rows.push({ name: e.name, sz, mt: st.mtimeMs, isVS, isDir: e.isDirectory() });
  }
  rows.sort((a, b) => b.sz - a.sz);
  const total = rows.filter(r => r.isVS).reduce((s, r) => s + r.sz, 0);
  grand += total;
  rep += `合计（VS 残留类，建议清理）: ${mb(total)} MB   条目: ${rows.filter(r => r.isVS).length}\n\n`;
  for (const r of rows) {
    rep += `${r.isVS ? '✔清' : '  保留?'}  ${String(mb(r.sz)).padStart(9)} MB  ${fmt(r.mt)}  ${r.isDir ? '[D]' : '   '} ${r.name}\n`;
  }
}

// ---------- 3. 回收站 ----------
sec('【3】recycle  →  回收站');
for (const root of ['C:/$RECYCLE.BIN', 'D:/$RECYCLE.BIN']) {
  if (!fs.existsSync(root)) { rep += `${root} 不存在\n`; continue; }
  const r = dirSize(root);
  grand += r.size;
  rep += `${root}\n  共 ${mb(r.size)} MB / ${r.count} 个文件\n`;
}

// ---------- 4. DrvPath ----------
sec('【4】drvpath  →  C:\\DrvPath');
{
  const p = 'C:/DrvPath';
  if (fs.existsSync(p)) {
    const r = dirSize(p);
    grand += r.size;
    rep += `总大小: ${mb(r.size)} MB   文件数: ${r.count}\n\n`;
    const walk = (d, pre = '', depth = 0) => {
      if (depth > 3) return;
      let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of es.slice(0, 25)) {
        const f = path.join(d, e.name);
        const st = (() => { try { return fs.statSync(f); } catch { return null; } })();
        if (e.isDirectory()) {
          rep += `  ${pre}[D] ${String(dirSize(f).size / 1048576 | 0).padStart(5)} MB  ${e.name}\n`;
          walk(f, pre + '    ', depth + 1);
        } else {
          rep += `  ${pre}    ${String((st ? st.size / 1048576 : 0).toFixed(1)).padStart(7)} MB  ${e.name}  (${st ? fmt(st.mtimeMs) : '?'})\n`;
        }
      }
    };
    walk(p);
  } else rep += '不存在\n';
}

// ---------- 5. 5EDemocache ----------
sec('【5】5edemo  →  D:\\5EDemocache');
{
  const p = 'D:/5EDemocache';
  if (fs.existsSync(p)) {
    const r = dirSize(p);
    grand += r.size;
    rep += `总大小: ${mb(r.size)} MB   文件数: ${r.count}\n\n`;
    let es = []; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch {}
    for (const e of es) {
      const f = path.join(p, e.name);
      const st = (() => { try { return fs.statSync(f); } catch { return null; } })();
      rep += `  ${String(st ? (st.size / 1048576).toFixed(1) : '?').padStart(8)} MB  ${fmt(st ? st.mtimeMs : 0)}  ${e.name}\n`;
    }
  } else rep += '不存在\n';
}

// ---------- 6. rgloader ----------
sec('【6】rgloader  →  C:\\rgloader');
{
  const p = 'C:/rgloader';
  if (fs.existsSync(p)) {
    const r = dirSize(p);
    grand += r.size;
    rep += `总大小: ${mb(r.size)} MB   文件数: ${r.count}\n\n`;
    let es = []; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch {}
    for (const e of es) {
      const f = path.join(p, e.name);
      const st = (() => { try { return fs.statSync(f); } catch { return null; } })();
      rep += `  ${String(st ? st.size : '?').padStart(10)} B  ${fmt(st ? st.mtimeMs : 0)}  ${e.name}\n`;
    }
  } else rep += '不存在\n';
}

// ---------- 7. ComboKey ----------
sec('【7】combokey  →  C:\\ComboKey');
{
  const p = 'C:/ComboKey';
  if (fs.existsSync(p)) {
    let es = [];
    try { es = fs.readdirSync(p); } catch {}
    rep += es.length === 0 ? '  （空目录，无内容）\n' : es.join('\n') + '\n';
  } else rep += '不存在\n';
}

// ---------- 8. 360Downloads ----------
sec('【8】360dl  →  D:\\360Downloads 中的旧安装包（非程序本体）');
{
  const p = 'D:/360Downloads';
  if (fs.existsSync(p)) {
    const r = dirSize(p);
    rep += `目录总计: ${mb(r.size)} MB / ${r.count} 文件\n\n`;
    const es = fs.readdirSync(p, { withFileTypes: true });
    let rows = [];
    for (const e of es) {
      const f = path.join(p, e.name);
      const st = (() => { try { return fs.statSync(f); } catch { return null; } })();
      if (!st) continue;
      const sz = e.isFile() ? st.size : dirSize(f).size;
      rows.push({ name: e.name, sz, mt: st.mtimeMs, isDir: e.isDirectory(), isExe: /\.(exe|msi|7z|zip|rar|tar\.gz|cab)$/i.test(e.name) });
    }
    rows.sort((a, b) => b.sz - a.sz);
    let instTotal = 0;
    for (const r2 of rows) {
      if (r2.sz < 1024 * 1024) continue;
      const mark = r2.isExe ? '✔安装包' : (r2.isDir ? ' [D]需看' : '  ');
      if (r2.isExe) instTotal += r2.sz;
      rep += `${mark}  ${String(mb(r2.sz)).padStart(9)} MB  ${fmt(r2.mt)}  ${r2.name}\n`;
    }
    grand += instTotal;
    rep += `\n其中顶层安装包合计: ${mb(instTotal)} MB\n`;
    rep += `注：Free Download Manager 子目录是 FDM 程序本体（2026-03 还在用），未计入清理。\n`;
  } else rep += '不存在\n';
}

rep += `\n\n${'='.repeat(70)}\n总计（本次勾选项估算可清理）: ${(grand / 1073741824).toFixed(2)} GB\n${'='.repeat(70)}\n`;

fs.writeFileSync(`${OUT}/待清理清单.txt`, rep, 'utf8');
console.log(rep);
