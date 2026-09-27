// 判断残留：检查目录内是否有活跃主程序 / 是否只是数据目录
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/anonbuddy-skin/cleanup-audit';

function dirSize(dir, depth = 0) {
  if (depth > 30) return 0;
  let t = 0, entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    try { if (e.isFile()) t += fs.statSync(f).size; else if (e.isDirectory()) t += dirSize(f, depth + 1); } catch {}
  }
  return t;
}
const mb = n => +(n / 1048576).toFixed(1);
const fmt = ms => new Date(ms).toISOString().slice(0, 10);

// 递归找主程序 exe（排除 unins/update/helper 等）
function findExe(dir, depth = 0, found = []) {
  if (depth > 4 || found.length > 12) return found;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { findExe(f, depth + 1, found); }
    else if (/\.exe$/i.test(e.name) && !/unins|update|setup|install|crash|helper|report|repair/i.test(e.name)) {
      try { found.push({ f, t: fs.statSync(f).mtimeMs, sz: fs.statSync(f).size }); } catch {}
    }
  }
  return found;
}

// 最近活动时间（目录树内最新 mtime）
function latestMtime(dir, depth = 0) {
  let max = 0, entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs > max) max = st.mtimeMs;
      if (e.isDirectory() && depth < 5) { const m = latestMtime(f, depth + 1); if (m > max) max = m; }
    } catch {}
  }
  return max;
}

const suspects = [
  ['C:/Tangent', '天正建筑 TArchT20V10'],
  ['C:/DrvPath', '驱动包(蓝牙/声卡)'],
  ['C:/rgloader', 'Ruby rgloader'],
  ['C:/ComboKey', 'ComboKey'],
  ['C:/Microsoft Shared', 'Microsoft Shared/Phone Tools'],
  ['C:/Ciallo～(∠・ω )⌒★', '怪名目录'],
  ['C:/新建文件夹', '新建文件夹'],
  ['C:/betterncm', 'BetterNCM'],
  ['C:/Autodesk', 'Autodesk'],
  ['D:/网盘', '网盘工具(含WPS安装包)'],
  ['D:/网易云', '网易云音乐(旧)'],
  ['D:/5e', '5E对战平台'],
  ['D:/5EDemocache', '5E demo缓存'],
  ['D:/wanmei', '完美世界竞技平台'],
  ['D:/黑河语音', '黑河语音'],
  ['D:/steam加速', 'steam加速器'],
  ['D:/古怪加速器', '古怪加速器'],
  ['D:/外星仔加速器', '外星仔加速器'],
  ['D:/pkg文件转换', 'RePKG工具'],
  ['D:/Ksoftware', 'Ksoftware/360Downloads'],
  ['D:/github', 'GitHubDesktop'],
  ['D:/Pengu Loader', 'Pengu Loader'],
  ['D:/steam美化插件', 'Steam美化插件'],
  ['D:/wps', '旧WPS'],
  ['D:/KingsoftData', 'WPS金山数据'],
  ['D:/360Downloads', '360下载缓存'],
  ['D:/.temp', 'D盘临时'],
  ['D:/epic', 'Epic'],
  ['D:/GameVideos', '游戏录像'],
  ['D:/123pan', '123网盘'],
  ['D:/夸克', '夸克网盘'],
  ['D:/BaiduNetdiskDownload', '百度网盘下载'],
];

let rep = '===== 残留判定：目录内主程序 + 最后活动时间 =====\n\n';
for (const [p, label] of suspects) {
  if (!fs.existsSync(p)) { rep += `[缺失] ${label}  ${p}\n\n`; continue; }
  const sz = mb(dirSize(p));
  const lm = latestMtime(p);
  const exes = findExe(p);
  rep += `### ${label} — ${sz} MB — 最后活动 ${lm ? fmt(lm) : '未知'}\n    路径: ${p}\n`;
  if (exes.length === 0) {
    rep += `    主程序: 无（可能是纯数据/残留目录）\n`;
  } else {
    for (const x of exes.slice(0, 8)) {
      rep += `    主程序: ${mb(x.sz)}MB ${fmt(x.t)} ${x.f.replace(p, '.')}\n`;
    }
  }
  rep += '\n';
}

fs.writeFileSync(`${OUT}/residual-verdict.txt`, rep, 'utf8');
console.log('VERDICT_DONE');
