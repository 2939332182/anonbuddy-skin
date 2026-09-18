// 最后核实：空目录、特殊项、Steam/QQ/临时目录细节
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/workbuddy-skin-studio/cleanup-audit';

function listDir(p, max = 30) {
  let e = [];
  try { e = fs.readdirSync(p, { withFileTypes: true }); } catch { return '(无法读取)'; }
  return e.length === 0 ? '(空目录)' : e.slice(0, max).map(x => (x.isDirectory() ? '[D] ' : '    ') + x.name).join('\n        ');
}

let rep = '===== 空目录 / 特殊项核实 =====\n\n';
const check = [
  'C:/ComboKey', 'C:/Ciallo～(∠・ω )⌒★', 'C:/新建文件夹', 'C:/betterncm',
  'C:/Autodesk', 'C:/Microsoft Shared', 'C:/DrvPath', 'C:/rgloader',
  'C:/Tangent', 'D:/wps', 'D:/KingsoftData', 'D:/.temp', 'D:/GameVideos',
  'D:/BaiduNetdiskDownload', 'C:/Temp', 'D:/epic', 'D:/123pan',
  'D:/夸克', 'D:/5EDemocache', 'C:/$WINDOWS.~BT', 'C:/$Windows.~WS',
  'C:/$WinREAgent', 'C:/ESD',
];
for (const p of check) {
  if (!fs.existsSync(p)) { rep += `${p}\n  -> 不存在\n\n`; continue; }
  let st; try { st = fs.lstatSync(p); } catch {}
  const isLink = st && st.isSymbolicLink();
  const n = (() => { try { return fs.readdirSync(p).length; } catch { return -1; } })();
  rep += `${p}\n  子项数=${n} 符号链接=${isLink}  mtime=${st ? new Date(st.mtimeMs).toISOString().slice(0, 10) : '?'}\n  内容: ${listDir(p)}\n\n`;
}

// 用户临时目录 Top 项
rep += '\n===== 用户临时目录 Top 占用 =====\n\n';
const tmp = 'C:/Users/ZhuanZ/AppData/Local/Temp';
function dirSize(d, depth = 0) {
  if (depth > 20) return 0;
  let t = 0, es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return 0; }
  for (const e of es) {
    const f = path.join(d, e.name);
    try { if (e.isFile()) t += fs.statSync(f).size; else if (e.isDirectory()) t += dirSize(f, depth + 1); } catch {}
  }
  return t;
}
try {
  const es = fs.readdirSync(tmp, { withFileTypes: true });
  const rows = es.map(e => {
    const f = path.join(tmp, e.name);
    let sz = 0, mt = 0;
    try { const st = fs.statSync(f); mt = st.mtimeMs; sz = st.isFile() ? st.size : dirSize(f); } catch {}
    return { name: e.name, sz: +(sz / 1048576).toFixed(1), mt: new Date(mt).toISOString().slice(0, 10) };
  }).sort((a, b) => b.sz - a.sz).slice(0, 20);
  for (const r of rows) rep += `${String(r.sz).padStart(9)} MB  ${r.mt}  ${r.name}\n`;
} catch (e) { rep += '读取失败: ' + e.message + '\n'; }

// Steam 库
rep += '\n===== Steam 库 =====\n\n';
for (const d of ['C:/SteamLibrary', 'D:/steam']) {
  rep += `${d}:\n  内容: ${listDir(d, 20)}\n\n`;
}

// 桌面/下载 大项
rep += '\n===== 桌面 Top 项 =====\n\n';
try {
  const desk = 'C:/Users/ZhuanZ/Desktop';
  const es = fs.readdirSync(desk, { withFileTypes: true });
  const rows = es.map(e => {
    const f = path.join(desk, e.name);
    let sz = 0, mt = 0;
    try { const st = fs.statSync(f); mt = st.mtimeMs; sz = st.isFile() ? st.size : dirSize(f); } catch {}
    return { name: e.name, sz: +(sz / 1048576).toFixed(1), mt: new Date(mt).toISOString().slice(0, 10), isDir: e.isDirectory() };
  }).sort((a, b) => b.sz - a.sz).slice(0, 25);
  for (const r of rows) rep += `${String(r.sz).padStart(9)} MB  ${r.mt}  ${r.isDir ? '[D] ' : '    '}${r.name}\n`;
} catch (e) { rep += '读取失败\n'; }

fs.writeFileSync(`${OUT}/final-check.txt`, rep, 'utf8');
console.log('FINAL_DONE');
