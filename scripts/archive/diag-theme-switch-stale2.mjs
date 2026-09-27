// 诊断 v2：切主题后「没及时刷新」的到底是哪些东西。
// 手法：切主题 → 抓快照（此时是坏的）→ 点左下角个人中心（用户说的"补救动作"）→ 再抓快照 → diff。
// diff 出来的项 = 就是那些不会自动刷新的。
// 用法：node scripts/archive/diag-theme-switch-stale2.mjs [port]
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 抓「自带外观」可见部分的完整快照，包含 html 上所有主题相关 CSS 变量
const snapshot = () => session.evaluate(`(() => {
  const h = document.documentElement, b = document.body;
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor };
  };
  // 枚举 html 上的自定义属性（Chromium 的 CSSStyleDeclaration 会列出 --*）
  const vars = {};
  const cs = getComputedStyle(h);
  for (let i = 0; i < cs.length; i += 1) {
    const name = cs[i];
    if (name && name.startsWith("--")) {
      const v = cs.getPropertyValue(name).trim();
      if (v) vars[name] = v;
    }
  }
  const content = q(".settings-modal-overlay .settings-modal__content");
  const pane = document.getElementById(window.__anonbuddySkin.settings.paneId);
  const pcs = pane ? getComputedStyle(pane) : null;
  return {
    htmlCls: h.className,
    bodyCls: b.className,
    kind: b.getAttribute("data-vscode-theme-kind"),
    colorScheme: h.style.colorScheme,
    htmlThemeAttr: h.getAttribute("data-theme"),
    modalContent: box(content),
    modalNav: box(q(".settings-modal-overlay .settings-navigation")),
    modalHeader: box(q(".settings-modal-overlay .settings-modal__header")),
    nativePanel: box(q(".settings-modal-overlay .settings-modal__panel")),
    pane: pcs ? {
      color: pcs.color,
      varCard: pcs.getPropertyValue("--wb-pane-card").trim(),
      varText: pcs.getPropertyValue("--wb-pane-text").trim(),
      varHover: pcs.getPropertyValue("--wb-pane-hover").trim(),
      varAccent: pcs.getPropertyValue("--wb-pane-accent").trim(),
    } : null,
    firstCell: box(pane?.querySelector("[data-wb-theme-id]")),
    vars,
  };
})()`);

const shot = async (out, rect) => {
  const r = rect ?? (await session.evaluate(`(() => {
    const el = document.querySelector(".settings-modal-overlay .settings-modal__content");
    const b = el?.getBoundingClientRect();
    return b ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } : null;
  })()`));
  if (!r) return;
  const png = await session.send("Page.captureScreenshot", { format: "png", clip: { ...r, scale: 1 } });
  await writeFile(out, Buffer.from(png.data, "base64"));
  console.log("SHOT=" + out);
};

// 打开设置弹窗 + 插件面板
await session.evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
await sleep(600);
await session.evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
for (let i = 0; i < 30; i += 1) {
  if (await session.evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`)) break;
  await sleep(200);
}
await session.evaluate(`window.__anonbuddySkin.settings.open()`);
await sleep(800);

const rows = JSON.parse(await session.evaluate(
  `JSON.stringify(window.__anonbuddySkin.settings.rows().map((r) => ({ id: r.id, label: r.label })))`,
));
const light = rows.find((r) => r.id === "aisu") ?? rows.find((r) => r.id);
const dark = rows.find((r) => r.id === "wuthering-echo") ?? rows.find((r) => r.id !== light.id);

console.log(`浅色=${light.id}  深色=${dark.id}`);

// ---------- 场景 1：浅色 → 深色（最危险：面板可能变"空的"）----------
console.log("\n### 场景 1：面板里切到深色主题 ###");
await session.evaluate(`window.__anonbuddySkin.settings.clickRow(${JSON.stringify(light.id)})`);
await sleep(1200);
await session.evaluate(`window.__anonbuddySkin.settings.clickRow(${JSON.stringify(dark.id)})`);
await sleep(1500);
const broken1 = await snapshot();
await shot("outputs/verify/stale-dark-broken.png");

// 补救动作：点左下角个人中心
await session.evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
await sleep(1200);
const fixed1 = await snapshot();
await shot("outputs/verify/stale-dark-fixed.png");
// 关掉浮层
await session.evaluate(`(() => {
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(500);

const diff = (a, b, tag) => {
  console.log(`\n--- ${tag}：切主题后 vs 点个人中心后 ---`);
  let n = 0;
  const walk = (pa, pb, path) => {
    const keys = new Set([...Object.keys(pa ?? {}), ...Object.keys(pb ?? {})]);
    for (const k of keys) {
      const va = pa?.[k], vb = pb?.[k];
      const sa = typeof va === "object" && va ? JSON.stringify(va) : va;
      const sb = typeof vb === "object" && vb ? JSON.stringify(vb) : vb;
      if (sa === sb) continue;
      if (va && typeof va === "object" && !Array.isArray(va)) walk(va, vb, `${path}${k}.`);
      else { console.log(`  ✗ ${path}${k}: ${sa}  ->  ${sb}`); n += 1; }
    }
  };
  walk(a, b, "");
  if (!n) console.log("  （无差异 —— 说明这套状态本来就会自动刷新）");
};

diff(broken1, fixed1, "深色");

// ---------- 场景 2：深色 → 浅色 ----------
console.log("\n### 场景 2：面板里切回浅色主题 ###");
await session.evaluate(`window.__anonbuddySkin.settings.clickRow(${JSON.stringify(light.id)})`);
await sleep(1500);
const broken2 = await snapshot();
await shot("outputs/verify/stale-light-broken.png");
await session.evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
await sleep(1200);
const fixed2 = await snapshot();
diff(broken2, fixed2, "浅色");

// 收尾
await session.evaluate(`(() => {
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(300);
for (const type of ["keyDown", "keyUp"]) {
  await session.send("Input.dispatchKeyEvent", {
    type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  });
}
await sleep(500);
console.log("\nCLOSED=" + (await session.evaluate(`!document.querySelector(".settings-modal-overlay")`)));
session.close();
