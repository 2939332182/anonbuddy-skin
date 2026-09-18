// 探测 renderer 的 localStorage 实际可用容量（用完即清理临时键）
// 用法：node scripts/quota-probe.mjs [port]
// 策略：倍增探到上限 + 二分收敛，避免 O(n^2) 的反复重写
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();

const probe = await session.evaluate(`(() => {
  const KEY = "__wb_quota_probe__";
  const CAP = 8 * 1024 * 1024;                 // 8M 字符封顶，防失控
  const measure = () => {
    let n = 0;
    for (const k of Object.keys(localStorage)) n += k.length + (localStorage.getItem(k) || "").length;
    return n;
  };
  const canWrite = (size) => {
    try { localStorage.setItem(KEY, "x".repeat(size)); return true; } catch { return false; }
  };
  const usedBefore = measure();
  let low = 0;
  let high = 0;
  try {
    // 1) 倍增找上界
    for (let size = 100000; size <= CAP; size *= 2) {
      if (!canWrite(size)) { high = size; break; }
      low = size;
      high = Math.min(size * 2, CAP);
    }
    // 2) 二分收敛
    for (let i = 0; i < 12 && high - low > 50000; i += 1) {
      const mid = Math.floor((low + high) / 2);
      if (canWrite(mid)) low = mid; else high = mid;
    }
  } finally {
    try { localStorage.removeItem(KEY); } catch {}
  }
  return { usedBefore, usedAfter: measure(), writable: low, cleaned: localStorage.getItem(KEY) === null };
})()`);

const perTheme = 131000;
const remaining = probe.writable - probe.usedBefore;
console.log(JSON.stringify(probe, null, 2));
console.log(`\n当前已用 ≈ ${(probe.usedBefore / 1024).toFixed(0)} K 字符`);
console.log(`写入上限 ≈ ${(probe.writable / 1024 / 1024).toFixed(2)} M 字符`);
console.log(`每张自定义图 ≈ ${(perTheme / 1024).toFixed(0)} K 字符 → 总共可放约 ${Math.floor(probe.writable / perTheme)} 张，还能再放约 ${Math.floor(remaining / perTheme)} 张`);
session.close();
