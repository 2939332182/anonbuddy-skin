// 真实下载速度测试：直连各类 GitHub 资源，测实际吞吐
const tests = [
  { name: 'raw 小文件 (README)', url: 'https://raw.githubusercontent.com/torvalds/linux/master/README' },
  { name: 'codeload 源码包 (git ~11MB)', url: 'https://codeload.github.com/git/git/tar.gz/refs/tags/v2.43.0' },
];

async function download(url, timeoutMs = 25000, maxBytes = 30 * 1024 * 1024) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) { clearTimeout(timer); return { ok: false, status: res.status }; }
    const reader = res.body.getReader();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes >= maxBytes) { ctrl.abort(); break; }
    }
    clearTimeout(timer);
    const ms = Date.now() - t0;
    return { ok: true, bytes, ms, speed: bytes / (ms / 1000) };
  } catch (e) {
    const ms = Date.now() - t0;
    return { ok: false, err: e.name === 'AbortError' ? '超时' : e.message.slice(0, 50), ms };
  }
}

const fmtSpeed = s => {
  if (s > 1048576) return (s / 1048576).toFixed(2) + ' MB/s';
  if (s > 1024) return (s / 1024).toFixed(1) + ' KB/s';
  return s.toFixed(0) + ' B/s';
};

console.log('===== GitHub 真实下载速度测试 =====\n');
for (const t of tests) {
  console.log(`▶ ${t.name}`);
  console.log(`  ${t.url}`);
  const r = await download(t.url);
  if (r.ok) {
    console.log(`  ✅ 下载 ${(r.bytes / 1048576).toFixed(2)} MB / 耗时 ${(r.ms / 1000).toFixed(1)}s / 速度 ${fmtSpeed(r.speed)}\n`);
  } else {
    console.log(`  ❌ 失败: ${r.err || 'HTTP ' + r.status} / 耗时 ${(r.ms / 1000).toFixed(1)}s\n`);
  }
}
