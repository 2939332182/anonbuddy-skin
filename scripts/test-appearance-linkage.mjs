// 回归测试：换肤插件 ↔ WorkBuddy 自带「外观（浅色/深色）」的联动。
// 用法：node scripts/test-appearance-linkage.mjs [port]
//
// 背景（2026-09-19）：
//   皮肤与 WorkBuddy 自带外观是两套独立系统，但**写的是同一批 DOM 输出**：
//   body/html 的 light|cb-light|vscode-light（或 dark 三件套）、
//   body[data-vscode-theme-kind] / body[data-vscode-theme-name] /
//   html[data-theme] / html.style.colorScheme。
//   两边同时生效就会打架：浅色皮肤 + 原生深色 → foundation 的 .dark token 叠上来，
//   皮肤 CSS 明明加载了界面却发暗。
//
// 所以要求「换肤即换外观，只有一个主导者」，并有三条硬约束：
//   ① 切到浅色系主题 → 外观自动变浅色
//   ② 切到深色系主题 → 外观自动变深色
//   ③ 浅色系主题生效期间，禁止把外观切成深色
//
// 实现走原生现成的 'data-skin' 契约（见 src/skin-menu.mjs 里的长注释），
// 这个测试同时锁住"契约还在"：若哪天 WorkBuddy 改了 data-skin 语义，
// 「原生观察器不再让位」这条断言会先红。

import { createHarness } from "./_harness.mjs";

const t = await createHarness({ name: "test-appearance-linkage" });
const { evaluate, sleep, waitFor, check, send } = t;

// 读一份完整的外观状态快照
const appearance = () =>
  evaluate(`(() => {
    const b = document.body, h = document.documentElement;
    const k = Object.keys(localStorage).find(
      (x) => x.indexOf("workbuddy.appearance.mode::") === 0 && x.indexOf("legacy-snapshot") === -1,
    );
    return {
      skin: h.dataset.workbuddySkin ?? null,
      dataSkin: h.getAttribute("data-skin"),
      kind: b.getAttribute("data-vscode-theme-kind"),
      name: b.getAttribute("data-vscode-theme-name"),
      colorScheme: h.style.colorScheme,
      bodyCls: b.className,
      htmlCls: h.className,
      scopedMode: k ? localStorage.getItem(k) : null,
      locked: h.getAttribute("data-wb-light-lock"),
    };
  })()`);

const applyTheme = async (id) => {
  const ok = await evaluate(`(() => {
    try { window.__workbuddySkin.setTheme(${JSON.stringify(id)}); } catch (e) { return String(e); }
    return document.documentElement.dataset.workbuddySkin;
  })()`);
  await sleep(400);
  return ok;
};

