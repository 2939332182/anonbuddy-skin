// 读取注册表已安装程序列表，用 reg query 代替（避免 PowerShell 问题）
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = 'D:/anonbuddy-skin/cleanup-audit';
fs.mkdirSync(OUT, { recursive: true });

const keys = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

let all = [];
for (const k of keys) {
  let subs = [];
  try {
    const out = execSync(`reg query "${k}" /s /v DisplayName`, { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s+DisplayName\s+REG_SZ\s+(.+)$/i);
      if (m) {
        let v = m[1].trim();
        try { v = Buffer.from(v, 'latin1').toString('utf8'); } catch {}
        all.push(v);
      }
    }
  } catch (e) {
    all.push(`!! 读取失败 ${k}: ${e.message.slice(0, 80)}`);
  }
}

all = [...new Set(all)].sort((a, b) => a.localeCompare(b, 'zh'));
fs.writeFileSync(`${OUT}/installed-apps.txt`, all.join('\n'), 'utf8');
console.log('COUNT=' + all.length);
console.log(all.join('\n'));
