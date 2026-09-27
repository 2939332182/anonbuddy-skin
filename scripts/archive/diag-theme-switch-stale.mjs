// 诊断：在插件设置面板里切主题时，哪些"自带外观"相关的东西没有及时刷新。
// 用法：node scripts/archive/diag-theme-switch-stale.mjs [port]
import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const snapshot = () => session.evaluate(`(() => {
  const h = document.documentElement, b = document.body;
  const content = document.querySelector(".settings-modal-overlay .settings-modal__content");
  const pane = document.getElementById(window.__anonbuddySkin.settings.paneId);
  const firstCell = pane?.querySelector("[data-wb-theme-id]");
  const cellBg = firstCell ? getComputedStyle(firstCell).backgroundColor : null;
  return {
    skin: h.dataset.anonbuddySkin ?? null,
    skinIsDarkByClasses: /vscode-dark/.test(b.className),
    kind: b.getAttribute("data-vscode-theme-kind"),
    dataSkin: h.getAttribute("data-skin"),
    htmlThemeAttr: h.getAttribute("data-theme"),
    colorScheme: h.style.colorScheme,
    // 设置弹窗（自带外观的可见部分）
    modalComputedBg: content ? getComputedStyle(content).backgroundColor : null,
    modalInlineBg: content ? (content.style.backgroundColor || null) : null,
    modalPaneSurfaceFlag: content ? (content.dataset.wbPaneSurface ?? null) : null,
    modalTextColor: content ? getComputedStyle(content).color : null,
    // 我们的面板变量
    paneVarCard: pane ? getComputedStyle(pane).getPropertyValue("--wb-pane-card").trim() : null,
    paneVarText: pane ? getComputedStyle(pane).getPropertyValue("--wb-pane-text").trim() : null,
    paneVarHover: pane ? getComputedStyle(pane).getPropertyValue("--wb-pane-hover").trim() : null,
    paneCellBg: cellBg,
    // 面板本身的底色（受 --wb-pane-card 影响）
    paneComputedColor: pane ? getComputedStyle(pane).color : null,
  };
})()`);

// 打开原生设置弹窗
await session.evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
await sleep(600);
await session.evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
for (let i = 0; i < 30; i += 1) {
  if (await session.evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`)) break;
  await sleep(200);
}
await session.evaluate(`window.__anonbuddySkin.settings.open()`);
await sleep(700);

const themes = await session.evaluate(`JSON.stringify(window.__anonbuddySkin.settings.rows().map((r) => ({ id: r.id, label: r.label })))`);
console.log("THEMES=" + themes);
const rows = JSON.parse(themes);
const light = rows.find((r) => /Miku 488137/i.test(r.label ?? "")) ?? rows.find((r) => r.id);
const dark = rows.find((r) => r.id === "wuthering-echo") ?? rows.find((r) => r.id !== light.id);

console.log("\n=== A. 切到深色主题（面板里点行）===");
await session.evaluate(`window.__anonbuddySkin.settings.clickRow(${JSON.stringify(dark.id)})`);
await sleep(1400);
const a = await snapshot();
console.log(JSON.stringify(a, null, 1));

console.log("\n=== B. 在面板里切到浅色主题 ===");
await session.evaluate(`window.__anonbuddySkin.settings.clickRow(${JSON.stringify(light.id)})`);
await sleep(1400);
const b = await snapshot();
console.log(JSON.stringify(b, null, 1));

console.log("\n=== 差异（A -> B）===");
for (const k of Object.keys(a)) {
  if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(`  ${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`);
}

console.log("\n=== C. 关掉面板再重开（模拟「再点一次才正常」）===");
await session.evaluate(`window.__anonbuddySkin.settings.close()`);
await sleep(300);
await session.evaluate(`window.__anonbuddySkin.settings.open()`);
await sleep(900);
const c = await snapshot();
console.log(JSON.stringify(c, null, 1));

console.log("\n=== B vs C 差异（重开后才修好的项）===");
for (const k of Object.keys(b)) {
  if (JSON.stringify(b[k]) !== JSON.stringify(c[k])) console.log(`  ${k}: ${JSON.stringify(b[k])} -> ${JSON.stringify(c[k])}`);
}

// 收尾：Esc 关弹窗
for (const type of ["keyDown", "keyUp"]) {
  await session.send("Input.dispatchKeyEvent", {
    type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  });
}
await sleep(500);
console.log("\nCLOSED=" + (await session.evaluate(`!document.querySelector(".settings-modal-overlay")`)));
session.close();
