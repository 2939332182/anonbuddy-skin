// 验证「侧边栏毛玻璃 / 背景图模糊」两个调节项，并在浅色与深色主题下各截一张图。
// 用法：node scripts/archive/verify-tunables.mjs [port]
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const s = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await s.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = () => s.evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  const el = document.querySelector("[data-view-id=sidebar]");
  const before = getComputedStyle(document.body, "::before");
  return {
    tunables: sk.tunables.get(),
    vars: sk.tunables.cssVars(),
    sidebar: el ? getComputedStyle(el).backdropFilter : null,
    bgLayerFilter: before.filter,
    bgLayerInset: before.inset,
  };
})()`);

const shot = async (out) => {
  const png = await s.send("Page.captureScreenshot", { format: "png" });
  await writeFile(out, Buffer.from(png.data, "base64"));
  console.log("SHOT=" + out);
};

// 1) 默认值：应与"没有这功能之前"观感一致
console.log("默认:", JSON.stringify(await read()));

// 2) 拉高两个值，确认像素换算与 filter 真的挂上
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 60); window.__anonbuddySkin.tunables.set("sidebarBlur", 40); return true; })()`);
await sleep(500);
console.log("拉高后:", JSON.stringify(await read()));

// 3) 浅色主题截图
await s.evaluate(`(() => { window.__anonbuddySkin.setTheme("aisu"); return true; })()`);
await sleep(1200);
console.log("浅色:", JSON.stringify(await read()));
await shot("outputs/verify/tunables-light.png");

// 4) 深色主题截图
await s.evaluate(`(() => { window.__anonbuddySkin.setTheme("wuthering-echo"); return true; })()`);
await sleep(1200);
console.log("深色:", JSON.stringify(await read()));
await shot("outputs/verify/tunables-dark.png");

// 5) 边界值：1 与 100
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 1); window.__anonbuddySkin.tunables.set("sidebarBlur", 1); return true; })()`);
await sleep(400);
console.log("最小值 1:", JSON.stringify(await read()));
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 100); window.__anonbuddySkin.tunables.set("sidebarBlur", 100); return true; })()`);
await sleep(400);
console.log("最大值 100:", JSON.stringify(await read()));

// 6) 越界输入应被 clamp
const clamped = await s.evaluate(`(() => ({
  low: window.__anonbuddySkin.tunables.set("bgBlur", -50),
  high: window.__anonbuddySkin.tunables.set("bgBlur", 9999),
  nan: window.__anonbuddySkin.tunables.set("bgBlur", "abc"),
  unknown: window.__anonbuddySkin.tunables.set("nope", 50),
}))()`);
console.log("越界 clamp:", JSON.stringify(clamped));

// 收尾：还原成默认值
await s.evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 1); window.__anonbuddySkin.tunables.set("sidebarBlur", 100); return true; })()`);
await sleep(300);
console.log("已还原默认");
s.close();
