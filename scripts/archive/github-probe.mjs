// GitHub 域名体检：多轮探测，找出哪些域可用、延迟多少
const domains = [
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
  'api.github.com',
  'ghcr.io',
  'gist.githubusercontent.com',
  'avatars.githubusercontent.com',
];

async function probe(url, timeoutMs = 8000) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(timer);
    return { ok: true, ms: Date.now() - t0, status: res.status };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, err: e.name === 'AbortError' ? '超时' : e.message.slice(0, 40) };
  }
}

console.log('===== GitHub 相关域名体检（HEAD 请求，超时 8s）=====\n');
const report = [];
for (const d of domains) {
  const results = [];
  for (let i = 0; i < 3; i++) {
    const r = await probe(`https://${d}`);
    results.push(r);
  }
  const okCount = results.filter(r => r.ok).length;
  const times = results.filter(r => r.ok).map(r => r.ms);
  const best = times.length ? Math.min(...times) : null;
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const status = okCount === 3 ? '✅ 稳定' : okCount > 0 ? '⚠️ 波动' : '❌ 不可达';
  const line = `${d.padEnd(36)} ${status}  成功 ${okCount}/3  最快 ${best === null ? '-' : best + 'ms'}  平均 ${avg === null ? '-' : avg + 'ms'}`;
  console.log(line);
  report.push({ domain: d, okCount, best, avg, status, detail: results.map(r => r.ok ? `${r.ms}ms/${r.status}` : r.err).join(' | ') });
  await new Promise(r => setTimeout(r, 300));
}

console.log('\n===== 详细结果 =====');
for (const r of report) {
  console.log(`${r.domain}\n   ${r.detail}\n`);
}
