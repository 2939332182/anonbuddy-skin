// 导航到左上角某个入口（助理 / 自动化 / 专家…）并截图主内容区，用于对照换肤效果。
// 用法：node scripts/shot-route.mjs <导航项文字> [port] [out]
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const [label, portArg = "9333", outArg] = process.argv.slice(2);
if (!label) {
  console.error("用法：node scripts/shot-route.mjs <导航项文字> [port] [out]");
  process.exit(1);
}
const PORT = Number(portArg);
const OUT = outArg || `outputs/verify-route/${label.replace(/[^\w\u4e00-\u9fa5]+/g, "_")}.png`;

const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clicked = await session.evaluate(`(() => {
  const btn = [...document.querySelectorAll("[data-view-id=sidebar] .conversation-list-tab-button")]
    .find((el) => (el.textContent || "").trim() === ${JSON.stringify(label)});
  if (!btn) return false;
  btn.click();
  return true;
})()`);
if (!clicked) {
  console.error(`侧边栏里找不到「${label}」`);
  process.exit(1);
}
await sleep(1600);

const vp = await session.evaluate(`({ w: innerWidth, h: innerHeight })`);
const shot = await session.send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 264, y: 0, width: vp.w - 264, height: Math.min(vp.h, 900), scale: 1 },
});
await writeFile(OUT, Buffer.from(shot.data, "base64"));
console.log(`WROTE ${OUT}`);
session.close();
