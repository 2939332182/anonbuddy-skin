// 端到端测试：设置面板集成 —— 「ChihayaAnon 插件」条目、皮肤列表、上传、悬浮图标开关。
// 用法：node scripts/test-settings-panel.mjs [port]
// 状态中性：自己造的自定义主题与图标开关都会还原，绝不碰用户已有的主题与别名。
//
// 前置：需要 WorkBuddy 设置面板能打开。测试自己走「个人中心 → 设置」把面板打开。

import { createHarness } from "./_harness.mjs";

const MENU_ID = "anonbuddy-skin-menu";
const t = await createHarness({ name: "test-settings-panel" });
const { session, sleep, waitFor, check } = t;

const evaluate = t.evaluate;

// ---- 打开设置面板：个人中心 → 设置 ----
const openSettings = async () => {
  const already = await evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`);
  if (already) return true;
  await evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
  return waitFor(
    () => evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`),
    { waitMs: 6000, stepMs: 200 },
  );
};

const pressEsc = async () => {
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(250);
};

// 关闭设置面板。
// 必须在收尾时确保它真的关掉了：设置弹窗是覆盖全屏的遮罩，留着会让后面
// 依赖"点/悬停侧边栏某一行"的测试全部命不中目标（实测把 hover 测试搞挂过一次）。
const closeSettings = async () => {
  if (!(await evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`))) return true;
  await pressEsc();
  let closed = await waitFor(
    () => evaluate(`!document.querySelector(".settings-modal-overlay")`),
    { waitMs: 3000, stepMs: 150 },
  );
  if (closed === true) return true;
  // Esc 没关掉：退化为点遮罩（原生支持的另一种关闭方式），再等等
  await evaluate(`(() => {
    const ov = document.querySelector(".settings-modal-overlay");
    if (ov) ov.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(250);
  closed = await waitFor(
    () => evaluate(`!document.querySelector(".settings-modal-overlay")`),
    { waitMs: 2000, stepMs: 150 },
  );
  return closed === true;
};

// 先确保皮肤在装（脚本 API 才存在）
await t.applyLast();
await waitFor(async () => Boolean(await evaluate(`window.__anonbuddySkin?.settings`)), { waitMs: 10000, stepMs: 200 });

const initial = await evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  return {
    theme: document.documentElement.dataset.anonbuddySkin ?? null,
    last: sk.lastTheme(),
    customIds: sk.customThemes().map((c) => c.id),
    aliases: sk.aliases(),
    iconHidden: sk.icon.isHidden(),
    iconVisible: sk.icon.visible(),
    storedHidden: localStorage.getItem(sk.icon.key),
  };
})()`);
console.log("INITIAL=" + JSON.stringify(initial));

let tempId = null;

try {
  // ---- 1. 设置面板能打开，导航栏出现插件条目 ----
  const opened = await openSettings();
  check("设置面板已打开", opened === true);
  const entry = await waitFor(
    () => evaluate(`(() => {
      const sk = window.__anonbuddySkin;
      sk.settings.ensure();
      const el = sk.settings.entry();
      return el && el.textContent.trim() ? { text: el.textContent.trim(), cls: el.className } : null;
    })()`),
    { waitMs: 6000, stepMs: 200 },
  );
  check("导航栏出现插件条目", !!entry, JSON.stringify(entry));
  check("条目名称为 ChihayaAnon 插件", entry?.text.includes("ChihayaAnon"), entry?.text);
  check("条目复用原生导航样式类", (entry?.cls ?? "").includes("settings-navigation__item"), entry?.cls);

  // 条目挂在「功能」分组下
  const inFeatureGroup = await evaluate(`(() => {
    const el = document.getElementById(window.__anonbuddySkin.settings.entryId);
    const group = el?.closest(".settings-navigation__group");
    return group ? (group.querySelector(".settings-navigation__group-title")?.textContent || "").trim() : null;
  })()`);
  check("条目位于「功能」分组", inFeatureGroup === "功能", String(inFeatureGroup));

  // ---- 2. 条目可重复 ensure，不会插出第二份 ----
  const dupCount = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    sk.settings.ensure(); sk.settings.ensure(); sk.settings.ensure();
    return document.querySelectorAll("#" + sk.settings.entryId).length;
  })()`);
  check("重复注入不产生重复条目", dupCount === 1, String(dupCount));

  // 面板同理：不能叠出第二层
  const dupPane = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    sk.settings.open(); sk.settings.open();
    return {
      panes: document.querySelectorAll("#" + sk.settings.paneId).length,
      headers: [...document.querySelectorAll(".settings-modal__content > div")]
        .filter((el) => el.textContent.includes("ChihayaAnon 插件")).length,
    };
  })()`);
  check("重复打开不叠出第二个面板", dupPane.panes === 1, JSON.stringify(dupPane));
  check("内容区只有一份插件面板", dupPane.headers === 1, JSON.stringify(dupPane));

  // ---- 3. 点条目打开插件面板 ----
  const panelOpened = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    const ok = sk.settings.open();
    const pane = sk.settings.pane();
    return { ok, open: sk.settings.isOpen(), visible: pane ? getComputedStyle(pane).display : null, rows: sk.settings.rows().length };
  })()`);
  check("点条目后插件面板打开", panelOpened.open === true, JSON.stringify(panelOpened));
  check("插件面板可见", panelOpened.visible === "flex", String(panelOpened.visible));
  check("面板列出了皮肤条目", panelOpened.rows > 1, String(panelOpened.rows));

  // 原生面板被让位（隐藏），且 DOM 仍保留（React 需要）
  const nativeHidden = await evaluate(`(() => {
    const c = document.querySelector(".settings-modal__content");
    const h = c?.querySelector(":scope > .settings-modal__header");
    const p = c?.querySelector(":scope > .settings-modal__panel");
    return {
      headerExists: !!h, panelExists: !!p,
      headerShown: h ? getComputedStyle(h).display !== "none" : null,
      panelShown: p ? getComputedStyle(p).display !== "none" : null,
    };
  })()`);
  check("原生面板 DOM 仍保留", nativeHidden.headerExists === true && nativeHidden.panelExists === true, JSON.stringify(nativeHidden));
  check("原生面板暂时让位（隐藏但未删除）", nativeHidden.headerShown === false && nativeHidden.panelShown === false, JSON.stringify(nativeHidden));

  // ---- 4. 皮肤列表内容：原生界面 + 全部磁盘主题 + 全部自定义主题 ----
  const listInfo = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    const rows = sk.settings.rows();
    const customIds = sk.customThemes().map((c) => c.id);
    return {
      hasNative: rows.some((r) => r.id === null),
      rowIds: rows.map((r) => r.id),
      customIds,
      menuThemeIds: [...document.querySelectorAll("#${MENU_ID} > div > div")].filter((n) => "themeId" in n && n.__themeId !== undefined).length,
    };
  })()`);
  check("列表含「原生界面」", listInfo.hasNative === true);
  check("列表含全部自定义皮肤", listInfo.customIds.every((id) => listInfo.rowIds.includes(id)), JSON.stringify({ custom: listInfo.customIds, rows: listInfo.rowIds }));

  // ---- 4b. 皮肤列表是三列网格（2026-09-20：由单列改为紧凑网格）----
  // 原先每行占满整宽、右侧大片留白；改成 3 列后 9 个主题正好 3×3。
  // 这里把"容器是 grid / 3 列 / 每格独立圆角与边框"钉住，避免以后被顺手改回单列。
  const gridLayout = await evaluate(`(() => {
    const pane = window.__anonbuddySkin.settings.pane();
    const card = pane?.querySelector('[data-wb-theme-id]')?.parentElement ?? null;
    if (!card) return null;
    const cs = getComputedStyle(card);
    const cells = [...card.children];
    const fcs = cells[0] ? getComputedStyle(cells[0]) : null;
    // 同一行的单元格 offsetTop 相同 → 据此数出"每行几个"
    const tops = cells.map((el) => el.offsetTop);
    return {
      display: cs.display,
      columns: cs.gridTemplateColumns.trim().split(/\\s+/).length,
      gap: cs.rowGap,
      padding: cs.paddingTop,
      cells: cells.length,
      perRow: tops.filter((v) => v === tops[0]).length,
      cellRadius: fcs?.borderTopLeftRadius ?? null,
      cellBorderWidth: fcs?.borderTopWidth ?? null,
      hoverVar: getComputedStyle(pane).getPropertyValue("--wb-pane-hover").trim(),
    };
  })()`);
  check("皮肤列表容器是 grid 布局", gridLayout?.display === "grid", JSON.stringify(gridLayout));
  check("皮肤列表固定 3 列", gridLayout?.columns === 3, `columns=${gridLayout?.columns}`);
  check(
    "每行排 3 个主题",
    gridLayout?.perRow === 3 && gridLayout?.cells === listInfo.rowIds.length,
    `perRow=${gridLayout?.perRow} cells=${gridLayout?.cells} rows=${listInfo.rowIds.length}`,
  );
  check(
    "每个主题是独立圆角卡片（不再是整块列表 + 行间分隔线）",
    gridLayout?.cellRadius === "8px" && gridLayout?.cellBorderWidth === "1px",
    `radius=${gridLayout?.cellRadius} border=${gridLayout?.cellBorderWidth}`,
  );
  check(
    "格子之间有间距（不再靠 borderTop 分隔线）",
    gridLayout?.gap === "6px",
    `gap=${gridLayout?.gap}`,
  );
  check(
    "悬停底色跟随面板主题变量（深色面板下不再是黑压黑）",
    gridLayout?.hoverVar !== "",
    `--wb-pane-hover=${gridLayout?.hoverVar}`,
  );

  // ---- 5. 高亮当前皮肤 ----
  const selected = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    const on = sk.settings.rows().filter((r) => r.selected);
    return { count: on.length, id: on[0]?.id ?? null, theme: document.documentElement.dataset.anonbuddySkin ?? null };
  })()`);
  check("恰好一个条目处于选中态", selected.count === 1, JSON.stringify(selected));
  check("选中的就是当前皮肤", selected.id === selected.theme, JSON.stringify(selected));

  // ---- 6. 在面板里点另一个皮肤 → 真的切换 ----
  const target = listInfo.rowIds.find((id) => id !== null && id !== selected.theme) ?? initial.customIds[0];
  const switched = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    const ok = sk.settings.clickRow(${JSON.stringify(target)});
    return {
      ok,
      theme: document.documentElement.dataset.anonbuddySkin ?? null,
      last: sk.lastTheme(),
      selected: sk.settings.rows().filter((r) => r.selected).map((r) => r.id),
    };
  })()`);
  check("面板内点条目切换生效", switched.theme === target, JSON.stringify(switched));
  check("切换后选中标记跟着走", switched.selected.length === 1 && switched.selected[0] === target, JSON.stringify(switched.selected));
  check("切换写入 lastTheme（重启可恢复）", switched.last === target, String(switched.last));

  // ---- 6b. 面板里切主题后，面板自身配色 + 自带外观必须**立刻**跟着刷新 ----
  // 回归两个真实 bug（2026-09-20，主人报「切主题后自带外观深浅不及时刷新，点一下个人中心才好」）：
  //   ① applyMode 漏写 <html data-theme> —— 原生写它的那条路径见到 data-skin 会提前 return，
  //      于是皮肤接管期间没人写它，停在接管前的旧值，靠它取色的自带 UI 要等 React 重渲染才更新。
  //   ② 面板的 --wb-pane-* 只在 openPluginPane() 里算一次 —— 面板开着时切主题，
  //      配色会停在打开那一刻（深色弹窗配浅色变量 = 浅字压白底，面板看着像空的）。
  // 两条都要求"点完就生效，不需要额外交互"，所以这里点完只等轮询周期，不做任何其他操作。
  const lightId = listInfo.rowIds.find((id) => id === "aisu") ?? null;
  const darkId = listInfo.rowIds.find((id) => id === "wuthering-echo") ?? null;
  if (lightId && darkId) {
    const probe = () => evaluate(`(() => {
      const h = document.documentElement;
      const pane = window.__anonbuddySkin.settings.pane();
      const cs = getComputedStyle(pane);
      const dark = /vscode-dark/.test(document.body.className);
      return {
        dark,
        themeAttr: h.getAttribute("data-theme"),
        paneCard: cs.getPropertyValue("--wb-pane-card").trim(),
        paneText: cs.getPropertyValue("--wb-pane-text").trim(),
        paneHover: cs.getPropertyValue("--wb-pane-hover").trim(),
      };
    })()`);
    const clickAndWait = async (id) => {
      await evaluate(`window.__anonbuddySkin.settings.clickRow(${JSON.stringify(id)})`);
      await sleep(900); // 只等我们自己的同步（不点任何别的东西）
      return probe();
    };

    const inDark = await clickAndWait(darkId);
    check("深色主题下 html[data-theme] 立刻变成 dark", inDark.themeAttr === "dark" && inDark.dark === true, JSON.stringify(inDark));

    const inLight = await clickAndWait(lightId);
    check("切浅色主题后 html[data-theme] 立刻变成 light（不需要再点一次）", inLight.themeAttr === "light" && inLight.dark === false, JSON.stringify(inLight));
    check(
      "切主题后面板配色立刻跟着刷新（不是停在打开那一刻）",
      inDark.paneText !== inLight.paneText && inDark.paneCard !== inLight.paneCard && inDark.paneHover !== inLight.paneHover,
      `dark=${JSON.stringify({ c: inDark.paneCard, t: inDark.paneText })} light=${JSON.stringify({ c: inLight.paneCard, t: inLight.paneText })}`,
    );
    check(
      "面板配色与弹窗深浅一致（深色弹窗不能用浅色变量）",
      inDark.paneText === "#f0f2f6" && inLight.paneText === "#1a1a1a",
      `dark=${inDark.paneText} light=${inLight.paneText}`,
    );

    // 反向再切一次：确认两个方向都即时刷新，而不是"只在某个方向碰巧对"
    const backToDark = await clickAndWait(darkId);
    check("反向切回深色同样即时刷新", backToDark.themeAttr === "dark" && backToDark.paneText === "#f0f2f6", JSON.stringify(backToDark));
  } else {
    check("内置深浅主题齐全（6b 用例前提）", false, `light=${lightId} dark=${darkId}`);
  }

  // ---- 7. 面板里点「原生界面」→ 还原 ----
  const toNative = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    sk.settings.clickRow(null);
    return { theme: document.documentElement.dataset.anonbuddySkin ?? null, last: sk.lastTheme() };
  })()`);
  check("面板可切回原生界面", toNative.theme === null, JSON.stringify(toNative));

  // ---- 8. 上传新图片作为皮肤 ----
  const added = await evaluate(`(async () => {
    const sk = window.__anonbuddySkin;
    const before = sk.customThemes().length;
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 48;
    const g = canvas.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 64, 48);
    grad.addColorStop(0, "#3b82f6"); grad.addColorStop(1, "#f59e0b");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 48);
    await sk.importFromDataUrl(canvas.toDataURL("image/png"), "设置面板测试图");
    sk.settings.open();
    const rows = sk.settings.rows();
    const newest = sk.customThemes().at(-1);
    return { before, after: sk.customThemes().length, newId: newest.id, inList: rows.some((r) => r.id === newest.id), total: rows.length };
  })()`);
  tempId = added.newId;
  check("上传后自定义皮肤 +1", added.after === added.before + 1, JSON.stringify(added));
  check("新皮肤立刻出现在面板列表里", added.inList === true, JSON.stringify(added));

  // 新皮肤可以被选中
  const picked = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    const ok = sk.settings.clickRow(${JSON.stringify(tempId)});
    return { ok, theme: document.documentElement.dataset.anonbuddySkin ?? null };
  })()`);
  check("上传的新皮肤可在面板内选中", picked.theme === tempId, JSON.stringify(picked));

  // ---- 9. 悬浮图标开关 ----
  const hidden = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    const before = { visible: sk.icon.visible(), hidden: sk.icon.isHidden() };
    sk.icon.setHidden(true);
    return {
      before,
      visible: sk.icon.visible(),
      hidden: sk.icon.isHidden(),
      stored: localStorage.getItem(sk.icon.key),
      aria: (() => { const b = sk.settings.pane()?.querySelector('[role=switch]'); return b ? b.getAttribute("aria-checked") : null; })(),
    };
  })()`);
  check("开关关闭后悬浮图标隐藏", hidden.visible === false, JSON.stringify(hidden));
  check("隐藏状态已持久化到 localStorage", hidden.stored === "1", String(hidden.stored));
  check("开关 aria 状态同步为 false", hidden.aria === "false", String(hidden.aria));

  const shown = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    sk.icon.setHidden(false);
    return { visible: sk.icon.visible(), hidden: sk.icon.isHidden(), stored: localStorage.getItem(sk.icon.key) };
  })()`);
  check("开关打开后悬浮图标恢复", shown.visible === true, JSON.stringify(shown));
  check("恢复状态已持久化", shown.stored === "0", String(shown.stored));

  // 通过面板里的真开关按钮点击（而不是 API）也要生效
  const clickedSwitch = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    sk.icon.setHidden(false);
    const b = sk.settings.pane()?.querySelector('[role=switch]');
    if (!b) return { err: "no switch" };
    b.click();
    const afterFirst = sk.icon.isHidden();
    b.click();
    return { afterFirst, afterSecond: sk.icon.isHidden(), visible: sk.icon.visible() };
  })()`);
  check("点面板里的真开关能切换", clickedSwitch.afterFirst === true && clickedSwitch.afterSecond === false, JSON.stringify(clickedSwitch));
  check("两次点击后图标恢复可见", clickedSwitch.visible === true, JSON.stringify(clickedSwitch));

  // ---- 10. 切到别的设置页 → 插件面板自动收起，原生面板回来 ----
  const restoreNative = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    sk.settings.open();
    const nav = document.querySelector(".settings-navigation");
    const other = [...nav.querySelectorAll(".settings-navigation__item")].find((el) => el.id !== sk.settings.entryId);
    if (!other) return { err: "no other item" };
    other.click();
    const c = document.querySelector(".settings-modal__content");
    const p = c?.querySelector(":scope > .settings-modal__panel");
    return {
      open: sk.settings.isOpen(),
      paneVisible: getComputedStyle(sk.settings.pane()).display,
      nativeShown: p ? getComputedStyle(p).display !== "none" : null,
    };
  })()`);
  check("切到别的设置页后插件面板收起", restoreNative.open === false, JSON.stringify(restoreNative));
  check("插件面板已隐藏", restoreNative.paneVisible === "none", String(restoreNative.paneVisible));
  check("原生面板已恢复显示", restoreNative.nativeShown === true, String(restoreNative.nativeShown));

  // ---- 11. 「原生」模式下打开插件面板（2026-09-19 回归）----
  // 背景：面板强调色 syncPaneThemeVars() 的兜底链是
  //   自定义主题 → 内置主题 → 全局默认色，
  // 前两级都依赖 currentThemeId()，而**「原生」模式下它是 null**，
  // 所以必然落到第三级。那一级当时直接引用了 Node 侧常量 DEFAULT_ACCENT ——
  // 面板脚本是在 renderer 里 eval 的，读不到 Node 作用域 → 抛 ReferenceError。
  // 异常从 openPluginPane() 里抛出、被 click 处理器吞掉，于是
  // 「切到原生后点插件条目毫无反应」；而且面板节点已经 append 了、原生面板也没被隐藏，
  // 界面处于半途状态（比完全不响应更难排查）。
  // 这组断言同时钉住「不再抛异常」与「面板真的打开了」。
  const themeBeforeNative = await t.currentThemeId();
  const nativeMode = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    sk.clearTheme();                       // 等价于点「原生」
    sk.settings.close();
    const skinId = document.documentElement.dataset.anonbuddySkin ?? null;
    let err = null;
    let opened = null;
    try {
      opened = sk.settings.open();
    } catch (e) {
      err = String(e && e.message);
    }
    const pane = sk.settings.pane();
    const content = document.querySelector(".settings-modal__content");
    const nativePanel = content?.querySelector(":scope > .settings-modal__panel");
    return {
      skinId,
      err,
      opened,
      paneExists: Boolean(pane),
      paneDisplay: pane ? getComputedStyle(pane).display : null,
      accent: pane ? getComputedStyle(pane).getPropertyValue("--wb-pane-accent").trim() : null,
      expectedAccent: sk.settings.defaultAccent,
      nativePanelDisplay: nativePanel ? getComputedStyle(nativePanel).display : null,
    };
  })()`);
  check("切「原生」后皮肤标记已清除（确认真的处于原生模式）", nativeMode.skinId === null, `skin=${nativeMode.skinId}`);
  check("原生模式下打开插件面板不再抛异常", nativeMode.err === null, String(nativeMode.err));
  check("原生模式下 openPluginPane 返回 true", nativeMode.opened === true, String(nativeMode.opened));
  check("原生模式下插件面板真的显示出来（不是卡在 display:none）", nativeMode.paneDisplay === "flex", String(nativeMode.paneDisplay));
  check("原生模式下原生面板已被隐藏", nativeMode.nativePanelDisplay === "none", String(nativeMode.nativePanelDisplay));
  check(
    "原生模式下强调色兜底到了默认色（正是当初抛异常的那一行）",
    typeof nativeMode.accent === "string" &&
      nativeMode.accent.toLowerCase() === String(nativeMode.expectedAccent).toLowerCase(),
    `--wb-pane-accent=${JSON.stringify(nativeMode.accent)} 期望 ${JSON.stringify(nativeMode.expectedAccent)}`,
  );
  // 还原：回到进入本节之前的主题，供后面的收尾逻辑继续用
  await evaluate(`(() => {
    const id = ${JSON.stringify(themeBeforeNative)};
    if (id) window.__anonbuddySkin.setTheme(id);
    return true;
  })()`);
  await sleep(300);
} finally {
  // ---- 收尾：删掉测试皮肤、还原图标开关与激活主题，并确保设置面板关掉 ----
  await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    if (${JSON.stringify(tempId)} !== null) sk.deleteCustomTheme(${JSON.stringify(tempId)});
    sk.icon.setHidden(${JSON.stringify(initial.iconHidden)});
    sk.setTheme(${JSON.stringify(initial.theme)});
    sk.settings.close();
    return true;
  })()`);
  await sleep(300);
  const modalClosed = await closeSettings();
  check("收尾：设置面板已关闭（不留给后续测试）", modalClosed === true, String(modalClosed));

  const final = await evaluate(`(() => {
    const sk = window.__anonbuddySkin;
    return {
      customIds: sk.customThemes().map((c) => c.id),
      aliases: sk.aliases(),
      theme: document.documentElement.dataset.anonbuddySkin ?? null,
      iconHidden: sk.icon.isHidden(),
      iconVisible: sk.icon.visible(),
    };
  })()`);
  console.log("FINAL=" + JSON.stringify(final));
  check("收尾：自定义皮肤与初始一致", JSON.stringify(final.customIds) === JSON.stringify(initial.customIds), JSON.stringify(final.customIds));
  check("收尾：别名表未变", JSON.stringify(final.aliases) === JSON.stringify(initial.aliases));
  check("收尾：激活主题已还原", final.theme === initial.theme, `${final.theme} vs ${initial.theme}`);
  check("收尾：图标开关已还原", final.iconHidden === initial.iconHidden && final.iconVisible === initial.iconVisible, JSON.stringify(final));
}

await t.finish();
