// 细查：系统残留 + 未安装软件残留 + 可疑目录内容
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const OUT = 'D:/workbuddy-skin-studio/cleanup-audit';

function dirSize(dir, depth = 0) {
  if (depth > 30) return 0;
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isFile()) total += fs.statSync(full).size;
      else if (e.isDirectory()) total += dirSize(full, depth + 1);
    } catch {}
  }
  return total;
}
const mb = n => +(n / 1048576).toFixed(1);

let rep = '';
rep += '===== A. Windows 系统升级/更新残留 =====\n\n';
const sysTargets = [
  'C:/$WINDOWS.~BT', 'C:/$Windows.~WS', 'C:/$WinREAgent', 'C:/ESD',
  'C:/Windows.old', 'C:/Windows/SoftwareDistribution/Download',
  'C:/Windows/Temp', 'C:/Windows/Prefetch', 'C:/Windows/LiveKernelReports',
  'C:/Windows/Minidump', 'C:/Recovery',
];
for (const p of sysTargets) {
  if (fs.existsSync(p)) {
    let lst = '?';
    try { lst = new Date(fs.statSync(p).mtimeMs).toISOString().slice(0, 10); } catch {}
    rep += `${String(mb(dirSize(p))).padStart(9)} MB  mtime=${lst}  ${p}\n`;
  } else {
    rep += `     不存在  ${p}\n`;
  }
}

rep += '\n===== B. 回收站体积 =====\n\n';
for (const d of ['C:/$RECYCLE.BIN', 'D:/$RECYCLE.BIN']) {
  rep += `${String(mb(dirSize(d))).padStart(9)} MB  ${d}\n`;
}

rep += '\n===== C. 可疑/旧工具目录内容探察 =====\n\n';
const probes = [
  'C:/Tangent', 'C:/rgloader', 'C:/DrvPath', 'C:/ComboKey',
  'C:/Microsoft Shared', 'C:/Ciallo～(∠・ω )⌒★', 'C:/新建文件夹',
  'D:/网盘', 'D:/网易云', 'D:/5e', 'D:/wanmei', 'D:/黑河语音',
  'D:/steam加速', 'D:/古怪加速器', 'D:/外星仔加速器', 'D:/pkg文件转换',
  'D:/Ksoftware', 'D:/github', 'D:/Pengu Loader', 'D:/steam美化插件',
];
for (const p of probes) {
  if (!fs.existsSync(p)) continue;
  rep += `--- ${p}  [${mb(dirSize(p))} MB] ---\n`;
  let entries = [];
  try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch {}
  const shown = entries.slice(0, 15);
  for (const e of shown) {
    let sz = 0, mt = '';
    try { const st = fs.statSync(path.join(p, e.name)); mt = new Date(st.mtimeMs).toISOString().slice(0, 10); if (st.isFile()) sz = st.size; } catch {}
    rep += `    ${e.isDirectory() ? '[D]' : '   '} ${String(mb(sz)).padStart(8)}MB  ${mt}  ${e.name}\n`;
  }
  if (entries.length > 15) rep += `    ... 共 ${entries.length} 项\n`;
  rep += '\n';
}

rep += '\n===== D. 已安装程序清单（用于比对残留）=====\n\n';
const regPaths = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];
rep += '(见 installed-apps.txt)\n';

fs.writeFileSync(`${OUT}/deep-probe.txt`, rep, 'utf8');
console.log('DEEP_PROBE_DONE');
