// 截 WE 面板。⚠️ 背景层有 <video> 时 Page.captureScreenshot 会卡住（实测），
// 所以截图前先把视频临时隐藏（面板是不透明的，隐藏视频不影响面板观感）。
import { writeFile } from "node:fs/promises";
import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";
const s = new CdpSession((await fetchRendererTargets(Number(process.argv[2]||9333)))[0].webSocketDebuggerUrl);
await s.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await s.evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
await sleep(600);
await s.evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
await sleep(2600);
await s.evaluate(`window.__anonbuddySkin.settings.open()`);
await sleep(1400);
const rect = JSON.parse(await s.evaluate(`(() => { const p = document.getElementById(window.__anonbuddySkin.settings.paneId); const b = p.getBoundingClientRect(); return JSON.stringify({x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}); })()`));
// 隐藏视频再截
await s.evaluate(`(() => { const v = document.querySelector("#anonbuddy-skin-bg > video"); if (v) v.style.visibility = "hidden"; const pane = document.getElementById(window.__anonbuddySkin.settings.paneId); for (const el of pane.querySelectorAll("*")) { const oy = getComputedStyle(el).overflowY; if (oy === "auto" || oy === "scroll") el.scrollTop = el.scrollHeight; } return true; })()`);
await sleep(800);
const png = await s.send("Page.captureScreenshot", { format: "png", clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 } });
await writeFile("outputs/verify/we-pane.png", Buffer.from(png.data, "base64"));
console.log("SHOT=outputs/verify/we-pane.png");
await s.evaluate(`(() => { const v = document.querySelector("#anonbuddy-skin-bg > video"); if (v) v.style.visibility = ""; return true; })()`);
for (const type of ["keyDown","keyUp"]) await s.send("Input.dispatchKeyEvent", { type, key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27 });
s.close();
