// 诊断：背景模糊「计算样式对了但视觉没变化」，以及切主题后背景图消失。
// 手法：像素级对照 —— 同一屏在不同模糊值下截图，比较字节是否真的不同。
// 用法：node scripts/archive/diag-bg-blur-visual.mjs [port]
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const s = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await s.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const layer = () => s.evaluate(`(() => {
  const cs = getComputedStyle(document.body, "::before");
  const url = (cs.backgroundImage.match(/url\\("([^"]{0,80})/) ?? [])[1] ?? null;
  return {
    position: cs.position,
    inset: cs.inset,
    zIndex: cs.zIndex,
    filter: cs.filter,
    display: cs.display,
    content: cs.content,
    opacity: cs.opacity,
    visibility: cs.visibility,
    width: cs.width,
    height: cs.height,
    bgCount: (cs.backgroundImage.match(/url\\(/g) ?? []).length,
    bgTail: cs.backgroundImage.slice(-60),
    bgSize: cs.backgroundSize,
    heroUrlHead: url,
    heroUrlLen: cs.backgroundImage.length,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    attr: document.body.getAttribute("data-wb-bg-blur"),
    varBg: cs.getPropertyValue("--wb-bg-blur-px").trim(),
  };
})()`);

const shotHash = async (out) => {
  const png = await s.send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(png.data, "base64");
  if (out) await writeFile(out, buf);
  return { bytes: buf.length, sha: createHash("sha256").update(buf).digest("hex").slice(0, 16) };
};

console.log("=== 1. 图层计算样式 ===");
console.log(JSON.stringify(await layer(), null, 1));

console.log("\n=== 2. 模糊值 1 vs 100 的像素对照（同一屏）===");
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 1); return true; })()`);
await sleep(600);
const l1 = await layer();
const h1 = await shotHash("outputs/verify/diag-blur-1.png");
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 100); return true; })()`);
await sleep(900);
const l100 = await layer();
const h100 = await shotHash("outputs/verify/diag-blur-100.png");
console.log("blur=1   :", JSON.stringify({ filter: l1.filter, inset: l1.inset, attr: l1.attr, varBg: l1.varBg, ...h1 }));
console.log("blur=100 :", JSON.stringify({ filter: l100.filter, inset: l100.inset, attr: l100.attr, varBg: l100.varBg, ...h100 }));
console.log("像素是否相同:", h1.sha === h100.sha ? "★ 完全相同 → 模糊没有产生任何视觉变化" : "不同 → 模糊有渲染");

console.log("\n=== 3. 侧边栏毛玻璃 1 vs 100 的像素对照 ===");
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 1); window.__anonbuddySkin.tunables.set("sidebarBlur", 1); return true; })()`);
await sleep(700);
const hs1 = await shotHash("outputs/verify/diag-glass-1.png");
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("sidebarBlur", 100); return true; })()`);
await sleep(700);
const hs100 = await shotHash("outputs/verify/diag-glass-100.png");
console.log("glass=1  :", JSON.stringify(hs1));
console.log("glass=100:", JSON.stringify(hs100));
console.log("像素是否相同:", hs1.sha === hs100.sha ? "★ 完全相同 → 毛玻璃没有产生视觉变化" : "不同 → 毛玻璃有渲染");

console.log("\n=== 4. 切主题后背景图还在吗 ===");
for (const id of ["aisu", "wuthering-echo", "genshin-dawn"]) {
  await s.evaluate(`(() => { window.__anonbuddySkin.setTheme(${JSON.stringify(id)}); return true; })()`);
  await sleep(1100);
  const l = await layer();
  console.log(`  ${id.padEnd(16)} bgCount=${l.bgCount} bgSize=${l.bgSize} bgTail=...${l.bgTail.slice(-40)}`);
}

console.log("\n=== 5. 自定义主题（上传图）背景图还在吗 ===");
const custom = await s.evaluate(`(() => {
  const list = window.__anonbuddySkin.customThemes();
  if (!list.length) return null;
  window.__anonbuddySkin.setTheme(list[0].id);
  return list[0].id;
})()`);
await sleep(1100);
const lc = await layer();
console.log(`  ${custom}: bgCount=${lc.bgCount} bgSize=${lc.bgSize} bgTail=...${lc.bgTail.slice(-40)}`);

// 收尾
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 1); window.__anonbuddySkin.tunables.set("sidebarBlur", 100); return true; })()`);
s.close();
