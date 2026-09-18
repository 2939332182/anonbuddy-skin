// 验证：侧边栏应用名 / 欢迎页主标题的文案替换 + 日系轻小说样式 + 翻滚动画
// 用法：node scripts/test-title-copy.mjs [port]
// 只读（不断言具体像素位置，只断言不变量）。

import { createHarness } from "./_harness.mjs";
const t = await createHarness({ name: "test-title-copy" });
const { session } = t;

// 确保停在新建任务页
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1500));

const state = await session.evaluate(`(() => {
  const brand = document.querySelector(".logo-workbuddy-title");
  const h1 = document.querySelector(".wb-home-header__title");
  const span = h1?.querySelector("span");
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      text: (el.textContent ?? "").trim(),
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontWeight: cs.fontWeight,
      letterSpacing: cs.letterSpacing,
      paddingRight: cs.paddingRight,
      textStrokeWidth: cs.webkitTextStrokeWidth,
      textStrokeColor: cs.webkitTextStrokeColor,
      textFillColor: cs.webkitTextFillColor,
      backgroundClip: cs.backgroundClip,
      backgroundImage: cs.backgroundImage.slice(0, 160),
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      color: cs.color,
      gap: cs.gap,
      rect: el.getBoundingClientRect().toJSON(),
    };
  };
  return {
    brand: pick(brand),
    brandTitle: brand?.getAttribute("title") ?? null,
    h1: pick(h1),
    span: pick(span),
    rollExists: Boolean(document.querySelector(".wb-home-header__title-roll")),
    styleText: document.getElementById("workbuddy-skin-style")?.textContent?.length ?? 0,
  };
})()`);

console.log("STATE=" + JSON.stringify({ brand: state.brand?.text, h1: state.h1?.text, fontSize: state.h1?.fontSize }, null, 2));

// ---- 文案 ----
t.check("侧边栏应用名已替换为 ChihayaAnon AI", state.brand?.text === "ChihayaAnon AI", state.brand?.text);
t.check("侧边栏 title 提示同步更新", state.brandTitle === "ChihayaAnon AI", state.brandTitle);
t.check("欢迎页主标题已替换为 探索未至之境", state.h1?.text === "探索未至之境", state.h1?.text);

// ---- 字号（硬性：保持原样）----
t.check("欢迎页主标题字号保持 29px（原样）", state.h1?.fontSize === "29px", state.h1?.fontSize);
t.check("欢迎页主标题行高保持 42px（原样）", state.h1?.lineHeight === "42px", state.h1?.lineHeight);
t.check("欢迎页主标题字重保持 600（原样）", state.h1?.fontWeight === "600", state.h1?.fontWeight);
t.check("侧边栏应用名字号保持 13px（原样）", state.brand?.fontSize === "13px", state.brand?.fontSize);

// 拆字后每个字也必须继承同一字号（inline-block 可能在某些情况下重置字号）
const charMetrics = await session.evaluate(`(() => {
  const chars = [...document.querySelectorAll(".wb-home-header__title span > i")];
  return chars.map((c) => {
    const cs = getComputedStyle(c);
    return { ch: c.textContent, fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, weight: cs.fontWeight };
  });
})()`);
t.check("逐字拆分后每字字号仍是 29px",
  charMetrics.length > 0 && charMetrics.every((c) => c.fontSize === "29px"),
  charMetrics.map((c) => c.fontSize).join(","));
t.check("逐字拆分后每字字距仍生效",
  charMetrics.every((c) => c.letterSpacing === "2.9px"),
  charMetrics[0]?.letterSpacing);
t.check("逐字拆分后每字字重仍是 600",
  charMetrics.every((c) => c.weight === "600"),
  charMetrics[0]?.weight);

