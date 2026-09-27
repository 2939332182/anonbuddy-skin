// 一次性验证脚本：截取个人中心「外观」浮层，确认深色皮肤下「浅色」被置灰禁用。
// 用法：node scripts/archive/shot-appearance-lock.mjs [port] [out]
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const OUT = process.argv[3] || "outputs/verify/appearance-lock.png";

const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = await session.evaluate(`(() => {
  const h = document.documentElement;
  return {
    theme: h.dataset.anonbuddySkin ?? null,
    lock: h.getAttribute("data-wb-appearance-lock"),
    mode: window.__anonbuddySkin?.appearance.mode() ?? null,
    kind: document.body.getAttribute("data-vscode-theme-kind"),
  };
})()`);
console.log("STATE=" + JSON.stringify(state));

// 打开个人中心浮层（真鼠标事件，DOM .click() 不触发内部状态）
const point = await session.evaluate(`(() => {
  const el = document.querySelector(".user-menu-trigger");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
for (const type of ["mousePressed", "mouseReleased"]) {
  await session.send("Input.dispatchMouseEvent", {
    type, x: point.x, y: point.y, button: "left", clickCount: 1,
    buttons: type === "mousePressed" ? 1 : 0,
  });
}
for (let i = 0; i < 20; i += 1) {
  if (await session.evaluate(`Boolean(document.querySelector(".user-menu-popover"))`)) break;
  await sleep(150);
}
await sleep(400);

const info = await session.evaluate(`(() => {
  const opts = [...document.querySelectorAll(".user-menu-popover .user-menu-theme-option")].map((e) => ({
    text: e.textContent.trim(),
    locked: e.dataset.wbLocked ?? null,
    opacity: e.style.opacity || null,
    cursor: e.style.cursor || null,
    ariaDisabled: e.getAttribute("aria-disabled"),
    title: e.getAttribute("title"),
  }));
  const pop = document.querySelector(".user-menu-popover");
  const r = pop ? pop.getBoundingClientRect() : null;
  return { opts, rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null };
})()`);
console.log("OPTIONS=" + JSON.stringify(info.opts, null, 1));

if (info.rect && info.rect.w > 0) {
  const shot = await session.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: info.rect.x, y: info.rect.y, width: info.rect.w, height: info.rect.h, scale: 1 },
  });
  await writeFile(OUT, Buffer.from(shot.data, "base64"));
  console.log("SAVED=" + OUT);
}

// 收尾：关掉浮层
await session.evaluate(`(() => {
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(400);
console.log("POPOVER_CLOSED=" + (await session.evaluate(`!document.querySelector(".user-menu-popover")`)));

session.close();
