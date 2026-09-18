// 检查逐字拆分与打字动画是否生效
// 用法：node scripts/probe-typewriter.mjs [port]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

const dump = async (label, expr) => {
  console.log(`\n===== ${label} =====`);
  try { console.log(await session.evaluate(expr)); }
  catch (e) { console.log("ERROR " + e.message); }
};

await dump("标题 DOM 结构", `(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  if (!h1) return "未挂载";
  return JSON.stringify({ html: h1.outerHTML.slice(0, 700) }, null, 2);
})()`);

await dump("每个字的动画与延迟", `(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  if (!h1) return "未挂载";
  const chars = [...h1.querySelectorAll("span > i")];
  return JSON.stringify(chars.map((c) => {
    const cs = getComputedStyle(c);
    return {
      ch: c.textContent,
      idx: cs.getPropertyValue("--wb-char-index").trim(),
      anim: cs.animationName,
      dur: cs.animationDuration,
      delay: cs.animationDelay,
      bgSize: cs.backgroundSize,
      bgPos: cs.backgroundPosition,
      fillColor: cs.webkitTextFillColor,
      display: cs.display,
      w: Math.round(c.getBoundingClientRect().width * 10) / 10,
    };
  }), null, 2);
})()`);

await dump("字号/字距未变", `(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  const cs = getComputedStyle(h1);
  const wrap = h1.querySelector("span");
  const wcs = getComputedStyle(wrap);
  return JSON.stringify({
    h1FontSize: cs.fontSize, h1LineHeight: cs.lineHeight, h1Weight: cs.fontWeight,
    h1LetterSpacing: cs.letterSpacing, h1PaddingRight: cs.paddingRight,
    h1Stroke: cs.webkitTextStrokeWidth + " " + cs.webkitTextStrokeColor,
    wrapWidth: Math.round(wrap.getBoundingClientRect().width * 10) / 10,
    wrapLetterSpacing: wcs.letterSpacing,
    gap: cs.gap,
  }, null, 2);
})()`);

session.close();
