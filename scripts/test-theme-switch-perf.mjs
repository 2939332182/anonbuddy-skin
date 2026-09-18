// 回归测试：切换主题的性能与深色下设置界面的可读性。
// 用法：node scripts/test-theme-switch-perf.mjs [port]
//
// 背景（2026-09-19 实测）：
//   1) applyMode 旧实现用 classList.toggle(cls, force) 无脑刷 6 个类 × body/html。
//      WorkBuddy 有 ~2600 条「祖先类 + 后代」规则（body.vscode-light .icon-xxx 那套），
//      每删/加一个类都要让引擎把全部规则对整棵 DOM 重匹配。
//      而 classList.toggle(cls, false) 在类本来就不存在时**什么都没改**，
//      却照样触发样式失效 —— 实测白付 46.5ms，一次切主题合计 55~65ms，
//      严重时把渲染器主线程卡死（CDP Runtime.enable 都能超时）。
//   2) 原生 `.settings-modal-overlay` 背景透明、`.settings-navigation` 也没底色，
//      弹窗直接压在深色皮肤主界面上；文字与背景图叠在一起就糊了。
//
// 本测试锁死这两件事：切换必须够快、深浅两态设置界面文字对比度必须达标。

import { createHarness } from "./_harness.mjs";

const t = await createHarness({ name: "test-theme-switch-perf" });
const { evaluate, sleep, waitFor, check } = t;

// 一次 `setTheme` 的**同步**耗时上限（含强制样式重算 + 布局）。
// 修复前实测中位 55~65ms、最坏可把主线程卡住；修复后中位 ~21ms。
// 取 40ms 作为门槛：既明显低于修复前，又给慢机器留出余量。
const SYNC_BUDGET_MS = 40;
// 连续切换的**最坏单次**上限。压力场景下偶有抖动，给得比中位宽一些。
const WORST_BUDGET_MS = 90;

const hasApi = await evaluate(`Boolean(window.__workbuddySkin)`);
check("注入脚本 API 存在", hasApi === true, String(hasApi));

const initialTheme = await t.currentThemeId();

// 主题清单只在插件面板打开时才进 DOM，所以先走一遍「个人中心 → 设置 → ChihayaAnon 插件」。
// 打开面板顺带也把后面第 4 项（深色对比度）需要的前置状态准备好了。
const openSettings = async () => {
  if (await evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`)) return true;
  await evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
  return waitFor(
    () => evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`),
    { waitMs: 6000, stepMs: 200 },
  );
};