// ---- 打开个人中心浮层（必须真实鼠标事件，DOM .click() 不触发内部状态）----
const clickTrigger = async () => {
  const point = await evaluate(`(() => {
    const el = document.querySelector(".user-menu-trigger");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!point) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type, x: point.x, y: point.y, button: "left", clickCount: 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
  }
  return true;
};
const openPopover = async () => {
  if (await evaluate(`Boolean(document.querySelector(".user-menu-popover"))`)) return true;
  await clickTrigger();
  return (
    (await waitFor(() => evaluate(`Boolean(document.querySelector(".user-menu-popover"))`), {
      waitMs: 4000, stepMs: 150,
    })) === true
  );
};
const closePopover = async () => {
  await evaluate(`(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(() => evaluate(`!document.querySelector(".user-menu-popover")`), { waitMs: 2000, stepMs: 120 });
};

// 点浮层里的「深色 / 浅色」选项（真鼠标）
const clickOption = async (dark) => {
  const point = await evaluate(`(() => {
    const el = [...document.querySelectorAll(".user-menu-popover .user-menu-theme-option")]
      .find((o) => ${dark} ? !/浅色|Light/i.test(o.textContent) : /浅色|Light/i.test(o.textContent));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!point) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type, x: point.x, y: point.y, button: "left", clickCount: 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
  }
  await sleep(700);
  return true;
};

// ---- 准备：挑出浅/深两组内置主题 ----
const themes = await t.loadMenuThemes();
const surfaceOf = (m) => (m.colors?.surface ?? m.surface ?? "").replace("#", "");
const isLightHex = (hex) => {
  if (!/^[0-9a-f]{6}$/i.test(hex)) return true;
  const v = parseInt(hex, 16);
  return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 140;
};
const lightTheme = themes.find((x) => isLightHex(surfaceOf(x.manifest)));
const darkTheme = themes.find((x) => !isLightHex(surfaceOf(x.manifest)));

check("存在可用的浅色内置主题", Boolean(lightTheme), lightTheme?.manifest.id ?? "无");
check("存在可用的深色内置主题", Boolean(darkTheme), darkTheme?.manifest.id ?? "无");

const originalTheme = await t.currentThemeId();
// ⚠️ 关键：setTheme 会顺带改写 workbuddySkinLastTheme（"上次用的主题"）。
// 后面 test-theme-switch-perf 之类的测试用 applyLast() 还原，读的正是这个键 ——
// 我们不还原它，就会把下一个测试的"起始主题"改成我们最后切到的那个（实测踩过：
// perf 测试报 "主题已还原到测试开始时的值 -> wuthering-echo vs genshin-dawn"）。
// 另外外观联动本身也会写账号维度 mode key，同样要快照。
const snapshot = await evaluate(`(() => ({
  lastTheme: localStorage.getItem("workbuddySkinLastTheme"),
  scopedKeys: Object.keys(localStorage).filter(
    (k) => k.indexOf("workbuddy.appearance.mode::") === 0,
  ).reduce((acc, k) => { acc[k] = localStorage.getItem(k); return acc; }, {}),
  legacyTheme: localStorage.getItem("agent-ui-theme"),
}))()`);

const restoreState = async () => {
  await evaluate(`(() => {
    const s = ${JSON.stringify(snapshot)};
    const restoreKey = (k, v) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); };
    restoreKey("workbuddySkinLastTheme", s.lastTheme);
    restoreKey("agent-ui-theme", s.legacyTheme);
    // 账号维度 key：先清掉本次跑期间新增的，再把快照里的值写回
    for (const k of Object.keys(localStorage)) {
      if (k.indexOf("workbuddy.appearance.mode::") === 0 && !(k in s.scopedKeys)) localStorage.removeItem(k);
    }
    for (const [k, v] of Object.entries(s.scopedKeys)) localStorage.setItem(k, v);
    return true;
  })()`);
};

try {
  // ========== ① 深色主题 → 外观自动深色 ==========
  await applyTheme(darkTheme.manifest.id);
  const dark = await appearance();
  check(
    `切深色主题（${darkTheme.manifest.id}）后外观变深色`,
    dark.kind === "vscode-dark",
    `vscode-theme-kind=${dark.kind}`,
  );
  check(
    "深色主题下 body/html 都带 dark 三件套",
    dark.bodyCls.includes("dark") && dark.bodyCls.includes("vscode-dark") && dark.bodyCls.includes("cb-dark") &&
      dark.htmlCls.includes("dark") && dark.htmlCls.includes("vscode-dark") && dark.htmlCls.includes("cb-dark"),
    `body=${dark.bodyCls} | html=${dark.htmlCls}`,
  );
  check("深色主题下 colorScheme=dark", dark.colorScheme === "dark", dark.colorScheme);
  check(
    "深色主题下不再残留 light 系类名（否则 foundation 会两套 token 打架）",
    !/\blight\b/.test(dark.bodyCls) && !/\bvscode-light\b/.test(dark.bodyCls) && !/\bcb-light\b/.test(dark.bodyCls),
    dark.bodyCls,
  );
  check(
    "深色主题把外观偏好持久化到账号维度 key",
    dark.scopedMode === "dark",
    `scopedMode=${dark.scopedMode}`,
  );
  check(
    "皮肤生效时声明了 data-skin（让原生 ThemeManager 让位）",
    dark.dataSkin === "wb-skin-studio",
    `data-skin=${dark.dataSkin}`,
  );

  // ========== ② 浅色主题 → 外观自动浅色 ==========
  await applyTheme(lightTheme.manifest.id);
  const light = await appearance();
  check(
    `切浅色主题（${lightTheme.manifest.id}）后外观变浅色`,
    light.kind === "vscode-light",
    `vscode-theme-kind=${light.kind}`,
  );
  check(
    "浅色主题下 body/html 都带 light 三件套且无 dark 残留",
    /\blight\b/.test(light.bodyCls) && /\bvscode-light\b/.test(light.bodyCls) && /\bcb-light\b/.test(light.bodyCls) &&
      !/\bdark\b/.test(light.bodyCls) && !/\bvscode-dark\b/.test(light.bodyCls) &&
      /\blight\b/.test(light.htmlCls) && !/\bdark\b/.test(light.htmlCls),
    `body=${light.bodyCls} | html=${light.htmlCls}`,
  );
  check("浅色主题下 colorScheme=light", light.colorScheme === "light", light.colorScheme);
  check("浅色主题把外观偏好持久化为 light", light.scopedMode === "light", `scopedMode=${light.scopedMode}`);
  check("浅色主题下亮起浅色锁标记", light.locked === "1", `data-wb-light-lock=${light.locked}`);

  // ========== ③ 浅色主题下禁止切深色 ==========
  const opened = await openPopover();
  check("能打开个人中心浮层（后续断言的前提）", opened === true, String(opened));

  if (opened) {
    const opts = await evaluate(`(() => {
      return [...document.querySelectorAll(".user-menu-popover .user-menu-theme-option")].map((e) => ({
        text: e.textContent.trim(),
        lock: e.dataset.wbLightLock ?? null,
        opacity: e.style.opacity,
        cursor: e.style.cursor,
        ariaDisabled: e.getAttribute("aria-disabled"),
        title: e.getAttribute("title"),
      }));
    })()`);
    check("浮层里找到浅色/深色两个外观选项", Array.isArray(opts) && opts.length === 2, JSON.stringify(opts));

    const darkOpt = (opts ?? []).find((o) => !/浅色|Light/i.test(o.text));
    const lightOpt = (opts ?? []).find((o) => /浅色|Light/i.test(o.text));
    check(
      "浅色主题下「深色」选项被标为禁用",
      darkOpt?.lock === "1" && darkOpt?.ariaDisabled === "true",
      JSON.stringify(darkOpt),
    );
    check(
      "「深色」选项有可见的禁用外观（半透明 + not-allowed）",
      Number(darkOpt?.opacity) > 0 && Number(darkOpt?.opacity) < 1 && darkOpt?.cursor === "not-allowed",
      `opacity=${darkOpt?.opacity} cursor=${darkOpt?.cursor}`,
    );
    check("「浅色」选项不受禁用影响", lightOpt?.lock === null && lightOpt?.ariaDisabled === null, JSON.stringify(lightOpt));

    // 真点「深色」——必须无效果
    const clicked = await clickOption(true);
    check("「深色」选项在界面上可点（不是靠 pointer-events 硬挡）", clicked === true, String(clicked));
    const afterBlocked = await appearance();
    check(
      "浅色主题下点「深色」被拦住，外观仍是浅色",
      afterBlocked.kind === "vscode-light" && afterBlocked.colorScheme === "light",
      `kind=${afterBlocked.kind} colorScheme=${afterBlocked.colorScheme}`,
    );
    check(
      "被拦后没有把浅色偏好改写成 dark",
      afterBlocked.scopedMode === "light",
      `scopedMode=${afterBlocked.scopedMode}`,
    );
    check(
      "被拦后 body 上没有出现 dark 类名",
      !/\bdark\b/.test(afterBlocked.bodyCls) && !/\bvscode-dark\b/.test(afterBlocked.bodyCls),
      afterBlocked.bodyCls,
    );

    // 浅色主题下点「浅色」应正常（不被误伤）
    await clickOption(false);
    const afterLight = await appearance();
    check("浅色主题下点「浅色」正常工作", afterLight.kind === "vscode-light", afterLight.kind);

    // ========== ④ 切到深色主题后，深色选项必须解禁 ==========
    await applyTheme(darkTheme.manifest.id);
    await sleep(900); // 等轮询刷新按钮态
    const opts2 = await evaluate(`(() => {
      return [...document.querySelectorAll(".user-menu-popover .user-menu-theme-option")].map((e) => ({
        text: e.textContent.trim(), lock: e.dataset.wbLightLock ?? null,
      }));
    })()`);
    const darkOpt2 = (opts2 ?? []).find((o) => !/浅色|Light/i.test(o.text));
    check(
      "切到深色主题后「深色」选项解除禁用",
      darkOpt2 && darkOpt2.lock === null,
      JSON.stringify(opts2),
    );
    const afterDarkFree = await appearance();
    check("切到深色主题后外观为深色（浅色锁不残留）", afterDarkFree.kind === "vscode-dark", afterDarkFree.kind);
    check("切到深色主题后浅色锁标记被撤掉", afterDarkFree.locked === null, `lock=${afterDarkFree.locked}`);

    await closePopover();
  }

  // ========== ⑤ 兜底：外观被别处强改成深色时，浅色主题会按回去 ==========
  await applyTheme(lightTheme.manifest.id);
  await evaluate(`(() => {
    // 绕过我们的捕获监听器，直接像"原生/快捷键"那样改属性与类名
    const b = document.body, h = document.documentElement;
    b.setAttribute("data-vscode-theme-kind", "vscode-dark");
    b.classList.remove("light", "cb-light", "vscode-light");
    b.classList.add("dark", "cb-dark", "vscode-dark");
    h.classList.remove("light", "cb-light", "vscode-light");
    h.classList.add("dark", "cb-dark", "vscode-dark");
    h.style.colorScheme = "dark";
    return true;
  })()`);
  const recovered =
    (await waitFor(
      () => evaluate(`document.body.getAttribute("data-vscode-theme-kind") === "vscode-light"`),
      { waitMs: 4000, stepMs: 200 },
    )) === true;
  const afterRepair = await appearance();
  check("浅色主题下外观被外部切成深色后会自动纠回浅色", recovered, `kind=${afterRepair.kind}`);

  // ========== ⑥ 原生契约仍在：data-skin 让原生观察器让位 ==========
  await applyTheme(darkTheme.manifest.id);
  const contractOk = await evaluate(`(() => {
    // 有 data-skin 时，改 data-vscode-theme-kind 不应被原生回写类名
    const h = document.documentElement;
    const had = h.getAttribute("data-skin");
    const before = document.body.className;
    document.body.setAttribute("data-vscode-theme-kind", "vscode-light");
    return JSON.stringify({ had, before });
  })()`);
  await sleep(500);
  const contractAfter = await evaluate(`JSON.stringify({
    kind: document.body.getAttribute("data-vscode-theme-kind"),
    darkStillThere: /\\bdark\\b/.test(document.body.className),
  })`);
  check(
    "原生 data-skin 契约仍然有效（皮肤生效时原生不抢写类名）",
    JSON.parse(contractOk).had === "wb-skin-studio" && JSON.parse(contractAfter).darkStillThere === true,
    `${contractOk} -> ${contractAfter}`,
  );

  // ========== ⑦ 选「原生」时必须交还控制权 ==========
  // 皮肤卸下后若还挂着 data-skin / 浅色锁，原生 ThemeManager 会一直被我们挡住，
  // 用户就再也切不动外观了 —— 这是联动最危险的副作用，必须钉住。
  await applyTheme(lightTheme.manifest.id);
  await evaluate(`(() => { window.__workbuddySkin.clearTheme(); return true; })()`);
  await sleep(600);
  const native = await appearance();
  check("选「原生」后 data-skin 被撤掉（原生恢复自理）", native.dataSkin === null, `data-skin=${native.dataSkin}`);
  check("选「原生」后浅色锁被解开", native.locked === null, `lock=${native.locked}`);
  check("选「原生」后皮肤标记也清掉了", native.skin === null, `skin=${native.skin}`);

  // 交还后原生应能自己把外观切成深色（之前被皮肤挡着）
  const nativeCanSwitch = await evaluate(`(() => {
    document.body.setAttribute("data-vscode-theme-kind", "vscode-dark");
    return true;
  })()`);
  await sleep(600);
  const afterNativeSwitch = await appearance();
  check(
    "交还后原生能自己把外观切成深色（说明真的放手了）",
    nativeCanSwitch === true && afterNativeSwitch.kind === "vscode-dark",
    `kind=${afterNativeSwitch.kind}`,
  );
  // 还原成浅色，避免影响后续断言
  await evaluate(`(() => {
    document.body.setAttribute("data-vscode-theme-kind", "vscode-light");
    return true;
  })()`);
  await sleep(500);
} finally {
  // 状态中性：浮层关掉、主题与 localStorage 还原成测试前那个（不依赖执行顺序）
  await closePopover();
  if (originalTheme) await applyTheme(originalTheme);
  else await t.applyLast();
  await restoreState();
  await sleep(300);
}

const finalPopover = await evaluate(`Boolean(document.querySelector(".user-menu-popover"))`);
check("收尾：个人中心浮层已关闭", finalPopover === false, String(finalPopover));
const restored = await t.currentThemeId();
check("收尾：激活主题已还原", restored === originalTheme, `${restored} vs ${originalTheme}`);

await t.finish();
