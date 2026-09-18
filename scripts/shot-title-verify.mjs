// 抓欢迎页主标题特写，用于人工确认打字动画后的最终视觉
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const PORT = Number(process.argv[2] || 9333);
const OUT = process.argv[3] || "outputs/verify-title";
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click();
  return true;
})()`).catch(() => {});
await new Promise((r) => setTimeout(r, 2400));
const box = await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  if (!h1) return null;
  const r = h1.getBoundingClientRect();
  return { x: Math.max(0, r.x - 50), y: Math.max(0, r.y - 40), width: r.width + 100, height: r.height + 70 };
})()`);
if (!box) { console.log("标题未挂载"); session.close(); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const shot = await session.send("Page.captureScreenshot", {
  format: "png", clip: { ...box, scale: 3 },
});
writeFileSync(OUT + "/title-final.png", Buffer.from(shot.data, "base64"));
console.log("saved " + OUT + "/title-final.png");
session.close();
