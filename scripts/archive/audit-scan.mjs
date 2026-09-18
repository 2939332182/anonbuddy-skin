// 扫描长时间未使用的文件 & 疑似卸载残留
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const OUT = 'D:/workbuddy-skin-studio/cleanup-audit';
fs.mkdirSync(OUT, { recursive: true });

const NOW = Date.now();
const EIGHTEEN_MONTHS = 18 * 30 * 24 * 3600 * 1000;
const TWO_YEARS = 24 * 30 * 24 * 3600 * 1000;

const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- 1. 旧文件扫描（指定目录） ----------
const SCAN_DIRS = [
  `${HOME}/Desktop`,
  `${HOME}/Downloads`,
  `${HOME}/Documents`,
  `${HOME}/Videos`,
  `${HOME}/Pictures`,
  `${HOME}/Music`,
  'C:/Temp',
  'D:/123pan',
  'D:/360Downloads',
  'D:/BaiduNetdiskDownload',
  'D:/GameVideos',
  'D:/夸克',
  'D:/网盘',
  'D:/.temp',
  'D:/steam美化插件',
  'C:/图吧工具箱',
  'C:/新建文件夹',
  'D:/Ksoftware',
  'D:/pkg文件转换',
  'C:/Ciallo～(∠・ω )⌒★',
];

let oldFiles = [];
let stopped = false;

function walkOld(dir, depth = 0) {
  if (stopped || depth > 12) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (stopped) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walkOld(full, depth + 1);
    } else if (e.isFile()) {
      try {
        const st = fs.statSync(full);
        if (st.size > 5 * 1024 * 1024 && NOW - st.atimeMs > EIGHTEEN_MONTHS) {
          oldFiles.push({ sizeMB: +(st.size / 1048576).toFixed(1), atime: st.atimeMs, mtime: st.mtimeMs, path: full });
        }
      } catch {}
    }
  }
}

const t0 = Date.now();
for (const d of SCAN_DIRS) {
  if (stopped) break;
  if (fs.existsSync(d)) {
    console.log('scan:', d);
    walkOld(d);
  }
  if (Date.now() - t0 > 240000) { stopped = true; console.log('time budget reached'); break; }
}

oldFiles.sort((a, b) => b.sizeMB - a.sizeMB);
const oldTop = oldFiles.slice(0, 120);
const totalOldMB = +oldFiles.reduce((s, f) => s + f.sizeMB, 0).toFixed(1);

const fmt = ms => new Date(ms).toISOString().slice(0, 10);
let rep = '';
rep += `===== 长时间未访问的大文件（>5MB，>18个月未访问） =====\n`;
rep += `共匹配 ${oldFiles.length} 个文件，合计约 ${(totalOldMB / 1024).toFixed(2)} GB\n`;
rep += `扫描耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n\n`;
for (const f of oldTop) {
  rep += `${String(f.sizeMB).padStart(9)} MB  last-access=${fmt(f.atime)}  ${f.path}\n`;
}
fs.writeFileSync(`${OUT}/old-files.txt`, rep, 'utf8');

// ---------- 2. 卸载残留线索 ----------
let residual = [];
const check = (label, p, note = '') => {
  try {
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      residual.push({ label, path: p, mtime: fmt(st.mtimeMs), note });
    }
  } catch {}
};

