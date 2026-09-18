// 侦察：欢迎页主标题的完整字体来源 + 场景翻滚动画的 CSS 变量机制
// 只读。用法：node scripts/probe-title.mjs [port]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

const evaluate = async (expression) => {
  try { return await session.evaluate(expression); }
  catch (error) { return `ERROR ${error.message}`; }
};

console.log("===== 标题元素当前全部相关样式 =====");
console.log(await evaluate(`(() => {
  const el = document.querySelector(".wb-home-header__title");
  const span = el?.querySelector("span");
  if (!el) return "NOT FOUND";
  const pick = (n) => {
    const cs = getComputedStyle(n);
    return {
      fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily.slice(0, 90),
      letterSpacing: cs.letterSpacing, wordSpacing: cs.wordSpacing,
      color: cs.color, textAlign: cs.textAlign,
      display: cs.display, alignItems: cs.alignItems, gap: cs.gap,
      webkitTextStroke: cs.webkitTextStrokeWidth + " " + cs.webkitTextStrokeColor,
      textShadow: cs.textShadow,
      backgroundImage: cs.backgroundImage.slice(0, 120),
      backgroundClip: cs.backgroundClip,
      webkitTextFillColor: cs.webkitTextFillColor,
      transform: cs.transform, willChange: cs.willChange,
      animation: cs.animationName + " " + cs.animationDuration,
    };
  };
  return JSON.stringify({
    h1: pick(el),
    span: span ? pick(span) : null,
    h1SizeVar: getComputedStyle(el).getPropertyValue("--wb-font-h2-size").trim(),
    h1LhVar: getComputedStyle(el).getPropertyValue("--wb-font-h2-line-height").trim(),
    spacing1: getComputedStyle(el).getPropertyValue("--wb-spacing-1").trim(),
    fontSize8: getComputedStyle(document.body).getPropertyValue("--wb-font-size-8").trim(),
    lineHeight7: getComputedStyle(document.body).getPropertyValue("--wb-font-line-height-7").trim(),
  }, null, 2);
})()`));

console.log("\n===== 浏览器的 @keyframes 清单（含 roll/slide/swap 的）=====");
console.log(await evaluate(`(() => {
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.constructor.name === "CSSKeyframesRule" || rule.cssText?.startsWith("@keyframes")) {
        names.add(rule.name || rule.cssText.split("{")[0].trim());
      }
    }
  }
  return JSON.stringify([...names].filter((n) => /roll|slide|swap|fade|turn|flip|scene/i.test(n)), null, 2);
})()`));

console.log("\n===== 侧边栏 logo 结构 =====");
console.log(await evaluate(`(() => {
  const el = document.querySelector(".logo-workbuddy-title");
  if (!el) return "NOT FOUND";
  return JSON.stringify({
    outerHTML: el.outerHTML,
    parentHTML: el.parentElement?.outerHTML?.slice(0, 900),
    siblings: el.parentElement ? [...el.parentElement.children].map((c) => c.tagName.toLowerCase() + "." + (c.className||"")) : null,
    text: el.textContent,
    cs: (() => { const cs = getComputedStyle(el); return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing, color: cs.color, fontFamily: cs.fontFamily.slice(0,60), overflow: cs.overflow, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace }; })(),
  }, null, 2);
})()`));

console.log("\n===== 侧边栏 logo 的原生样式规则 =====");
console.log(await evaluate(`(() => {
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        const sel = rule.selectorText || "";
        if (!/logo-workbuddy-title|conversation-list-logo/.test(sel)) continue;
        hits.push({ sel: sel.slice(0, 220), css: (rule.cssText || "").slice(0, 460) });
      }
    };
    walk(rules);
  }
  return JSON.stringify(hits, null, 2);
})()`));

session.close();
