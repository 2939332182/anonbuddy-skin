// raw.githubusercontent.com 候选 IP 实测
import { connect } from 'node:net';
import { request } from 'node:https';

// 185.199.108-111.133 是 GitHub Pages/raw 的官方 4 个 IP
// 另外测试一些常见的 CDN 节点
const candidates = [
  '185.199.108.133',
  '185.199.109.133',
  '185.199.110.133',
  '185.199.111.133',
  '185.199.108.153',
  '185.199.109.153',
  '185.199.110.153',
  '185.199.111.153',
  '151.101.0.133',
  '151.101.64.133',
  '151.101.128.133',
  '151.101.192.133',
];

function tcpPing(ip, port = 443, timeout = 3000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const sock = connect({ host: ip, port });
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      try { sock.destroy(); } catch {}
      resolve({ ip, ok, ms: Date.now() - t0 });
    };
    sock.setTimeout(timeout);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
  });
}

// 通过指定 IP 做真实 TLS 请求，测 HTTP 响应时间
function httpsVia(ip, hostname, path = '/', timeout = 8000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const req = request({
      host: ip,
      port: 443,
      path,
      method: 'HEAD',
      servername: hostname,
      headers: { Host: hostname, 'User-Agent': 'Mozilla/5.0' },
      timeout,
    }, res => {
      res.resume();
      resolve({ ip, ok: true, ms: Date.now() - t0, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ip, ok: false, ms: Date.now() - t0, err: '超时' }); });
    req.on('error', e => resolve({ ip, ok: false, ms: Date.now() - t0, err: e.message.slice(0, 30) }));
    req.end();
  });
}

console.log('===== 步骤1：TCP 握手测速（443 端口，3 次取最快）=====\n');
const tcpResults = [];
for (const ip of candidates) {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await tcpPing(ip));
  const okRuns = runs.filter(r => r.ok);
  const best = okRuns.length ? Math.min(...okRuns.map(r => r.ms)) : null;
  const avg = okRuns.length ? Math.round(okRuns.reduce((s, r) => s + r.ms, 0) / okRuns.length) : null;
  tcpResults.push({ ip, best, avg, ok: okRuns.length });
  console.log(`  ${ip.padEnd(18)} ${okRuns.length}/3 成功   最快 ${best === null ? '  -  ' : String(best).padStart(5) + 'ms'}   平均 ${avg === null ? '-' : avg + 'ms'}`);
}

console.log('\n===== 步骤2：TLS + HTTP 真实响应（对 raw.githubusercontent.com）=====\n');
const live = tcpResults.filter(r => r.ok === 3).sort((a, b) => a.best - b.best);
const httpResults = [];
for (const r of live) {
  const res = await httpsVia(r.ip, 'raw.githubusercontent.com', '/torvalds/linux/master/README');
  httpResults.push({ ...r, ...res });
  console.log(`  ${r.ip.padEnd(18)} ${res.ok ? '✅ HTTP ' + res.status : '❌ ' + res.err}   耗时 ${res.ms}ms`);
}

console.log('\n===== 推荐结果 =====\n');
const good = httpResults.filter(r => r.ok).sort((a, b) => a.ms - b.ms);
if (good.length) {
  console.log('按 HTTP 响应速度排序（推荐写入 hosts）：');
  good.slice(0, 4).forEach((r, i) => console.log(`  ${i + 1}. ${r.ip}   HTTP ${r.ms}ms   TCP最快 ${r.best}ms`));
  console.log('\n最推荐：' + good[0].ip);
} else {
  console.log('⚠️ 无可用 IP，建议改用代理/镜像方案');
}
