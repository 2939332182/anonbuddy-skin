// 生成 🎨 面板演示截图：面板 + 右键菜单，只截皮肤 UI，不带用户会话内容
// 用法：node scripts/shot-menu.mjs [port] [out] [rowSelector]
//   rowSelector: custom | disk   （右键哪一行，默认 custom）
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const OUT = process.argv[3] || "outputs/verify-menu/menu-demo.png";
const WHICH = process.argv[4] || "custom";
const MENU_ID = "workbuddy-skin-menu";
const CTX_ID = `${MENU_ID}-row-menu`;

const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = await session.evaluate(`(() => {
  const panel = document.querySelector("#${MENU_ID} > div");
  panel.style.display = "block";
  const rows = [...panel.children].filter((el) => el.__themeId !== undefined);
  const customIds = window.__workbuddySkin.customThemes().map((t) => t.id);
  const target = ${JSON.stringify(WHICH)} === "disk"
    ? rows.find((el) => !customIds.includes(el.__themeId) && el.__themeId)
    : rows.filter((el) => customIds.includes(el.__themeId)).pop() ?? rows.find((el) => customIds.includes(el.__themeId));
  const r = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.right - 24, clientY: r.bottom - 4 }));
  return {
    target: target.__text.textContent,
    customCount: customIds.length,
    menuItems: [...document.getElementById("${CTX_ID}").children].map((el) => el.textContent),
  };
})()`);
console.log("STATE=" + JSON.stringify(state));
await sleep(250);

const rect = await session.evaluate(`(() => {
  const root = document.getElementById("${MENU_ID}");
  const boxes = [
    root.getBoundingClientRect(),
    ...["button", ":scope > div", "#${CTX_ID}"].map((sel) => root.querySelector(sel)?.getBoundingClientRect()).filter(Boolean),
  ];
  // 面板与右键菜单都是 absolute/fixed 定位，不在 root 的盒模型里，必须取并集
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.right)), bottom = Math.max(...boxes.map((b) => b.bottom));
  return { x: Math.floor(x) - 14, y: Math.floor(y) - 14, width: Math.ceil(right - x) + 28, height: Math.ceil(bottom - y) + 28 };
})()`);

const shot = await session.send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 2 } });
await writeFile(OUT, Buffer.from(shot.data, "base64"));
console.log(`WROTE ${OUT}  clip=${JSON.stringify(rect)}`);

const cleanup = await session.evaluate(`(() => {
  document.getElementById("${CTX_ID}").style.display = "none";
  document.querySelector("#${MENU_ID} > div").style.display = "none";
  return true;
})()`);
console.log("CLEANUP=" + cleanup);
session.close();
