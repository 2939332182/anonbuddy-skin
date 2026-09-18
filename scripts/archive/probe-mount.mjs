// 侦察：应用启动 / 挂载时欢迎页标题是否会被重新渲染（决定翻滚动画的触发点）
// 用法：node scripts/probe-mount.mjs [port]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

// 切到别的页再切回新建任务，观察标题 h1 节点身份是否变化（重挂 vs 复用）
const identity = async () => session.evaluate(`(() => {
  const el = document.querySelector(".wb-home-header__title");
  if (!el) return null;
  window.__titleSeen ??= new WeakSet();
  const known = window.__titleSeen.has(el);
  window.__titleSeen.add(el);
  return { known, text: el.textContent, hasRoll: Boolean(document.querySelector(".wb-home-header__title-roll")) };
})()`);

console.log("首次:", JSON.stringify(await identity()));

// 去助理页
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")].find((b) => b.textContent.trim() === "助理")?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));
console.log("在助理页，标题存在:", JSON.stringify(await session.evaluate(`Boolean(document.querySelector(".wb-home-header__title"))`)));

// 回新建任务
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")].find((b) => b.textContent.trim() === "新建任务")?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));
console.log("回到新建任务:", JSON.stringify(await identity()));

// 检查有没有暴露 i18n / store 可注入点
console.log("\n可注入点探测:", JSON.stringify(await session.evaluate(`(() => ({
  hasI18next: typeof window.i18next,
  hasReactRoot: Boolean(document.querySelector("#root")?._reactRootContainer ?? document.querySelector("#root")?.__reactContainer$),
  localStorageKeys: Object.keys(localStorage).filter((k) => /lang|locale|i18n|scen/i.test(k)),
  htmlLang: document.documentElement.lang,
}))()`), null, 2));

session.close();
