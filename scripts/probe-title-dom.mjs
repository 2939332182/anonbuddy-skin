// 侦察：欢迎页主标题的 DOM 结构（做逐字动画需要能单独控制每个字）
// 用法：node scripts/probe-title-dom.mjs [port]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

// 确保在新建任务页
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1600));

console.log("===== 标题 DOM 结构 =====");
console.log(await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  if (!h1) return "标题未挂载";
  return JSON.stringify({
    outerHTML: h1.outerHTML,
    childNodes: [...h1.childNodes].map((n) => ({ type: n.nodeType, name: n.nodeName, value: (n.nodeValue || "").slice(0, 40) })),
    children: [...h1.children].map((c) => ({ tag: c.tagName, cls: (c.className || "").toString(), text: c.textContent })),
    computed: (() => { const cs = getComputedStyle(h1); return { fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, gap: cs.gap, display: cs.display }; })(),
  }, null, 2);
})()`));

console.log("\n===== 标题祖先链（看有无 overflow 裁剪）=====");
console.log(await session.evaluate(`(() => {
  const chain = [];
  let node = document.querySelector(".wb-home-header__title");
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    chain.push({
      tag: node.tagName.toLowerCase(),
      cls: (node.className || "").toString().slice(0, 70),
      w: Math.round(node.getBoundingClientRect().width),
      h: Math.round(node.getBoundingClientRect().height),
      overflow: cs.overflow,
      pos: cs.position,
      zIndex: cs.zIndex,
    });
    node = node.parentElement;
  }
  return JSON.stringify(chain, null, 2);
})()`));

console.log("\n===== 当前动画/字距状态 =====");
console.log(await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  const cs = getComputedStyle(h1);
  return JSON.stringify({
    animationName: cs.animationName,
    animationDuration: cs.animationDuration,
    animationFillMode: cs.animationFillMode,
    letterSpacing: cs.letterSpacing,
    paddingRight: cs.paddingRight,
    gap: cs.gap,
    textContent: h1.textContent,
    textLength: h1.textContent.length,
  }, null, 2);
})()`));

session.close();
