// 侦察：手写修改 h1 内部结构后，React 会不会立刻把它改回去
// （决定"逐字拆分"是持久有效还是会被重渲染冲掉）
// 用法：node scripts/probe-split-hostile.mjs [port]
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
await new Promise((r) => setTimeout(r, 1500));

// 人为把 span 拆成 6 个 span，然后观察 3 秒内结构是否被 React 还原
console.log("拆分前:", await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  return h1?.outerHTML ?? "未挂载";
})()`));

await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  const span = h1?.querySelector("span");
  if (!span) return "no span";
  const text = span.textContent;
  span.textContent = "";
  for (const ch of text) {
    const s = document.createElement("span");
    s.textContent = ch;
    s.dataset.probeChar = "1";
    span.appendChild(s);
  }
  return "split";
})()`);

console.log("\n拆分后立刻:", await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  return {
    html: h1?.outerHTML?.slice(0, 400),
    probeChars: document.querySelectorAll("[data-probe-char]").length,
  };
})()`));

// 观察 3 秒
for (const wait of [500, 1500, 3000]) {
  await new Promise((r) => setTimeout(r, wait === 500 ? 500 : 1000));
  const state = await session.evaluate(`(() => ({
    probeChars: document.querySelectorAll("[data-probe-char]").length,
    html: document.querySelector(".wb-home-header__title")?.outerHTML?.slice(0, 300),
  }))()`);
  console.log(`\n[约 ${wait}ms 后] probeChars=${state.probeChars}`);
  console.log("  " + state.html);
}

// 触发一次场景切换（React 会重渲染标题区），看拆分是否被冲掉
console.log("\n--- 触发场景切换（点另一个胶囊）---");
await session.evaluate(`(() => {
  const pills = [...document.querySelectorAll(".wb-scene-tabs__pill")];
  pills.find((p) => !p.classList.contains("wb-scene-tabs__pill--active"))?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));
console.log(await session.evaluate(`(() => ({
  probeChars: document.querySelectorAll("[data-probe-char]").length,
  html: document.querySelector(".wb-home-header__title")?.outerHTML?.slice(0, 300),
}))()`));

// 恢复场景
await session.evaluate(`(() => {
  const pills = [...document.querySelectorAll(".wb-scene-tabs__pill")];
  pills.find((p) => p.textContent.trim() === "日常办公")?.click();
  return true;
})()`);

session.close();
