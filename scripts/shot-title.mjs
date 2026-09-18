// 截图：欢迎页主标题 + 侧边栏应用名（换肤后）
// 用法：node scripts/shot-title.mjs <输出前缀> [port]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const prefix = process.argv[2] || "outputs/verify-title/shot";
const PORT = Number(process.argv[3] || 9333);
await mkdir(join(prefix, ".."), { recursive: true });

const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

// 确保在新建任务页
await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1800));

const shoot = async (name, clip) => {
  const params = { format: "png", captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: 2 };
  const result = await session.send("Page.captureScreenshot", params);
  const file = `${prefix}-${name}.png`;
  await writeFile(file, Buffer.from(result.data, "base64"));
  console.log("saved " + file);
};

// 整页
await shoot("full");
// 标题特写
const box = await session.evaluate(`(() => {
  const el = document.querySelector(".wb-home-header__title");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.left - 60), y: Math.max(0, r.top - 40), width: r.width + 120, height: r.height + 80 };
})()`);
if (box) await shoot("title", box);
// 侧边栏 logo
const logo = await session.evaluate(`(() => {
  const el = document.querySelector(".conversation-list-logo");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.left - 20), y: Math.max(0, r.top - 14), width: r.width + 180, height: r.height + 28 };
})()`);
if (logo) await shoot("logo", logo);

session.close();