// ---- 日系轻小说样式 ----
t.check("标题有字距（letter-spacing 非 normal/0）", state.h1?.letterSpacing && !["normal", "0px"].includes(state.h1.letterSpacing), state.h1?.letterSpacing);
t.check("标题有描边（-webkit-text-stroke-width > 0）", parseFloat(state.h1?.textStrokeWidth ?? "0") > 0, state.h1?.textStrokeWidth + " " + state.h1?.textStrokeColor);
// 描边必须是半透明：解析出 alpha 后判断。注意 color-mix() 的输出是
// color(srgb r g b)（不带 alpha），那种写法会把描边变成实色、糊掉笔画内部，
// 所以这里要求 alpha 存在且 < 1。
const strokeAlpha = (() => {
  const raw = state.h1?.textStrokeColor ?? "";
  const slash = /\/\s*([\d.]+)\s*\)/.exec(raw);
  if (slash) return Number(slash[1]);
  const rgba = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(raw);
  if (rgba) return Number(rgba[1]);
  return 1;                                  // 没有 alpha 分量 = 不透明
})();
t.check("标题描边为半透明（alpha < 1，不遮笔画内部）", strokeAlpha < 1, `alpha=${strokeAlpha} from ${state.h1?.textStrokeColor}`);
t.check("标题填充已交给渐变（fill-color 透明）", /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(state.h1?.textFillColor ?? ""), state.h1?.textFillColor);
t.check("标题 background-clip 为 text", state.h1?.backgroundClip === "text", state.h1?.backgroundClip);
t.check("标题背景是主题色渐变（linear-gradient）", (state.h1?.backgroundImage ?? "").includes("linear-gradient"), state.h1?.backgroundImage?.slice(0, 60));
t.check("标题右侧有 1em 内边距抵消末字字距", parseFloat(state.h1?.paddingRight ?? "0") > 0, state.h1?.paddingRight);
t.check("h1 的 gap 已收掉（避免多载体被撑开）", state.h1?.gap === "0px", state.h1?.gap);

// ---- 逐字打字动画（动画挂在每个字上，不在 h1 上）----
const perChar = await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  const chars = [...h1.querySelectorAll("span > i")];
  return chars.map((c) => {
    const cs = getComputedStyle(c);
    return { ch: c.textContent, anim: cs.animationName, dur: cs.animationDuration, delay: cs.animationDelay };
  });
})()`);
t.check("标题已拆成逐字节点", perChar.length > 1, `${perChar.length} 个字`);
t.check("每个字都挂了打字动画", perChar.length > 0 && perChar.every((c) => c.anim === "workbuddy-skin-char-type-in"),
  perChar[0]?.anim);
t.check("每字动画时长一致", new Set(perChar.map((c) => c.dur)).size === 1, perChar[0]?.dur);
t.check("每字延迟从左到右递增", (() => {
  const ds = perChar.map((c) => parseFloat(c.delay));
  return ds.every((d, i) => i === 0 || d > ds[i - 1]);
})(), perChar.map((c) => c.delay).join(" → "));
t.check("h1 自身不再有整体翻滚动画（改成逐字）", state.h1?.animationName === "none", state.h1?.animationName);

// ---- 渐变不外溢（用户明确要求只作用于主标题）----
const leak = await session.evaluate(`(() => {
  const bad = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const clipped = cs.backgroundClip === "text" || cs.webkitBackgroundClip === "text";
    if (!clipped) continue;
    if (el.closest(".wb-home-header__title")) continue;   // 标题自己 + 它的 span
    bad.push((el.tagName.toLowerCase() + "." + (el.className || "")).slice(0, 80));
  }
  return bad.slice(0, 20);
})()`);
t.check("主题色渐变未外溢到其他元素", leak.length === 0, leak.join(" | "));

// ---- 侧边栏文案没被误伤 ----
const sidebarLeak = await session.evaluate(`(() => {
  const texts = [];
  for (const el of document.querySelectorAll("[data-view-id=sidebar] .conversation-list-tab-button")) {
    texts.push((el.textContent || "").trim());
  }
  return texts;
})()`);
t.check("侧边栏其它按钮文案未被改动", sidebarLeak.includes("新建任务") && sidebarLeak.includes("助理"), sidebarLeak.join("/"));

// ---- 原文案能识别（幂等，不会重复替换）----
const idempotent = await session.evaluate(`(() => {
  window.__workbuddySkin?.copy?.apply?.();
  window.__workbuddySkin?.copy?.apply?.();
  const brand = document.querySelector(".logo-workbuddy-title")?.textContent?.trim();
  const h1 = document.querySelector(".wb-home-header__title")?.textContent?.trim();
  return { brand, h1 };
})()`);
t.check("重复应用保持幂等（不叠加）", idempotent.brand === "ChihayaAnon AI" && idempotent.h1 === "探索未至之境", JSON.stringify(idempotent));

// ---- 切页再回来，文案仍然正确（React 重渲染后要能改回）----
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("助理"))?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1500));

const after = await session.evaluate(`(() => ({
  brand: document.querySelector(".logo-workbuddy-title")?.textContent?.trim() ?? null,
  h1: document.querySelector(".wb-home-header__title")?.textContent?.trim() ?? null,
  banner: document.querySelector(".logo-workbuddy-title")?.textContent?.trim() ?? null,
}))()`);
t.check("切页重挂载后侧边栏应用名仍是新文案", after.brand === "ChihayaAnon AI", after.brand);
t.check("切页重挂载后欢迎页标题仍是新文案", after.h1 === "探索未至之境", after.h1);

await t.finish();
