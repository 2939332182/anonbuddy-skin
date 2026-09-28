// 验证逐字打字动画：每个字从左到右依次出现（不是整行一起动、也不是从下往上）
// 用法：node scripts/test-roll-anim.mjs [port]
// 只读。逐帧采样每个字的 opacity/transform，断言时序单调递增。

import { createHarness } from "./_harness.mjs";
const t = await createHarness({ name: "test-roll-anim" });
const { session } = t;

// 前置条件：逐帧采样靠 requestAnimationFrame 驱动，而页面不可见时 rAF **根本不执行**
// （2026-09-29 实测：hidden 状态下 300ms 内零回调；窗口被最小化或收进托盘都会这样）。
// 那种情况下"采到 0 帧"是环境问题，不是动画坏了 —— 明确跳过，别报假失败。
// CDP 唤不回最小化的窗口（Page.bringToFront 实测无效），只能请人把窗口切到前台。
const pageVisible = await session.evaluate(`document.visibilityState === "visible"`);
if (!pageVisible) {
  console.log("SKIP  页面当前不可见（visibilityState=hidden）—— rAF 不执行，采不到逐字动画帧。");
  console.log("      把 WorkBuddy 窗口切到前台（不要最小化 / 不要收进托盘）后重跑本测试。");
  session.close();
  process.exit(0);
}

// 到别的页去，这样切回新建任务时标题会重新挂载（模拟"打开新建任务"）
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("助理"))?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));

// 采样器必须在**切回之前**装好：装在当前页面上，标题未挂载时自然跳过。
// （曾把采样器装在助理页，切页后组件卸载、rAF 循环断掉，只采到 2 帧 → 假失败）
await session.evaluate(`(() => {
  window.__type = { frames: [], done: false };
  const t0 = performance.now();
  const tick = () => {
    const at = performance.now() - t0;
    const chars = [...document.querySelectorAll(".wb-home-header__title span > i")];
    if (chars.length) {
      window.__type.frames.push({
        at: Math.round(at),
        chars: chars.map((c) => {
          const cs = getComputedStyle(c);
          const m = /matrix\\(([^)]+)\\)/.exec(cs.transform);
          return { ch: c.textContent, o: Number(cs.opacity), y: m ? Number(m[1].split(",")[5]) : 0 };
        }),
      });
    }
    if (at < 2500 && !window.__type.done) requestAnimationFrame(tick);
    else window.__type.done = true;
  };
  requestAnimationFrame(tick);
  return true;
})()`);

// 切回新建任务 —— 触发标题重挂载 + 逐字动画
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click();
  return true;
})()`);

for (let i = 0; i < 30; i += 1) {
  if (await session.evaluate(`Boolean(window.__type.done)`)) break;
  await new Promise((r) => setTimeout(r, 150));
}

const frames = await session.evaluate(`(() => { window.__type.done = true; const f = window.__type.frames; delete window.__type; return f; })()`);
console.log(`采到 ${frames.length} 帧，每帧 ${frames[0]?.chars.length ?? 0} 个字`);

if (!frames.length) {
  t.check("采到逐字帧", false, "0 帧");
  session.close();
  process.exitCode = 1;
  process.exit(1);
}

const charCount = frames[0].chars.length;
const texts = frames[0].chars.map((c) => c.ch).join("");
t.check("标题已拆成逐字节点", charCount > 1, `${charCount} 个字：「${texts}」`);

// ---- 核心断言：每个字的"首次出现时刻"必须严格从左到右递增 ----
const firstAppear = [];
for (let i = 0; i < charCount; i += 1) {
  const hit = frames.find((f) => f.chars[i] && f.chars[i].o > 0.01);
  firstAppear.push(hit ? hit.at : null);
}
console.log("每字首次出现(ms): " + JSON.stringify(firstAppear));

const allAppeared = firstAppear.every((v) => v !== null);
t.check("所有字都出现了", allAppeared);

if (allAppeared) {
  let monotonic = true;
  for (let i = 1; i < firstAppear.length; i += 1) {
    if (firstAppear[i] <= firstAppear[i - 1]) monotonic = false;
  }
  t.check("出现顺序严格从左到右（时刻递增）", monotonic, firstAppear.join(" → "));
  const span = firstAppear[firstAppear.length - 1] - firstAppear[0];
  t.check("首字与末字拉开足够间隔（确有逐字感）", span >= 200, `跨度 ${span}ms`);
}

// ---- 不是"从下往上"：位移量应该很小（每字只做轻微上浮）----
const maxY = Math.max(...frames.flatMap((f) => f.chars.map((c) => Math.abs(c.y))));
t.check("单字位移很小（非整行从下往上翻滚，< 8px）", maxY < 8, `maxY=${maxY.toFixed(2)}px`);

// ---- 每字都从透明淡入 ----
const minOpacity = Math.min(...frames.flatMap((f) => f.chars.map((c) => c.o)));
t.check("每字都有淡入（opacity 曾接近 0）", minOpacity < 0.05, `minOpacity=${minOpacity.toFixed(3)}`);

// ---- 结束时全部归位 ----
const last = frames.at(-1);
const settled = last.chars.every((c) => c.o > 0.99 && Math.abs(c.y) < 0.5);
t.check("动画结束时全部字归位且完全不透明", settled,
  last.chars.map((c) => `${c.ch}o=${c.o.toFixed(2)},y=${c.y.toFixed(2)}`).join(" "));

// ---- 字距 / 字号 / 渐变未被破坏 ----
const metrics = await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  const cs = getComputedStyle(h1);
  const chars = [...h1.querySelectorAll("span > i")];
  return {
    fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, stroke: cs.webkitTextStrokeWidth,
    bgSizes: chars.map((c) => c.style.backgroundSize),
    bgPos: chars.map((c) => c.style.backgroundPosition),
  };
})()`);
t.check("字号仍为 29px（未受影响）", metrics.fontSize === "29px", metrics.fontSize);
t.check("字距仍在（非 normal）", metrics.letterSpacing === "2.9px", metrics.letterSpacing);
t.check("描边仍在", parseFloat(metrics.stroke) > 0, metrics.stroke);
t.check("渐变已跨字对齐（每字 background-size 相同且非空）",
  metrics.bgSizes.every((s) => s && s === metrics.bgSizes[0]),
  metrics.bgSizes[0]);
t.check("渐变偏移按字递增（background-position 各不相同）",
  new Set(metrics.bgPos).size === metrics.bgPos.length,
  metrics.bgPos.slice(0, 3).join(" / "));

await t.finish();
