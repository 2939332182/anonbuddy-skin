// 进入「新建任务」（欢迎页）并截图，用于对照换肤效果。
// 用法：node scripts/shot-home.mjs [port] [out]
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const OUT = process.argv[3] || "outputs/verify-home/home.png";
const MENU_ID = "anonbuddy-skin-menu";

const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 点侧边栏「新建任务」进入欢迎页
const clicked = await session.evaluate(`(() => {
  const btn = [...document.querySelectorAll("[data-view-id=sidebar] .conversation-list-tab-button")]
    .find((el) => (el.textContent || "").trim() === "新建任务");
  if (!btn) return false;
  btn.click();
  return true;
})()`);
if (!clicked) throw new Error("侧边栏里找不到「新建任务」按钮");
await sleep(1500);

const info = await session.evaluate(`(() => {
  const route = document.querySelector(".wb-home-route");
  return {
    onWelcome: !!route,
    routeBg: route ? getComputedStyle(route).backgroundColor : null,
    dataset: document.documentElement.dataset.anonbuddySkin ?? null,
    styleLen: (document.getElementById("anonbuddy-skin-style")?.textContent || "").length,
  };
})()`);
console.log("STATE=" + JSON.stringify(info));

// 截主内容区（右侧那块，避免带上用户会话列表）
const vp = await session.evaluate(`({ w: innerWidth, h: innerHeight })`);
const shot = await session.send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 264, y: 0, width: vp.w - 264, height: Math.min(vp.h, 900), scale: 1 },
});
await writeFile(OUT, Buffer.from(shot.data, "base64"));
console.log(`WROTE ${OUT}`);
session.close();
