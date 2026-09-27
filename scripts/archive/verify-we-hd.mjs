// 验证：选中一个 scene 壁纸后，解出来的 4K 贴图是否**真的成了背景**（不只是 payload 里有字段）。
// 用法：node scripts/archive/verify-we-hd.mjs [port]
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const s = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await s.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pickRaw = await s.evaluate(`(() => {
  const it = window.__anonbuddySkin.we.items().find((x) => x.heroUrl && x.kind !== "video");
  return it ? JSON.stringify({ id: it.id, title: it.title, hero: it.heroUrl, size: it.heroSize }) : null;
})()`);
if (!pickRaw || pickRaw === "null") {
  console.log("没有带 heroUrl 的静态条目 —— 先跑 npm run we:extract");
  s.close();
  process.exit(0);
}
const item = JSON.parse(pickRaw);
console.log("选中条目:", item.title, "| 尺寸:", JSON.stringify(item.size));
console.log("heroUrl:", item.hero.slice(0, 100));

await s.evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(item.id)})`);
await sleep(2500);

const state = await s.evaluate(`(() => {
  const layer = document.getElementById("anonbuddy-skin-bg");
  const bg = getComputedStyle(layer).backgroundImage;
  const hero = ${JSON.stringify(item.hero)};
  return JSON.stringify({
    theme: document.documentElement.dataset.anonbuddySkin,
    active: window.__anonbuddySkin.we.active(),
    usesHero: bg.includes(hero),
    usesPreview: bg.includes("preview."),
    bgTail: bg.slice(-70),
  });
})()`);
console.log("应用后:", state);

const png = await s.send("Page.captureScreenshot", { format: "png" });
await writeFile("outputs/verify/we-scene-4k.png", Buffer.from(png.data, "base64"));
console.log("SHOT=outputs/verify/we-scene-4k.png");
s.close();