// 常见残留位置
check('Windows升级残留', 'C:/$WINDOWS.~BT', '旧系统升级临时文件，可安全清理');
check('Windows升级残留', 'C:/$Windows.~WS', 'Windows安装临时文件');
check('WinRE恢复代理残留', 'C:/$WinREAgent', '系统恢复升级残留');
check('Windows升级包缓存', 'C:/ESD', 'Windows安装包缓存');
check('旧版Windows目录', 'C:/Windows.old', '旧系统备份');
check('回收站C', 'C:/$RECYCLE.BIN', '回收站');
check('回收站D', 'D:/$RECYCLE.BIN', '回收站');
check('Autodesk残留(L1)', 'C:/Autodesk', 'Autodesk安装器日志/下载残留');
check('NCM美化插件', 'C:/betterncm', 'BetterNCM (网易云插件)');
check('ComboKey', 'C:/ComboKey', '按键工具，2024年后未更新');
check('DrvPath', 'C:/DrvPath', '驱动残留');
check('Microsoft Shared', 'C:/Microsoft Shared', '旧版共享组件残留');
check('rgloader', 'C:/rgloader', 'Rust 相关加载器');
check('Tangent', 'C:/Tangent', '可疑/旧工具目录');
check('pkg转换', 'D:/pkg文件转换', 'PS3 pkg 转换工具，2025-10后未用');
check('Ksoftware', 'D:/Ksoftware', '2024-09后未更新');
check('wanmei', 'D:/wanmei', '完美世界相关');
check('WeGameApps', 'D:/WeGameApps', 'WeGame 游戏目录');
check('steam美化插件', 'D:/steam美化插件', '2024-10后未更新');
check('Pengu Loader', 'D:/Pengu Loader', 'LOL 换肤加载器');
check('黑河语音', 'D:/黑河语音', '第三方语音工具');
check('5e', 'D:/5e', '5E对战平台');
check('5EDemocache', 'D:/5EDemocache', '5E demo 缓存，可清');
check('epic', 'D:/epic', 'Epic 相关');
check('github', 'D:/github', '2025-10后未动');
check('KingsoftData', 'D:/KingsoftData', 'WPS 金山数据');
check('wps', 'D:/wps', '旧 WPS 目录，2024-09后未动');
check('网易云', 'D:/网易云', '2024-09后未动');
check('GameVideos', 'D:/GameVideos', '游戏录像');
check('360Downloads', 'D:/360Downloads', '360下载缓存');
check('BaiduNetdiskDownload', 'D:/BaiduNetdiskDownload', '百度网盘下载');
check('123pan', 'D:/123pan', '123网盘');
check('夸克', 'D:/夸克', '夸克网盘');
check('怪加速器', 'D:/古怪加速器', '游戏加速器，2025-02后未动');
check('外星仔加速器', 'D:/外星仔加速器', '游戏加速器，2025-12后未动');
check('steam加速', 'D:/steam加速', '加速器相关');
check('D:临时', 'D:/.temp', '临时目录');

// 用户 AppData 残留（只列目录名）
const appdataRoots = [
  `${HOME}/AppData/Local`,
  `${HOME}/AppData/Roaming`,
  `${HOME}/AppData/LocalLow`,
];
const appdataOld = [];
for (const r of appdataRoots) {
  let entries = [];
  try { entries = fs.readdirSync(r, { withFileTypes: true }); } catch { continue; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(r, e.name);
    try {
      const st = fs.statSync(full);
      if (NOW - st.mtimeMs > TWO_YEARS) {
        appdataOld.push({ path: full, mtime: fmt(st.mtimeMs) });
      }
    } catch {}
  }
}

let rep2 = '';
rep2 += `===== 疑似卸载残留 / 可清理目录（仅线索，未删除任何文件） =====\n\n`;
for (const x of residual) {
  rep2 += `[${x.label}]\n  ${x.path}\n  最后修改: ${x.mtime}\n  说明: ${x.note}\n\n`;
}
rep2 += `===== 两年以上未改动的 AppData 配置目录（可能是已卸载软件残留） =====\n\n`;
for (const x of appdataOld) {
  rep2 += `  ${x.mtime}  ${x.path}\n`;
}
fs.writeFileSync(`${OUT}/residual-suspects.txt`, rep2, 'utf8');

console.log('\n---SUMMARY---');
console.log('oldFilesCount=' + oldFiles.length);
console.log('oldFilesGB=' + (totalOldMB / 1024).toFixed(2));
console.log('residualCount=' + residual.length);
console.log('appdataOldCount=' + appdataOld.length);
console.log('OUT=' + OUT);
