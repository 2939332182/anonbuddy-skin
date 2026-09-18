// 生成「右键重命名」演示截图：只截 🎨 图标 + 面板区域，不带用户会话内容
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const OUT = process.argv[3] || "outputs/verify-rename/rename-demo.png";
const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 展开面板 + 对「自定义主题行」发起重命名（名字最长，最像真实使用场景）
const info = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  panel.style.display = "block";
  const el = [...panel.children].find((n) => n.__themeId === "custom-upload") ?? [...panel.children].find((n) => n.__themeId);
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const input = panel.querySelector("input[type=text]");
  input.value = "爱素 · 夕阳";
  input.focus();
  input.select();
  return { label: el.__defaultLabel, editing: !!input };
})()`);
console.log("STATE=" + JSON.stringify(info));
await sleep(250);

const rect = await session.evaluate(`(() => {
  const root = document.getElementById("workbuddy-skin-menu");
  const boxes = [root.getBoundingClientRect(), ...["button", ":scope > div"].map((sel) => root.querySelector(sel)?.getBoundingClientRect()).filter(Boolean)];
  // 面板是 absolute 定位，不在 root 的盒模型里，必须取并集
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.right)), bottom = Math.max(...boxes.map((b) => b.bottom));
  return { x: Math.floor(x) - 12, y: Math.floor(y) - 12, w: Math.ceil(right - x) + 24, h: Math.ceil(bottom - y) + 24 };
})()`);

const shot = await session.send("Page.captureScreenshot", {
  format: "png",
  clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 },
});
await writeFile(OUT, Buffer.from(shot.data, "base64"));
console.log(`WROTE ${OUT}  clip=${JSON.stringify(rect)}`);

// 收尾：显式撤销演示别名（不能只靠 Esc —— 面板隐藏会触发 blur，而 blur 是「保存」）
const cleanup = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  const input = panel.querySelector("input[type=text]");
  if (input) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.__workbuddySkin.renameTheme(${JSON.stringify(process.env.DEMO_THEME_ID || "custom-upload")}, "");
  panel.style.display = "none";
  return { aliases: window.__workbuddySkin.aliases(), stored: localStorage.getItem("workbuddySkinAliases") };
})()`);
console.log("CLEANUP=" + JSON.stringify(cleanup));
session.close();
