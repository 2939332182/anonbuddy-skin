// 应用 GitHub hosts 优化
// 1. 读取现有 hosts
// 2. 移除过期的 GitHub520 段
// 3. 写入实测最优节点
import fs from 'node:fs';

const HOSTS = 'C:/Windows/System32/drivers/etc/hosts';

const raw = fs.readFileSync(HOSTS, 'utf8');
const lines = raw.split(/\r?\n/);

// --- 移除 GitHub520 段 ---
let out = [];
let inG520 = false;
let removedG520 = 0;
for (const line of lines) {
  if (/# GitHub520 Host Start/.test(line)) { inG520 = true; continue; }
  if (/# GitHub520 Host End/.test(line)) { inG520 = false; continue; }
  if (inG520) { removedG520++; continue; }
  out.push(line);
}

// --- 移除旧的 WorkBuddy 段 ---
let out2 = [];
let inWB = false;
let removedWB = 0;
for (const line of out) {
  if (/# === WorkBuddy GitHub Fix Start ===/.test(line)) { inWB = true; continue; }
  if (/# === WorkBuddy GitHub Fix End ===/.test(line)) { inWB = false; continue; }
  if (inWB) { removedWB++; continue; }
  out2.push(line);
}

// --- 清理尾部多余空行 ---
while (out2.length && out2[out2.length - 1].trim() === '') out2.pop();

const block = [
  '',
  '# === WorkBuddy GitHub Fix Start ===',
  '# 说明: 本机 IPv6 无公网路由，DNS 却返回 AAAA 记录，故使用实测最快 IPv4 节点',
  '# 实测: 185.199.109.133 平均 109ms / 4轮 HTTP200 全通过（2026-09-11）',
  '# 还原: 备份见 D:\\anonbuddy-skin\\cleanup-audit\\hosts-backup\\',
  '',
  '# --- raw 单文件域（原 hosts 缺失，本次补上）---',
  '185.199.109.133		raw.githubusercontent.com',
  '185.199.109.133		raw.github.com',
  '',
  '# --- 资源与图片域 ---',
  '185.199.109.133		objects.githubusercontent.com',
  '185.199.109.133		media.githubusercontent.com',
  '185.199.109.133		gist.githubusercontent.com',
  '185.199.109.133		gist.github.com',
  '185.199.109.133		avatars.githubusercontent.com',
  '185.199.109.133		avatars0.githubusercontent.com',
  '185.199.109.133		avatars1.githubusercontent.com',
  '185.199.109.133		avatars2.githubusercontent.com',
  '185.199.109.133		avatars3.githubusercontent.com',
  '185.199.109.133		avatars4.githubusercontent.com',
  '185.199.109.133		avatars5.githubusercontent.com',
  '185.199.109.133		favicons.githubusercontent.com',
  '185.199.109.133		camo.githubusercontent.com',
  '185.199.109.133		user-images.githubusercontent.com',
  '',
  '# --- 网站、API 与代码下载 ---',
  '140.82.113.4		github.com',
  '140.82.113.4		www.github.com',
  '140.82.113.4		api.github.com',
  '140.82.113.4		codeload.github.com',
  '140.82.113.4		github.global.ssl.fastly.net',
  '',
  '# === WorkBuddy GitHub Fix End ===',
];

const result = out2.concat(block).join('\r\n') + '\r\n';
fs.writeFileSync(HOSTS, result, 'utf8');

console.log(`✅ 完成`);
console.log(`   移除 GitHub520 段: ${removedG520} 行`);
console.log(`   移除旧 WorkBuddy 段: ${removedWB} 行`);
console.log(`   写入新条目: ${block.filter(l => l && !l.startsWith('#')).length} 条`);
console.log(`   文件大小: ${Buffer.byteLength(result)} 字节`);
