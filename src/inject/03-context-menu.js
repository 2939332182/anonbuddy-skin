  // ---- 行右键菜单：重命名 / 删除 ----
  // 删除收进右键菜单后，自定义主题行不用再挂行尾 ×，面板更窄；条目也随主题数量增长而保持整洁。
  const ctxMenu = document.createElement("div");
  ctxMenu.id = data.menuId + "-row-menu";
  ctxMenu.style.cssText = "display:none;position:fixed;left:-9999px;top:-9999px;z-index:2;min-width:112px;padding:4px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.97);backdrop-filter:blur(16px);box-shadow:0 8px 24px rgba(0,0,0,.2);";
  let ctxConfirmTimer = 0;
  let ctxTarget = null;

  const closeCtxMenu = () => {
    ctxMenu.style.display = "none";
    ctxTarget = null;
    clearTimeout(ctxConfirmTimer);
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
  };
  // 监听器只在菜单打开期间挂载，避免每次重新注入都往 document 上叠一份（旧脚本的闭包无法回收）
  const onDocPointerDown = (event) => { if (!ctxMenu.contains(event.target)) closeCtxMenu(); };
  const onDocKeyDown = (event) => { if (event.key === "Escape") closeCtxMenu(); };

  const ctxItem = (label, options = {}) => {
    const el = document.createElement("div");
    el.textContent = label;
    el.style.cssText = "padding:6px 10px;border-radius:7px;cursor:pointer;white-space:nowrap;" + (options.danger ? "color:#c03030;" : "");
    el.addEventListener("mouseenter", () => { el.style.background = options.danger ? "rgba(220,60,60,.12)" : "rgba(36,201,215,.16)"; });
    el.addEventListener("mouseleave", () => { el.style.background = "transparent"; });
    el.addEventListener("click", (event) => { event.stopPropagation(); options.onClick(el); });
    return el;
  };

  const openCtxMenu = (item, x, y) => {
    closeCtxMenu();
    ctxTarget = item;
    const id = item.__themeId;
    ctxMenu.textContent = "";
    ctxMenu.appendChild(ctxItem("\u91cd\u547d\u540d", { onClick: () => { closeCtxMenu(); beginRename(item); } }));
    // 「设为开机默认主题」：只给普通主题开放  WE 壁纸条目（we-<id>）引用本机绝对路径，
    // 换台机器就是死链，设成开机默认只会得到一个失效的开局，所以干脆不给这个入口。
    if (typeof id === "string" && id !== "" && id.indexOf("we-") !== 0) {
      const isBoot = readBootTheme() === id;
      ctxMenu.appendChild(ctxItem(isBoot ? "\u2713 \u5f00\u673a\u9ed8\u8ba4" : "\u8bbe\u4e3a\u5f00\u673a\u9ed8\u8ba4\u4e3b\u9898", {
        onClick: () => { closeCtxMenu(); writeBootTheme(isBoot ? null : id); },
      }));
    }
    if (customRows.has(id)) {
      ctxMenu.appendChild(ctxItem("\u5220\u9664", { danger: true, onClick: (el) => {
        // 自定义主题只存在于 localStorage，删掉就真没了 —— 用两次点击代替 confirm（Electron 里没有 window.confirm）
        if (el.__armed) { closeCtxMenu(); deleteCustomTheme(id); return; }
        el.__armed = true;
        el.textContent = "\u518d\u70b9\u4e00\u6b21\u786e\u8ba4\u5220\u9664";
        el.style.background = "rgba(220,60,60,.12)";
        ctxConfirmTimer = setTimeout(closeCtxMenu, 4000);
      } }));
    }
    ctxMenu.style.display = "block";
    ctxMenu.style.left = "-9999px";
    ctxMenu.style.top = "-9999px";
    const box = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = Math.max(4, Math.min(x, innerWidth - box.width - 6)) + "px";
    ctxMenu.style.top = Math.max(4, Math.min(y, innerHeight - box.height - 6)) + "px";
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
  };

  // 行标题 = 当前显示名 + 右键提示；名字被省略号截断时，悬停能看全名
  const syncTitle = (item) => { item.title = item.__text.textContent + item.__hint; };

  const row = (label, dotColor, onPick, options = {}) => {
    const host = options.container ?? panel;
    const item = document.createElement("div");
    item.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;";
    const dot = document.createElement("span");
    dot.style.cssText = "width:10px;height:10px;border-radius:50%;flex:none;background:" + dotColor + ";";
    const text = document.createElement("span");
    text.textContent = label;
    // 名字再长也不撑宽面板（自定义主题的名字常常一长串）
    text.style.cssText = "flex:1;min-width:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    item.append(dot, text);
    item.__text = text;
    item.__dot = dot;
    // __defaultLabel 必须是主题真名，不能是别名 —— 否则「清空还原」会还原成上一次的别名
    item.__defaultLabel = options.defaultLabel ?? label;
    item.__themeId = options.renamable ? (options.id ?? null) : undefined;
    item.__hint = options.menuHint ?? "\uff08\u53f3\u952e\u91cd\u547d\u540d\uff09";
    // 悬停底色：默认是悬浮菜单用的深色蒙层；面板里传 options.hoverBg 换成跟随主题的变量
    // （硬编码 rgba(0,0,0,.05) 在深色设置面板上几乎看不见）。
    item.addEventListener("mouseenter", () => { if (item.style.fontWeight !== "700") item.style.background = options.hoverBg ?? "rgba(0,0,0,.05)"; });
    item.addEventListener("mouseleave", () => {
      // 面板行传了 onLeave 就交给它（重算选中态），否则沿用悬浮菜单的 paint
      if (typeof options.onLeave === "function") { options.onLeave(); return; }
      paint(document.documentElement.dataset.anonbuddySkin ?? null);
    });
    item.addEventListener("click", () => {
      if (item.__editor || Date.now() < renameGuardUntil) return;
      onPick(item);
    });
    if (options.renamable) {
      syncTitle(item);
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openCtxMenu(item, event.clientX, event.clientY);
      });
    }
    if (options.before) host.insertBefore(item, options.before); else host.appendChild(item);
    return item;
  };

  const isLightSurface = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return true;
    const v = parseInt(m[1], 16);
    return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) > 140;
  };

  // 深/浅色类名。WorkBuddy 有 ~2600 条 "body.vscode-light .xxx" / "body.cb-light .xxx"
  // 这样的「祖先类 + 后代」规则（图标主题那套），每次增删这些类都要让引擎
  // 把所有规则对整棵 DOM 重新匹配一遍。
  //
  // ⚠️ 性能坑（2026-09-19 实测，一次切主题卡 55~65ms）：
  //   classList.toggle(cls, false) 在类本来就不存在时**什么都不改变**，
  //   但浏览器仍然会把它当作一次 mutation 去失效样式 —— 白白付一遍全量重匹配的钱。
  //   实测「移除 light 三件套」= 46.5ms，而「再加回来」= 0.1ms
  //   （因为加的时候它们已经在了，是真的 no-op）。
  //   所以下面必须**先判断是否真的需要改**，只动真正变化的类。
  //   另外：深浅切换时 body 与 html 是各自独立的，也要分别判断，
  //   否则 html 白白多付一遍（两个节点合计占到原来一半的开销）。
  const MODE_CLASSES = [
    ["light", false], ["vscode-light", false], ["cb-light", false],
    ["dark", true], ["vscode-dark", true], ["cb-dark", true],
  ];
  // 返回真正被改过的类名，便于测试断言"没有多余改动"
  const syncModeClasses = (el, dark) => {
    const changed = [];
    for (const [cls, isDarkCls] of MODE_CLASSES) {
      const want = dark ? isDarkCls : !isDarkCls;
      // 关键：命中这个分支就完全不动 DOM，不产生 mutation，也就没有重匹配
      if (el.classList.contains(cls) === want) continue;
      el.classList.toggle(cls, want);
      changed.push(cls);
    }
    return changed;
  };

  // 同步切换 WorkBuddy 的 VS Code 主题模式，让原生控件（输入框/按钮等）跟着深浅色变
  // 记录当前皮肤底色：外观护栏的兜底纠正需要它来重算
  let activeSurface = null;
  // 皮肤是否正在接管外观。false = 用户选了「原生」/ 皮肤已卸下，
  // 此时必须把 data-skin 撤掉、外观护栏解开，让 WorkBuddy 自带外观重新自理。
  // （声明必须早于 applyMode 的首次调用；真正的赋值在 setTheme / clearTheme / applyCustomTheme）
  let skinOwned = true;
  // 「切到普通主题 / 选原生时要把 WE 视频收掉」的钩子。
  // setTheme / applyCustomTheme / clearTheme 定义在 WE 区块之前，但都是运行时才调用，
  // 所以这里前置声明成空函数，实现在 WE 区块里赋值（直接引用会撞 const 的 TDZ）。
  let onLeaveWeTheme = () => {};
  // 「主题变了就顺手刷新设置面板自身的配色」的钩子。
  // 必须前置声明成空函数：applyMode 在初始化阶段就会被调用（此时 syncPaneThemeVars 还没定义，
  // 直接引用会撞 const 的 TDZ）。真正的实现在 syncPaneThemeVars / ensureModalSurface 之后赋值。
  let refreshPaneChrome = () => {};
  const applyMode = (surface) => {
    const dark = !isLightSurface(surface);
    activeSurface = surface;
    const body = document.body;
    const html = document.documentElement;
    if (body.dataset.vscodeThemeKind !== (dark ? "vscode-dark" : "vscode-light")) {
      body.dataset.vscodeThemeKind = dark ? "vscode-dark" : "vscode-light";
    }
    if (body.dataset.vscodeThemeName !== (dark ? "IDE Dark" : "IDE Light")) {
      body.dataset.vscodeThemeName = dark ? "IDE Dark" : "IDE Light";
    }
    const wantScheme = dark ? "dark" : "light";
    if (html.style.colorScheme !== wantScheme) html.style.colorScheme = wantScheme;
    // ⚠️ 必须自己写 html[data-theme]（2026-09-20 修）
    // 原生写它的那条路径是 ThemeManager.applyTheme，而那条路径**见到 data-skin 就提前 return**
    // （见上方 data-skin 契约）。于是皮肤接管期间没人写它 —— 不写就会停在"接管前"的旧值，
    // 靠 html[data-theme] 取色的那部分自带 UI 要等下一次 React 重渲染才刷新。
    // 症状：在插件设置里切主题后自带外观深浅不对，点一下左下角个人中心才变正常。
    if (html.getAttribute("data-theme") !== wantScheme) html.setAttribute("data-theme", wantScheme);
    syncModeClasses(body, dark);
    syncModeClasses(html, dark);
    // 换肤即换外观：把同一个深浅决定同步给 WorkBuddy 自带的外观系统
    // （applyMode 是所有主题切换路径的唯一汇合点，见 setTheme / applyCustomTheme / clearTheme）
    // skinOwned=false（用户选了「原生」）时不写 data-skin、不改持久化 —— 那时代管权已交还原生。
    if (skinOwned) syncAppearance(dark);
    // 面板配色是"跟随弹窗底色"算出来的（不是跟随皮肤），弹窗底色会随主题变 → 必须重算。
    // 初始化时这个钩子还是空函数（syncPaneThemeVars 尚未定义），赋值见下方。
    refreshPaneChrome();
  };

