// 从 miku-488137 的初音图派生一张"浅色版"，作为 miku-light 的背景图。
// 借 WorkBuddy renderer 的 Chromium 做解码 / 调色 / webp 编码，零外部依赖。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.env.WB_CDP_PORT || process.argv[3] || 9333);
const SRC = "D:/workbuddy-skin-studio/themes/miku-488137/hero.webp";
const DST = "D:/workbuddy-skin-studio/themes/miku-light/hero.webp";
const FILTER = process.argv[2] || "brightness(1.24) saturate(0.80) contrast(0.95)";
const WASH = 0.10;

const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();

const dataUrl = "data:image/webp;base64," + readFileSync(SRC).toString("base64");
const expr = `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(dataUrl)};
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.filter = ${JSON.stringify(FILTER)};
  ctx.drawImage(img, 0, 0);
  ctx.filter = "none";
  ctx.fillStyle = "rgba(255,255,255,${WASH})";
  ctx.fillRect(0, 0, c.width, c.height);
  return { url: c.toDataURL("image/webp", 0.92), w: c.width, h: c.height };
})()`;

const r = await s.evaluate(expr);
s.close();

if (!r?.url || !r.url.startsWith("data:image/webp")) {
  throw new Error("renderer did not return webp data");
}

if (existsSync(DST)) copyFileSync(DST, DST + ".bak-duplicate");
writeFileSync(DST, Buffer.from(r.url.replace(/^data:image\/webp;base64,/, ""), "base64"));

console.log("filter = " + FILTER + "  wash = " + WASH);
console.log("size   = " + r.w + "x" + r.h);
console.log("bytes  = " + readFileSync(SRC).length + " (src) -> " + readFileSync(DST).length + " (dst)");
console.log("backup = " + DST + ".bak-duplicate");
