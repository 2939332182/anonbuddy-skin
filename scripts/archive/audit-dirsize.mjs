// 目录级体积统计：找出占空间大的可清理目录
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const OUT = 'D:/anonbuddy-skin/cleanup-audit';
fs.mkdirSync(OUT, { recursive: true });

// 计算目录体积（带权重，深度限制）
function dirSize(dir, depth = 0, maxDepth = 30) {
  if (depth > maxDepth) return 0;
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isFile()) {
        total += fs.statSync(full).size;
      } else if (e.isDirectory()) {
        total += dirSize(full, depth + 1, maxDepth);
      }
    } catch {}
  }
  return total;
}

const targets = [
  ['C:/$WINDOWS.~BT', 'Windows升级残留'],
  ['C:/$Windows.~WS', 'Windows升级残留'],
  ['C:/$WinREAgent', '系统恢复残留'],
  ['C:/ESD', 'Windows安装包缓存'],
  ['C:/Windows.old', '旧系统备份'],
  ['C:/Windows/SoftwareDistribution/Download', 'Windows更新缓存'],
  ['C:/Windows/Temp', '系统临时文件'],
  ['C:/Windows/Prefetch', '预读缓存'],
  ['C:/Windows/LiveKernelReports', '内核报告'],
  ['C:/Windows/Minidump', '崩溃转储'],
  ['C:/Temp', '临时目录'],
  ['C:/Autodesk', 'Autodesk安装残留'],
  ['C:/betterncm', 'BetterNCM插件'],
  ['C:/ComboKey', 'ComboKey(2024后未动)'],
  ['C:/DrvPath', '驱动残留'],
  ['C:/Microsoft Shared', '旧版共享组件'],
  ['C:/rgloader', 'rgloader'],
  ['C:/Tangent', 'Tangent(可疑)'],
  ['C:/Ciallo～(∠・ω )⌒★', '奇怪命名的目录'],
  ['C:/图吧工具箱', '图吧工具箱'],
  ['C:/新建文件夹', '新建文件夹'],
  ['D:/123pan', '123网盘'],
  ['D:/360Downloads', '360下载缓存'],
  ['D:/BaiduNetdiskDownload', '百度网盘下载'],
  ['D:/夸克', '夸克网盘'],
  ['D:/网盘', '网盘(旧目录)'],
  ['D:/.temp', 'D盘临时目录'],
  ['D:/GameVideos', '游戏录像'],
  ['D:/steam美化插件', 'Steam美化插件'],
  ['D:/Pengu Loader', 'Pengu Loader'],
  ['D:/Ksoftware', 'Ksoftware(2024后未动)'],
  ['D:/pkg文件转换', 'pkg转换工具'],
  ['D:/wanmei', '完美世界'],
  ['D:/WeGameApps', 'WeGame游戏'],
  ['D:/5e', '5E对战平台'],
  ['D:/5EDemocache', '5E demo缓存'],
  ['D:/epic', 'Epic'],
  ['D:/github', 'github目录'],
  ['D:/KingsoftData', 'WPS金山数据'],
  ['D:/wps', '旧WPS目录'],
  ['D:/网易云', '网易云(旧)'],
  ['D:/黑河语音', '黑河语音'],
  ['D:/古怪加速器', '加速器(2025-02后未动)'],
  ['D:/外星仔加速器', '加速器(2025-12后未动)'],
  ['D:/steam加速', '加速器相关'],
  ['D:/xwechat_files', '微信文件'],
  ['D:/qqnt', 'QQ NT'],
  ['D:/edge', 'edge相关'],
  ['C:/Users/ZhuanZ/Downloads', '下载目录'],
  ['C:/Users/ZhuanZ/Desktop', '桌面'],
  ['C:/Users/ZhuanZ/Videos', '视频'],
  ['C:/Users/ZhuanZ/Pictures', '图片'],
  ['C:/Users/ZhuanZ/AppData/Local/Temp', '用户临时目录'],
  ['D:/.pnpm-store', 'pnpm存储'],
];

const rows = [];
for (const [p, label] of targets) {
  if (fs.existsSync(p)) {
    const sz = dirSize(p);
    if (sz > 1024 * 1024) { // >1MB
      rows.push({ sizeMB: +(sz / 1048576).toFixed(1), label, path: p });
    }
  }
}
rows.sort((a, b) => b.sizeMB - a.sizeMB);

let rep = '===== 目录体积排行（可清理候选，按大小排序）=====\n\n';
let total = 0;
for (const r of rows) {
  total += r.sizeMB;
  rep += `${String(r.sizeMB).padStart(10)} MB   ${r.label}\n              ${r.path}\n`;
}
rep += `\n候选合计约 ${(total / 1024).toFixed(2)} GB\n`;
fs.writeFileSync(`${OUT}/dir-sizes.txt`, rep, 'utf8');
console.log(rep);
