// 一次性验证脚本：截取设置面板里「ChihayaAnon 插件」的皮肤列表（看三列网格排布）。
// 用法：node scripts/archive/shot-settings-pane.mjs [port] [out]
// 收尾会按 Esc 关掉设置弹窗（全屏遮罩留着会让别的 e2e 命不中目标）。
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const OUT = process.argv[3] || "outputs/verify/settings-pane.png";

const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 打开原生设置弹窗（个人中心 → 设置）
await session.evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
await sleep(600);
await session.evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
for (let i = 0; i < 30; i += 1) {
  if (await session.evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`)) break;
  await sleep(200);
}

const opened = await session.evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  if (!sk) return { ok: false, why: "皮肤脚本不在" };
  const ok = sk.settings.open();
  return { ok, paneId: sk.settings.paneId, rows: sk.settings.rows().length };
})()`);
console.log("OPENED=" + JSON.stringify(opened));
await sleep(500);

const rect = await session.evaluate(`(() => {
  const pane = document.getElementById(window.__anonbuddySkin.settings.paneId);
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
})()`);
console.log("RECT=" + JSON.stringify(rect));

if (rect && rect.w > 0 && rect.h > 0) {
  const shot = await session.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 },
  });
  await writeFile(OUT, Buffer.from(shot.data, "base64"));
  console.log("SAVED=" + OUT);
}

// 收尾：关掉全屏遮罩
await session.send("Input.dispatchKeyEvent", {
  type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
});
await session.send("Input.dispatchKeyEvent", {
  type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
});
await sleep(400);
console.log("CLOSED=" + (await session.evaluate(`!document.querySelector(".settings-modal-overlay")`)));

session.close();