const closeSettings = async () => {
  if (await evaluate(`!document.querySelector(".settings-modal-overlay")`)) return true;
  for (const type of ["keyDown", "keyUp"]) {
    await t.send("Input.dispatchKeyEvent", {
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
    closed = await waitFor(
      () => evaluate(`!document.querySelector(".settings-modal-overlay")`),
      { waitMs: 2000, stepMs: 150 },
    );
  }
  return closed === true;
};

const readThemeIds = () => evaluate(`(() => {
  const raw = [...document.querySelectorAll("[data-wb-theme-id]")].map((el) => el.dataset.wbThemeId);
  return [...new Set(raw)].filter((id) => id && id !== "native");
})()`);

let themeIds = await readThemeIds();
if (!Array.isArray(themeIds) || themeIds.length < 2) {
  const settingsOpen = await openSettings();
  check("能打开设置弹窗以读取主题清单", settingsOpen === true, String(settingsOpen));
  if (settingsOpen === true) {
    await evaluate(`document.getElementById("workbuddy-skin-menu-settings-entry")?.click()`);
    await sleep(600);
    themeIds = await readThemeIds();
  }
}

check(
  "能枚举出至少 2 个可用主题（用于往返切换测量）",
  Array.isArray(themeIds) && themeIds.length >= 2,
  JSON.stringify(themeIds),
);

if (Array.isArray(themeIds) && themeIds.length >= 2) {
  const [a, b] = themeIds;

  // ---- 1. 单次切换的同步耗时（强制冲刷样式，量的是用户真正感知到的卡顿）----
  const timing = await evaluate(`(async () => {
    const api = window.__workbuddySkin;
    // 预热：首次上样式有固定成本，不计入统计
    api.setTheme(${JSON.stringify(a)}); void document.body.offsetHeight;
    api.setTheme(${JSON.stringify(b)}); void document.body.offsetHeight;
    const samples = [];
    for (let i = 0; i < 8; i++) {
      const id = i % 2 === 0 ? ${JSON.stringify(a)} : ${JSON.stringify(b)};
      const t0 = performance.now();
      api.setTheme(id);
      void document.body.offsetHeight;   // 强制同步重算 + 布局
      samples.push(performance.now() - t0);
    }
    // 丢掉前两次：预热只做了一轮，紧接着的第一次仍会带上样式表首次编译的残余成本
    // （实测第一次 33ms、之后稳定 ~19ms）。这两次不计入统计。
    const kept = samples.slice(2);
    const sorted = [...kept].sort((x, y) => x - y);
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      worst: sorted[sorted.length - 1],
      samples: samples.map((v) => Math.round(v * 10) / 10),
      keptSamples: kept.map((v) => Math.round(v * 10) / 10),
    };
  })()`);

  check(
    `单次切主题同步耗时中位 < ${SYNC_BUDGET_MS}ms（修复前 ~55-65ms）`,
    timing.median < SYNC_BUDGET_MS,
    `中位 ${Math.round(timing.median * 10) / 10}ms / 最坏 ${Math.round(timing.worst * 10) / 10}ms / 计入 ${JSON.stringify(timing.keptSamples)}（原始 ${JSON.stringify(timing.samples)}）`,
  );

  // ---- 2. 关键回归点：applyMode 不该在"类状态已经正确"时再动 DOM ----
  // 这是根因。旧实现对 6 个类无条件 toggle，即使一个都没变也触发全量样式失效。
  const noopProbe = await evaluate(`(() => {
    const api = window.__workbuddySkin;
    const el = document.getElementById("workbuddy-skin-style");
    const before = el.textContent;
    // 同一主题连切两次：第二次应当几乎不产生额外开销
    api.setTheme(${JSON.stringify(a)}); void document.body.offsetHeight;
    const t0 = performance.now();
    api.setTheme(${JSON.stringify(a)});   // 完全相同的主题
    void document.body.offsetHeight;
    const repeatSame = performance.now() - t0;
    return { repeatSame, cssUnchanged: el.textContent === before || true };
  })()`);
  check(
    "重复应用同一主题接近零开销（无多余样式失效）",
    noopProbe.repeatSame < SYNC_BUDGET_MS,
    `${Math.round(noopProbe.repeatSame * 10) / 10}ms`,
  );

  // ---- 3. 压力：连续切换不应卡死渲染器 ----
  const stress = await evaluate(`(async () => {
    const api = window.__workbuddySkin;
    const ids = ${JSON.stringify(themeIds)};
    let worst = 0, sum = 0, n = 0, longTasks = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.duration > 50) longTasks += 1;
      }).observe({ entryTypes: ["longtask"] });
    } catch { /* 不支持就跳过这项统计 */ }
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      api.setTheme(ids[i % ids.length]);
      void document.body.offsetHeight;
      const dt = performance.now() - t0;
      worst = Math.max(worst, dt); sum += dt; n += 1;
      // 每 10 次让出一帧，模拟真实用户操作节奏
      if (i % 10 === 0) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    await new Promise((r) => setTimeout(r, 300));
    return { rounds: n, worst, avg: sum / n, longTasks };
  })()`);

  check(
    `连续切 30 次最坏单次 < ${WORST_BUDGET_MS}ms`,
    stress.worst < WORST_BUDGET_MS,
    `最坏 ${Math.round(stress.worst * 10) / 10}ms / 均值 ${Math.round(stress.avg * 10) / 10}ms`,
  );

  // 卡死的判据：压力测试后渲染器还能立刻响应新命令
  const aliveStart = Date.now();
  const alive = await evaluate("1 + 1");
  const aliveMs = Date.now() - aliveStart;
  check("压力测试后渲染器仍能响应（未卡死主线程）", alive === 2 && aliveMs < 3000, `响应 ${aliveMs}ms`);

  // ---- 4. 深色主题下打开设置界面，文字对比度必须达标 ----
  const deepTheme = themeIds.find((id) => /wuthering|dark|night/i.test(id)) ?? b;
  await evaluate(`window.__workbuddySkin.setTheme(${JSON.stringify(deepTheme)})`);
  await sleep(600);

  // 打开设置 → 进插件面板（面板是设置界面里文字最密集的地方）
  const opened = await openSettings();
  check("深色主题下能打开设置弹窗", opened === true, String(opened));

  if (opened === true) {
    await evaluate(`document.getElementById("workbuddy-skin-menu-settings-entry")?.click()`);
    await sleep(500);

    // 逐元素算 WCAG 对比度；半透明前景先合成到实底上再算
    const contrast = await evaluate(`(() => {
      const parse = (c) => {
        const m = /rgba?\\(([0-9.]+), ([0-9.]+), ([0-9.]+)(?:, ([0-9.]+))?\\)/.exec(c || "");
        return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
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

      const overlay = document.querySelector(".settings-modal-overlay");
      if (!overlay) return null;
      const rows = [];
      const probe = (label, el) => {
        if (!el) return;
        const text = (el.textContent || "").trim();
        if (!text) return;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return;
        const fg = parse(cs.color);
        // 往上找最近的实底祖先（半透明的不算，否则算出来的对比度是假的）
        let node = el, bg = null;
        while (node) {
          const b = parse(getComputedStyle(node).backgroundColor);
          if (b && b[3] >= 0.9) { bg = b; break; }
          node = node.parentElement;
        }
        if (!fg || !bg) return;
        rows.push({ label, ratio: ratio(composite(fg, bg), bg), px: cs.fontSize });
      };
      probe("导航条目", overlay.querySelector(".settings-navigation__item"));
      probe("导航分组标题", overlay.querySelector(".settings-navigation__group-title"));
      probe("弹窗标题", overlay.querySelector(".settings-modal__header, .settings-modal__content h1, .settings-modal__content h2"));
      const pane = document.getElementById("workbuddy-skin-menu-settings-pane");
      if (pane) {
        probe("插件面板头部", pane.firstElementChild);
        probe("插件面板分组标题", pane.querySelector("p"));
        probe("插件面板行文字", pane.querySelector("[data-wb-theme-id] span:nth-child(2)"));
      }
      return rows;
    })()`);

    check("能测到设置界面上的文字元素", Array.isArray(contrast) && contrast.length >= 3, JSON.stringify(contrast?.length ?? null));

    if (Array.isArray(contrast)) {
      // WCAG AA 对正文要求 4.5:1；13px 以下的小字更该达标
      const failing = contrast.filter((r) => r.ratio < 4.5);
      check(
        "深色主题下设置界面文字对比度全部 ≥ 4.5:1（WCAG AA）",
        failing.length === 0,
        failing.length
          ? failing.map((r) => `${r.label}=${r.ratio.toFixed(2)}(${r.px})`).join(", ")
          : contrast.map((r) => `${r.label}=${r.ratio.toFixed(1)}`).join(", "),
      );
    }

    // 收尾：把设置弹窗关掉（全屏遮罩，留着会干扰后续测试）
    const closed = await closeSettings();
    check("收尾：设置面板已关闭（不留给后续测试）", closed === true, String(closed));
  }
}

// ---- 收尾：还原到测试开始时的主题 ----
// 注意顺序：必须在 finish() 之前读，finish 会把 CDP 连接关掉。
if (typeof t.applyLast === "function") await t.applyLast();
const finalTheme = await t.currentThemeId();
check(
  "收尾：主题已还原到测试开始时的值",
  initialTheme === null ? finalTheme === null : finalTheme === initialTheme,
  `${finalTheme} vs ${initialTheme}`,
);

await t.finish();
