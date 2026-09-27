// 回归测试：浮层（个人中心菜单 / 下拉 / 右键菜单）的文字可读性。
// 用法：node scripts/test-popover-contrast.mjs [port]
//
// 背景（2026-09-19 踩的大坑）：
//   皮肤给 `.user-menu-popover` 换了底色（深色主题下是 #1a1e2a 这种暗色），
//   但**浮层里的文字色一直是原生的 rgb(0,0,0)** —— 黑字压暗底，对比度只有 1.26:1。
//   表现：深黑色主题下点开左下角「个人中心」，整个菜单看着像没渲染出来。
//   浅色主题下黑字刚好压浅底，所以这个 bug 只在深色主题暴露 ——
//   **这就是"只在深黑主题下才复现"的原因**。
//
// 这个测试的关键点是**遍历所有主题**：内置 + 自定义都跑一遍，
// 保证"以后上传的任何深黑色主题"都不会再踩同一个坑。
//
// 注意：主题的 surface/text 是主题作者给的，两者可能都偏暗。
// 因此这里断言的是"实际渲染出来的对比度"，而不是"用了某个变量"。

import { createHarness } from "./_harness.mjs";

const t = await createHarness({ name: "test-popover-contrast" });
const { evaluate, sleep, waitFor, check, send } = t;

const WCAG_AA = 4.5;

// ---- 打开/关闭个人中心菜单 ----
// 必须用真实鼠标事件：该浮层由组件内部状态控制，DOM .click() 不一定触发。
const triggerPoint = () =>
  evaluate(`(() => {
    const el = document.querySelector(".user-menu-trigger");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);

const clickTrigger = async () => {
  const point = await triggerPoint();
  if (!point) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
  }
  return true;
};

const closeMenu = async () => {
  if (!(await evaluate(`Boolean(document.querySelector(".user-menu-popover"))`))) return true;
  await clickTrigger();
  const closed = await waitFor(
    () => evaluate(`!document.querySelector(".user-menu-popover")`),
    { waitMs: 2500, stepMs: 150 },
  );
  if (closed === true) return true;
  // 兜底：对 body 派发 pointerdown（原生点外部会关）
  await evaluate(`(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  return (await waitFor(
    () => evaluate(`!document.querySelector(".user-menu-popover")`),
    { waitMs: 2000, stepMs: 150 },
  )) === true;
};

const openMenu = async () => {
  await closeMenu();
  if (!(await clickTrigger())) return { error: "找不到个人中心入口" };
  const opened = await waitFor(
    () => evaluate(`Boolean(document.querySelector(".user-menu-popover"))`),
    { waitMs: 5000, stepMs: 200 },
  );
  return { opened: opened === true };
};

// 量浮层里所有可见文字的实际对比度：把前景按 alpha 合成到浮层实底上再算。
const MEASURE = `(() => {
  const parse = (c) => {
    let m = /rgba?\\(([0-9.]+), ([0-9.]+), ([0-9.]+)(?:, ([0-9.]+))?\\)/.exec(c || "");
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = /color\\(srgb ([0-9.]+) ([0-9.]+) ([0-9.]+)(?: \\/ ([0-9.]+))?\\)/.exec(c || "");
    if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  const lum = (c) => {
    const a = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const ratio = (f, b) => {
    const l1 = lum(f), l2 = lum(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const composite = (f, b) => f[3] >= 1 ? f.slice(0, 3) : [0, 1, 2].map((i) => Math.round(f[i] * f[3] + b[i] * (1 - f[3])));

  const pop = document.querySelector(".user-menu-popover");
  if (!pop) return { noPopover: true };
  const popBg = parse(getComputedStyle(pop).backgroundColor);
  if (!popBg) return { noBg: true };

  const rows = [];
  const SEL = ".user-menu-item-label, .user-menu-header-name-text, .user-menu-item-value, .user-menu-theme-option";
  for (const el of pop.querySelectorAll(SEL)) {
    const text = (el.textContent || "").trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    rows.push({
      text: text.slice(0, 12),
      fg: cs.color,
      ratio: Math.round(ratio(composite(fg, popBg), popBg) * 100) / 100,
    });
  }
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return { popBg: getComputedStyle(pop).backgroundColor, popBgHex: hex(popBg), rows };
})()`;

// ---- 前置：皮肤必须在装 ----
await t.applyLast();
await evaluate(`(() => { [...document.querySelectorAll("[data-view-id=sidebar] button")].find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click(); return true; })()`);
await sleep(1200);

const hasApi = await evaluate(`Boolean(window.__anonbuddySkin)`);
check("注入脚本 API 存在（皮肤已装载）", hasApi === true, String(hasApi));

const dataThemeIds = await t.loadMenuThemes().then((tms) => tms.map((m) => m.manifest.id));
check("读到磁盘上的内置主题", dataThemeIds.length >= 1, JSON.stringify(dataThemeIds));

// 自定义主题要从面板 DOM 里读（不在磁盘上）。
// 面板没打开时读不到，所以先走一遍「个人中心 → 设置 → ChihayaAnon 插件」把它开出来 ——
// **自定义主题才是"用户以后自己上传的深黑色主题"，必须纳入覆盖。**
const readCustomIds = () => evaluate(`(() => {
  const raw = [...document.querySelectorAll("[data-wb-theme-id]")].map((el) => el.dataset.wbThemeId);
  return [...new Set(raw)].filter((id) => id && id !== "native" && id.startsWith("custom-"));
})()`);

let customIds = await readCustomIds();
if (customIds.length === 0) {
  if (!(await evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`))) {
    await evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
    await sleep(500);
    await evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
    await waitFor(
      () => evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`),
      { waitMs: 6000, stepMs: 200 },
    );
  }
  if (await evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`)) {
    await evaluate(`document.getElementById("anonbuddy-skin-menu-settings-entry")?.click()`);
    await sleep(600);
    customIds = await readCustomIds();
  }
  // 收尾：把设置弹窗关掉（全屏遮罩，留着会盖住个人中心入口）
  if (await evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`)) {
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", {
        type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
      });
    }
    let closed = await waitFor(
      () => evaluate(`!document.querySelector(".settings-modal-overlay")`),
      { waitMs: 3000, stepMs: 150 },
    );
    if (closed !== true) {
      await evaluate(`(() => {
        const ov = document.querySelector(".settings-modal-overlay");
        if (ov) ov.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        return true;
      })()`);
      await waitFor(
        () => evaluate(`!document.querySelector(".settings-modal-overlay")`),
        { waitMs: 2000, stepMs: 150 },
      );
    }
  }
}

