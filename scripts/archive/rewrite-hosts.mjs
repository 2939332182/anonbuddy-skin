// 用正确的独立 IP 重写 hosts 的 GitHub 段
import fs from 'node:fs';

const HOSTS = 'C:/Windows/System32/drivers/etc/hosts';

const githubIP = '20.205.243.166';
const codeloadIP = '20.205.243.165';
const apiIP = '20.205.243.168';
const rawIP = '185.199.109.133';

const raw = fs.readFileSync(HOSTS, 'utf8');
const lines = raw.split(/\r?\n/);
let out = [], inWB = false;
for (const line of lines) {
  if (/# === WorkBuddy GitHub Fix Start ===/.test(line)) { inWB = true; continue; }
  if (/# === WorkBuddy GitHub Fix End ===/.test(line)) { inWB = false; continue; }
  if (inWB) continue;
  out.push(line);
}
while (out.length && out[out.length - 1].trim() === '') out.pop();

const block = [
  '',
  '# === WorkBuddy GitHub Fix Start ===',
  '# 说明: 本机 IPv6 无公网路由，固定实测最优 IPv4 节点',
  '# 关键: codeload / api 有各自独立 IP，不可与 github.com 混用',
  '# 更新: 2026-09-11',
  '# 还原: D:\\anonbuddy-skin\\cleanup-audit\\hosts-backup\\',
  '',
  '# --- raw 单文件域（实测平均 109ms）---',
  `${rawIP}		raw.githubusercontent.com`,
  `${rawIP}		raw.github.com`,
  '',
  '# --- 资源与图片域 ---',
  `${rawIP}		objects.githubusercontent.com`,
  `${rawIP}		media.githubusercontent.com`,
  `${rawIP}		gist.githubusercontent.com`,
  `${rawIP}		gist.github.com`,
  `${rawIP}		avatars.githubusercontent.com`,
  `${rawIP}		avatars0.githubusercontent.com`,
  `${rawIP}		avatars1.githubusercontent.com`,
  `${rawIP}		avatars2.githubusercontent.com`,
  `${rawIP}		avatars3.githubusercontent.com`,
  `${rawIP}		avatars4.githubusercontent.com`,
  `${rawIP}		avatars5.githubusercontent.com`,
  `${rawIP}		favicons.githubusercontent.com`,
  `${rawIP}		camo.githubusercontent.com`,
  `${rawIP}		user-images.githubusercontent.com`,
  '',
  '# --- 网站主域 ---',
  `${githubIP}		github.com`,
  `${githubIP}		www.github.com`,
  '',
  '# --- 代码下载域（独立 IP）---',
  `${codeloadIP}		codeload.github.com`,
  '',
  '# --- API 域（独立 IP）---',
  `${apiIP}		api.github.com`,
  '',
  '# === WorkBuddy GitHub Fix End ===',
];

const result = out.concat(block).join('\r\n') + '\r\n';
fs.writeFileSync(HOSTS, result, 'utf8');
console.log('✅ hosts 已更新（使用各域独立 IP）');
console.log('   github.com          -> ' + githubIP);
console.log('   codeload.github.com -> ' + codeloadIP);
console.log('   api.github.com      -> ' + apiIP);
console.log('   raw.*.github...     -> ' + rawIP);
