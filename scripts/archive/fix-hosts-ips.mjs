// 修正 hosts：正确提取 DNS 查询结果中的真实 IP
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const HOSTS = 'C:/Windows/System32/drivers/etc/hosts';

// 用 nslookup 查 DNS，正确解析出目标域名的 A 记录
function resolveReal(domain) {
  try {
    const out = execSync(`nslookup -type=A ${domain} 8.8.8.8`, { encoding: 'latin1', timeout: 15000 });
    const lines = out.split(/\r?\n/);
    const ips = [];
    let afterName = false;
    for (const line of lines) {
      // 找到 "名称/Name: <domain>" 后的 Address 行
      if (/^\s*(名称|Name):\s*/i.test(line)) { afterName = true; continue; }
      if (afterName) {
        const m = line.match(/^\s*(?:Address|Addresses):\s*([\d.]+)/i);
        if (m) {
          const ip = m[1];
          if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('8.8.8.8')) ips.push(ip);
        }
        // 遇到下一个 Name 段则重置
        if (/^\s*(名称|Name):/i.test(line)) afterName = false;
      }
    }
    return [...new Set(ips)];
  } catch (e) { return []; }
}

console.log('=== 查询各域名的真实 IP（nslookup 到 8.8.8.8）===\n');
const domains = ['github.com', 'codeload.github.com', 'api.github.com'];
const realIP = {};
for (const d of domains) {
  const ips = resolveReal(d);
  realIP[d] = ips;
  console.log(`  ${d.padEnd(24)} -> ${ips.join(', ') || '(查询失败)'}`);
}

const githubIP = realIP['github.com']?.[0];
const codeloadIP = realIP['codeload.github.com']?.[0];
const apiIP = realIP['api.github.com']?.[0];

if (!githubIP || !codeloadIP || !apiIP) {
  console.log('\n❌ 解析失败，中止操作以保护 hosts');
  process.exit(1);
}

console.log(`\n选定 IP:`);
console.log(`  github.com          -> ${githubIP}`);
console.log(`  codeload.github.com -> ${codeloadIP}`);
console.log(`  api.github.com      -> ${apiIP}`);

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
  '# 还原: D:\\workbuddy-skin-studio\\cleanup-audit\\hosts-backup\\',
  '',
  '# --- raw 单文件域（实测 185.199.109.133 平均 109ms）---',
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
console.log('\n✅ hosts 已更新');