const allThemeIds = [...dataThemeIds, ...customIds];
check("待测主题清单非空（内置 + 自定义）", allThemeIds.length >= 1, JSON.stringify(allThemeIds));
// 没有自定义主题不是缺陷，只是用户还没上传过。
// 下面的循环会把它们一并纳入；这里只确认"有就一定测"。
check(
  "自定义主题也被纳入覆盖（用户上传的深色主题最容易踩坑）",
  true,
  customIds.length ? `${customIds.length} 个: ${JSON.stringify(customIds)}` : "本机没有自定义主题，跳过",
);

const initialTheme = await t.currentThemeId();
const results = [];

for (const id of allThemeIds) {
  const applied = await evaluate(`(() => {
    window.__anonbuddySkin.setTheme(${JSON.stringify(id)});
    return document.documentElement.dataset.anonbuddySkin;
  })()`);
  await sleep(500);

  const openResult = await openMenu();
  if (openResult.error || openResult.opened !== true) {
    results.push({ id, ok: false, why: "菜单打不开", detail: JSON.stringify(openResult) });
    continue;
  }

  const measured = await evaluate(MEASURE);
  await closeMenu();

  if (measured.noPopover || measured.noBg) {
    results.push({ id, ok: false, why: "浮层/底色读不到", detail: JSON.stringify(measured) });
    continue;
  }

  const worst = measured.rows.length ? Math.min(...measured.rows.map((r) => r.ratio)) : null;
  const bad = measured.rows.filter((r) => r.ratio < WCAG_AA);
  results.push({
    id,
    applied: applied === id,
    popBg: measured.popBgHex,
    rows: measured.rows.length,
    worst,
    bad: bad.map((r) => `${r.text}=${r.ratio}`),
    ok: measured.rows.length > 0 && bad.length === 0,
  });
}

// 汇总：逐主题报告（一个断言一项，便于一眼看出是哪个主题挂了）
for (const r of results) {
  if (r.why) {
    check(`主题 ${r.id}：能打开个人中心菜单并测到文字`, false, `${r.why} ${r.detail}`);
    continue;
  }
  check(
    `主题 ${r.id}：${r.rows} 处文字全部 ≥ ${WCAG_AA}:1（底色 ${r.popBg}）`,
    r.ok,
    r.ok ? `最差 ${r.worst}` : `不达标 -> ${r.bad.join(", ")}`,
  );
}

// 单独把"深色主题"钉出来 —— 这正是用户报的那个场景
const darkOnes = results.filter((r) => !r.why && r.popBg && parseInt(r.popBg.slice(1), 16) < 0x808080 * 1);
const darkAtRisk = darkOnes.filter((r) => !r.ok);
check(
  "深色底浮层没有出现黑字压暗底（本次 bug 的形态）",
  darkAtRisk.length === 0,
  darkAtRisk.length ? darkAtRisk.map((r) => `${r.id}(${r.popBg})`).join(", ") : `深色底主题 ${darkOnes.length} 个均达标`,
);

// ---- 收尾 ----
const finalPopoverClosed = await closeMenu();
check("收尾：个人中心菜单已关闭", finalPopoverClosed === true, String(finalPopoverClosed));

if (initialTheme) {
  await evaluate(`window.__anonbuddySkin.setTheme(${JSON.stringify(initialTheme)})`);
  await sleep(400);
}
const restored = await t.currentThemeId();
check("收尾：激活主题已还原", restored === (initialTheme ?? null), `${restored} vs ${initialTheme}`);

await t.finish();
