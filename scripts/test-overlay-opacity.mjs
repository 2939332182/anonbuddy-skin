// 回归测试：浮层（个人中心菜单 / 下拉 / 右键菜单）必须有实底
// 用法：node scripts/test-overlay-opacity.mjs [port]
// 背景：皮肤里有一条 "body 的直接子节点一律透明" 的规则（为了让背景图透出），
// 但 React portal 的浮层也挂在 body 下，会被一起弄透明 —— 个人中心菜单就糊了。
// 现在那条规则排除了浮层，浮层再统一给主题实色。这个测试盯着这两点。

import { createHarness } from "./_harness.mjs";
const t = await createHarness({ name: "test-overlay-opacity" });
const { session, sleep, waitFor, check } = t;

const evaluate = t.evaluate;
const ALPHA_FN = `(v) => { const c = String(v); let m = /^rgba?\\(([^)]+)\\)$/.exec(c); if (m) { const p = m[1].split(",").map((x) => x.trim()); return p.length > 3 ? Number(p[3]) : 1; } m = /^color\\(srgb\\s+[\\d.]+\\s+[\\d.]+\\s+[\\d.]+\\s*\\/\\s*([\\d.]+)\\)$/.exec(c); if (m) return Number(m[1]); return c === "transparent" ? 0 : 1; }`;

const wasOpen = await evaluate(`!!document.querySelector(".user-menu-popover")`);
let openedByUs = false;

try {
  // ---- 外壳容器仍然要透明（背景图靠它们透出来） ----
  const shell = await evaluate(`(() => {
    const alphaOf = ${ALPHA_FN};
    return ["workbuddy-menubar-container", "root", "workbuddy-titlebar-left-slot", "workbuddy-window-controls-container"]
      .map((id) => { const el = document.getElementById(id); return el ? { id, alpha: alphaOf(getComputedStyle(el).backgroundColor) } : null; })
      .filter(Boolean);
  })()`);
  for (const s of shell) t.check(`外壳 ${s.id} 保持透明`, s.alpha === 0, String(s.alpha));

  // ---- 打开个人中心菜单 ----
  if (!wasOpen) {
    await evaluate(`(() => { const el = document.querySelector(".user-menu-trigger"); if (el) el.click(); return true; })()`);
    openedByUs = true;
    await sleep(900);
  }

  const popover = await evaluate(`(() => {
    const alphaOf = ${ALPHA_FN};
    const el = document.querySelector(".user-menu-popover");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return { alpha: alphaOf(cs.backgroundColor), bg: cs.backgroundColor, w: Math.round(b.width), h: Math.round(b.height) };
  })()`);
  if (!popover) {
    t.check("个人中心菜单已弹出", false, "找不到 .user-menu-popover");
  } else {
    t.check("个人中心菜单已弹出", popover.w > 100 && popover.h > 100, `${popover.w}×${popover.h}`);
    t.check("菜单背景不透明（文字不会与后方内容混淆）", popover.alpha >= 0.95, `${popover.bg} alpha=${popover.alpha}`);
  }

  // ---- 样式表里那条透明规则必须排除浮层 ----
  const css = await evaluate(`document.getElementById("workbuddy-skin-style")?.textContent ?? ""`);
  t.check("透明规则排除了 popover", css.includes(`body > :not(#workbuddy-skin-menu):not([class*="popover"])`));
  t.check("透明规则排除了 modal / dialog / context-menu",
    css.includes(`:not([class*="modal"])`) && css.includes(`:not([class*="dialog"])`) && css.includes(`:not([class*="context-menu"])`));
  t.check("样式表含浮层实底规则", css.includes(".user-menu-popover") && css.includes("--wb-glass) 42%, var(--wb-surface)"));
} finally {
  // 只关掉我们自己打开的菜单，不动用户原本的状态
  if (openedByUs) {
    await evaluate(`(() => {
      const el = document.querySelector(".user-menu-popover");
      if (el) { const trigger = document.querySelector(".user-menu-trigger"); if (trigger) trigger.click(); }
      return true;
    })()`);
    await sleep(500);
    const stillOpen = await evaluate(`!!document.querySelector(".user-menu-popover")`);
    if (stillOpen) {
      await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
      await sleep(400);
    }
    t.check("收尾：菜单已关闭", !(await evaluate(`!!document.querySelector(".user-menu-popover")`)));
  } else {
    console.log("SKIP  菜单本来就是打开的，保持原样");
  }
  session.close();
}


await t.finish();
