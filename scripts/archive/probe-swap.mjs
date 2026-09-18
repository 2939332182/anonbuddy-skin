// 每帧快照 title-wrap 的完整 innerHTML，捕捉翻滚结构（title-roll / roll-cell / data-wb-swap-phase）何时出现
// 用法：node scripts/probe-swap.mjs [port]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

await session.evaluate(`(() => {
  window.__probe = { frames: [] };
  const t0 = performance.now();
  const norm = (html) => (html || "").replace(/\\s+/g, " ").trim();
  let last = null;
  const tick = () => {
    const at = Math.round(performance.now() - t0);
    const wrap = document.querySelector(".wb-home-header__title-wrap");
    const html = norm(wrap?.innerHTML);
    if (html !== last) {
      last = html;
      window.__probe.frames.push({ at, html: html.slice(0, 1800) });
    }
    if (at < 2600) requestAnimationFrame(tick);
    else window.__probeDone = true;
  };
  requestAnimationFrame(tick);
  return true;
})()`);

await new Promise((r) => setTimeout(r, 300));
await session.evaluate(`(() => {
  const pills = [...document.querySelectorAll(".wb-scene-tabs__pill")];
  const other = pills.find((p) => !p.classList.contains("wb-scene-tabs__pill--active"));
  other?.click();
  return true;
})()`);

for (let i = 0; i < 40; i += 1) {
  if (await session.evaluate(`Boolean(window.__probeDone)`)) break;
  await new Promise((r) => setTimeout(r, 200));
}

const frames = await session.evaluate(`window.__probe.frames`);
console.log(`===== title-wrap 快照序列（${frames.length} 帧变化）=====`);
for (const f of frames) {
  console.log(`\n[${f.at}ms]`);
  console.log(f.html);
}

// 切换回去，恢复状态
await session.evaluate(`(() => {
  const pills = [...document.querySelectorAll(".wb-scene-tabs__pill")];
  const work = pills.find((p) => p.textContent.trim() === "日常办公");
  work?.click();
  return true;
})()`);

session.close();
