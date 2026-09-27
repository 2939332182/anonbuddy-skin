const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const DEFAULT_ACCENT = "#24c9d7";
// 插件图标：允许的图片 data URL（png/jpeg/webp/gif/svg）
const ICON_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i;

// 客户端 CSS 由 Node 端模板加哨兵生成，替换后与内置主题同源，避免两套模板漂移
export const CSS_SENTINELS = {
  id: "workbuddy-custom-sentinel-id",
  hero: "data:image/png;base64,WORKBUDDYHEROSENTINEL",
  accent: "#010203",
  secondary: "#040506",
  surface: "#070809",
  text: "#0a0b0c",
};

export function buildSkinMenuScript({ entries, activeId, styleId, menuId, cssTemplate = "", restoreLast = false, iconDataUrl = null, weItems = [], weRepkgAvailable = false }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("皮肤菜单至少需要一个主题");
  }
  const themes = entries.map((entry) => {
    if (!entry?.id || typeof entry.css !== "string") throw new Error("主题条目缺少 id 或 css");
    return {
      id: String(entry.id),
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : String(entry.id),
      accent: HEX_COLOR.test(entry.accent ?? "") ? entry.accent : DEFAULT_ACCENT,
      surface: typeof entry.surface === "string" ? entry.surface : "#ffffff",
      css: entry.css,
    };
  });
  if (activeId !== null && !themes.some((theme) => theme.id === activeId)) {
    throw new Error(`当前主题不在菜单列表中：${activeId}`);
  }
  const payload = JSON.stringify({
    styleId,
    menuId,
    activeId,
    restoreLast: Boolean(restoreLast),
    themes,
    cssTemplate,
    // 插件图标（可选）：给了就贴图，没给就用默认的 🎨 emoji
    icon: ICON_DATA_URL.test(iconDataUrl ?? "") ? iconDataUrl : null,
    sentinels: CSS_SENTINELS,
    // Wallpaper Engine 壁纸目录（本机路径，方案 A：file:// 直读）。
    // 只含 id/标题/类型/体积/两个 file:// URL，几 KB —— 不传媒体字节。
    weItems: Array.isArray(weItems) ? weItems.filter((x) => x && typeof x.id === "string" && typeof x.fileUrl === "string") : [],
    // 装了 RePKG 就能把 scene 的静态图从 1K 缩略图升级到 4K 原图（见 we-extract.mjs）
    weRepkgAvailable: Boolean(weRepkgAvailable),
    // 旧版单主题：id 固定 custom-upload，键 workbuddyCustomTheme（首次运行会迁移进 customListKey）
    customId: "custom-upload",
    storageKey: "workbuddyCustomTheme",
    customListKey: "workbuddyCustomThemes",
    // 设置面板集成：往「功能」分组插一个入口，右侧内容区渲染我们的面板
    pluginName: "ChihayaAnon 插件",
    // 分组名直写中文即可：这个对象字面量在 Node 侧构造、再作为 payload 传进 renderer，
    // 并不在模板字符串里，所以不需要（也不能）写成双反斜杠的 \uXXXX ——
    // 写成 "\\u529f\\u80fd" 会被解析成 12 个字符的字面量，和分组标题 "功能" 永不相等，
    // 于是主匹配失效、只能落到兜底分组上（旧版恰好 groups[1] 就是「功能」，所以没暴露）。
    settingsNavGroup: "功能",
    settingsNavSelector: ".settings-navigation__group",
    // 设置弹窗的根容器。5.6.x 把设置从「主窗口内弹层」改成了「独立窗口」：
    // 外层类名随之由 .settings-modal-overlay 变成 .settings-modal--window，
    // 内层（.settings-navigation / .settings-modal__content / __panel）两版完全一致。
    // 所以这里不写死单一类名，改为按候选逐个试。
    // settingsOverlaySelector 保留下来给测试与外部脚本用，取值是两版都存在的内层容器。
    settingsRootSelectors: [".settings-modal-overlay", ".settings-modal--window", ".settings-modal"],
    settingsOverlaySelector: ".settings-modal",
    // ⚠️ 必须走 payload 传进去：DEFAULT_ACCENT 是**模块作用域**常量（本文件第 2 行），
    // 而下面返回的整段脚本是模板字符串，在 renderer 里 eval，读不到 Node 侧作用域。
    // 直接写 DEFAULT_ACCENT 会抛 ReferenceError（2026-09-19 踩过，见文件末尾 lint 守卫）。
    defaultAccent: DEFAULT_ACCENT,
  });

  return `(() => {
  const data = ${payload};

  // 幂等收尾：apply 会被反复调用（启动 / 换主题 / 测试脚本），每次都 eval 一遍整段脚本。
  // 卸载上一个实例时只删 DOM 节点是不够的 —— 旧实例的 MutationObserver 和 1.5s setInterval
  // 还活着，会继续把主标题拆成逐字节点。结果就是 pause 时已经合并好的文本被旧实例
  // "拆回去"，看起来像 restore 完全失效（实测踩过：第一次 pause 有效，之后全部无效）。
  // 所以这里必须显式把上一个实例停掉，且顺序在创建新实例之前。
  try { window.__anonbuddySkin?.copy?.stop?.(); } catch {}
  try { window.__anonbuddySkin?.dispose?.(); } catch {}
  delete window.__anonbuddySkin;

  let style = document.getElementById(data.styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = data.styleId;
    document.head.appendChild(style);
  }

  document.getElementById(data.menuId)?.remove();
  const root = document.createElement("div");
  root.id = data.menuId;
  root.style.cssText = "position:fixed;z-index:2147483000;font:500 13px/1.4 system-ui;user-select:none;";

  const button = document.createElement("button");
  button.type = "button";
  button.title = "AnonBuddy Skin\\uff08\\u53ef\\u62d6\\u52a8\\uff09";
  // 按钮外形统一，只有"图标来源"分两种：自定义图片 / 默认 emoji
  const buttonBase = "display:block;width:38px;height:38px;border-radius:50%;border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.92);box-shadow:0 3px 12px rgba(0,0,0,.24);cursor:grab;line-height:1;padding:0;touch-action:none;";
  if (data.icon) {
    // 自定义图标：整图 cover 填满圆形（素材请用正方形、主体居中）
    button.style.cssText = buttonBase + "background-image:url(" + JSON.stringify(data.icon) + ");background-size:cover;background-position:center;background-repeat:no-repeat;";
  } else {
    button.textContent = "\\u{1F3A8}";
    button.style.cssText = buttonBase + "backdrop-filter:blur(10px);font-size:19px;font-family:system-ui,'Segoe UI Emoji','Apple Color Emoji',sans-serif;";
  }

  const panel = document.createElement("div");
  panel.style.cssText = "display:none;position:absolute;top:46px;right:0;min-width:200px;max-height:min(72vh,560px);overflow-y:auto;overscroll-behavior:contain;padding:6px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.94);backdrop-filter:blur(16px);box-shadow:0 10px 30px rgba(0,0,0,.18);color:#17344f;";

  const rows = new Map();
  const paint = (id) => {
    for (const [rowId, row] of rows) {
      row.style.background = rowId === id ? "rgba(36,201,215,.16)" : "transparent";
      row.style.fontWeight = rowId === id ? "700" : "500";
    }
  };
  // ---- 主题别名：右键重命名，结果存 localStorage（与自定义主题、图标位置同一套持久化）----
  // 只改显示名，不动磁盘上的主题目录 / theme.json，所以内置主题也能改名。
  const ALIAS_KEY = "anonbuddySkinAliases";
  const NATIVE_ALIAS_KEY = "__native__";
  const aliasKeyOf = (id) => (id === null ? NATIVE_ALIAS_KEY : String(id));
  let aliases = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ALIAS_KEY) ?? "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch { return {}; }
  })();
  const writeAliases = () => { try { localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases)); } catch {} };
  const aliasOf = (id) => {
    const value = aliases[aliasKeyOf(id)];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const displayName = (id, fallback) => aliasOf(id) ?? fallback;

  let activeEditor = null;
  // 失焦保存后浏览器还会补一个 click 事件，用时间戳挡住它，避免"改完名字顺手把主题也切了"
  let renameGuardUntil = 0;

  const finishRename = (item, input, save) => {
    if (item.__editor !== input) return;
    item.__editor = null;
    if (activeEditor === input) activeEditor = null;
    renameGuardUntil = Date.now() + 400;
    input.replaceWith(item.__text);
    if (!save) return;
    const next = input.value.trim();
    const fallback = item.__defaultLabel;
    const key = aliasKeyOf(item.__themeId);
    if (!next || next === fallback) delete aliases[key];
    else aliases[key] = next;
    writeAliases();
    item.__text.textContent = next || fallback;
    syncTitle(item);
  };

  const beginRename = (item) => {
    if (activeEditor) return;
    const input = document.createElement("input");
    input.type = "text";
    input.value = item.__text.textContent;
    input.placeholder = item.__defaultLabel;
    input.title = "\\u56de\\u8f66\\u4fdd\\u5b58 \\u00b7 Esc \\u53d6\\u6d88 \\u00b7 \\u6e05\\u7a7a\\u540e\\u56de\\u8f66\\u6062\\u590d\\u9ed8\\u8ba4";
    // 根节点是 user-select:none，输入框必须显式开回文本选择
    input.style.cssText = "flex:1;min-width:0;font:inherit;font-weight:600;color:#17344f;padding:2px 6px;border-radius:6px;border:1px solid rgba(36,201,215,.8);background:#fff;outline:none;user-select:text;-webkit-user-select:text;";
    item.__editor = input;
    activeEditor = input;
    item.__text.replaceWith(input);
    input.focus();
    input.select();
    ["click", "pointerdown", "mousedown"].forEach((type) => {
      input.addEventListener(type, (event) => event.stopPropagation());
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") { event.preventDefault(); finishRename(item, input, true); }
      else if (event.key === "Escape") { event.preventDefault(); finishRename(item, input, false); }
    });
    input.addEventListener("blur", () => finishRename(item, input, true));
  };

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
    ctxMenu.appendChild(ctxItem("\\u91cd\\u547d\\u540d", { onClick: () => { closeCtxMenu(); beginRename(item); } }));
    // 「设为开机默认主题」：只给普通主题开放  WE 壁纸条目（we-<id>）引用本机绝对路径，
    // 换台机器就是死链，设成开机默认只会得到一个失效的开局，所以干脆不给这个入口。
    if (typeof id === "string" && id !== "" && id.indexOf("we-") !== 0) {
      const isBoot = readBootTheme() === id;
      ctxMenu.appendChild(ctxItem(isBoot ? "\\u2713 \\u5f00\\u673a\\u9ed8\\u8ba4" : "\\u8bbe\\u4e3a\\u5f00\\u673a\\u9ed8\\u8ba4\\u4e3b\\u9898", {
        onClick: () => { closeCtxMenu(); writeBootTheme(isBoot ? null : id); },
      }));
    }
    if (customRows.has(id)) {
      ctxMenu.appendChild(ctxItem("\\u5220\\u9664", { danger: true, onClick: (el) => {
        // 自定义主题只存在于 localStorage，删掉就真没了 —— 用两次点击代替 confirm（Electron 里没有 window.confirm）
        if (el.__armed) { closeCtxMenu(); deleteCustomTheme(id); return; }
        el.__armed = true;
        el.textContent = "\\u518d\\u70b9\\u4e00\\u6b21\\u786e\\u8ba4\\u5220\\u9664";
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
    item.__hint = options.menuHint ?? "\\uff08\\u53f3\\u952e\\u91cd\\u547d\\u540d\\uff09";
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

  // ==================== 与 WorkBuddy 自带「外观（浅色/深色）」联动 ====================
  //
  // 【为什么要做这件事】
  // 皮肤只换 CSS 变量与底色，WorkBuddy 自带的「外观」是另一套完全独立的系统：
  //   - localStorage 'agent-ui-theme'（旧版全局配置）
  //   - localStorage 'workbuddy.appearance.mode::<accountType>::<eid>::<uid>'（账号维度）
  //   - localStorage 'workbuddy.appearance.lastApplied'（外观面板落下的快照）
  //   - 以及原生 ThemeManager 对 DOM 的写入（见下）
  // 两边都往同一批「输出」上写，于是会打架：
  //   body/html 的 light|cb-light|vscode-light（或 dark 三件套）、
  //   body[data-vscode-theme-kind]、body[data-vscode-theme-name]、
  //   html[data-theme]、html.style.colorScheme
  // 皮肤是「浅色主题 + 原生深色」时，原生深色把 foundation 的 .dark token 叠上来，
  // 皮肤 CSS 明明加载了界面却发暗；反之亦然。所以要求：**换肤即换外观，只有一个主导者**。
  //
  // 【原生给我们的现成接口：'data-skin'】
  // 反编译 asar 可见原生自己也有一套「个性皮肤」（SkinManager + ThemeManager）：
  //   - SkinManager.applyTheme() → 写 '<html data-skin="<resourceKey>">' + 'clearThemeClasses()'
  //   - ThemeManager.applyTheme({ skipWhenSkinActive: true }) → 若 '<html>' 有 'data-skin' 就直接 return
  //   - ThemeManager 的 MutationObserver（syncThemeClassesFromAttribute）→ 开头
  //     'if (document.documentElement.hasAttribute("data-skin")) return;'
  //   - 还有公开方法 'overrideThemeForSkin("light")'，让 React 侧 useTheme() 跟随
  // 实测确认（scripts/_probe-appearance-observer.mjs）：
  //   · 无 data-skin 时手改 body[data-vscode-theme-kind] → 原生观察器**自动把类名同步过去**
  //   · 有 data-skin 时同样的写入被原生**忽略**（提前 return）
  // 也就是说：**打上 'data-skin' 就等于向原生声明「界面配色由皮肤接管」**，原生会主动让位。
  // 这正是我们需要的「覆盖在原生外观逻辑之上」，而且不需要猴子补丁任何原生函数。
  //
  // 【但 skin.css 里所有原生深色规则的选择器都带 'body.vscode-light' / 'body.cb-light'】
  // 所以类名**不能**交给原生去写深色 —— 那样皮肤自己的 '.vscode-dark' 规则会反过来命中。
  // 结论：'data-skin' 只用来「关掉原生的自动同步」，真正的类名由 applyMode() 按主题深浅自己写。
  // 两者配合 = 皮肤永远赢。
  //
  // 【组件级深浅仍要跟原生保持一致】
  // 原生 ThemeManager.overrideThemeForSkin(mode) 会更新 currentConfig + 通知 useTheme()，
  // 有些组件（含原生个性皮肤路径）靠它决定内部深浅。我们以「只调用、不依赖」的方式接上：
  // 抓得到就调（让组件跟随皮肤），抓不到也绝不能因为少调一次而抛错 —— 见下面 try/catch。
  // 注意：拿不到模块作用域里的 themeManager 实例，但 React root 的 fiber 上存着
  // provider 的 context 值；用 fiber 遍历找到 { theme } context 并 mock 出同样的方法。

  // 实例是否已卸载：本段的轮询回调要靠它变空操作（真正的赋值在下方 dispose 一带，
  // 这里先声明是因为下面的 interval 闭包里会读它）
  let stopped = false;

  const readAccountScopedModeKey = () => {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.indexOf("workbuddy.appearance.mode::") === 0 && key.indexOf("legacy-snapshot") === -1) return key;
      }
    } catch {}
    return null;
  };

  // 找到原生 ThemeManager 的 context 值（带 overrideThemeForSkin / setTheme / getTheme）
  const findNativeThemeContext = () => {
    const root = document.getElementById("root");
    if (!root) return null;
    // React 把 fiber 挂在容器元素的这个属性上（17/18 都是 __reactContainer$xxx）
    const containerKey = Object.keys(root).find((k) => k.indexOf("__reactContainer$") === 0);
    let fiber = containerKey ? root[containerKey] : null;
    if (!fiber) return null;
    // 找 current 指向的树
    fiber = fiber.current ?? fiber;
    const seen = new Set();
    const queue = [fiber];
    const hookFiber = (node) => {
      if (!node || typeof node !== "object" || seen.has(node) || seen.size > 4000) return null;
      seen.add(node);
      const deps = node.dependencies;
      const ctx = deps && deps.firstContext;
      if (ctx) {
        let c = ctx;
        let guard = 0;
        while (c && guard < 40) {
          const v = c.memoizedValue;
          if (v && typeof v.overrideThemeForSkin === "function") return v;
          c = c.next; guard += 1;
        }
      }
      return null;
    };
    while (queue.length) {
      const node = queue.shift();
      const hit = hookFiber(node);
      if (hit) return hit;
      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
    }
    return null;
  };

  // 把「皮肤决定的深浅」同步给 WorkBuddy 自带的外观系统。
  // 顺序很重要：先打 data-skin（关掉原生自动同步）→ 再写类名（皮肤自己说了算）→ 最后持久化。
  const syncAppearance = (dark) => {
    const mode = dark ? "dark" : "light";

    // ① 声明皮肤接管：原生 ThemeManager 见到 data-skin 就不再自写深浅
    if (document.documentElement.getAttribute("data-skin") !== "wb-skin-studio") {
      document.documentElement.setAttribute("data-skin", "wb-skin-studio");
    }

    // ② 账号维度偏好：换肤即换外观，让原生下次冷启动读到一致的初值
    const scopedKey = readAccountScopedModeKey();
    if (scopedKey) {
      try {
        if (localStorage.getItem(scopedKey) !== mode) localStorage.setItem(scopedKey, mode);
      } catch {}
    }

    // ③ 组件级深浅：让 useTheme() 跟随（拿不到就静默跳过，绝不影响换肤本身）
    try {
      const ctx = findNativeThemeContext();
      if (ctx && typeof ctx.overrideThemeForSkin === "function") ctx.overrideThemeForSkin(mode);
    } catch {}

    // ④ 外观护栏：锁住与皮肤深浅**相反**的那一侧
    //    （浅色皮肤锁深色；深色皮肤锁浅色 —— 深底皮肤配浅色外观会露出原生浅色底，显示异常）
    enforceAppearanceGuard(dark ? "light" : "dark");
  };

  // 交还外观控制权（用户选了「原生」，或皮肤被卸下）：
  // 撤掉 data-skin 让原生 ThemeManager 恢复自理，解开外观护栏，
  // 并把 DOM 恢复到用户上次在原生外观面板里选的那个深浅。
  // 注意方向必须反着来：先解除皮肤接管，再让原生自己写，否则会被我们的类名盖住。
  const releaseAppearanceOwnership = () => {
    document.documentElement.removeAttribute("data-skin");
    enforceAppearanceGuard(null);
    const scopedKey = readAccountScopedModeKey();
    let mode = "light";
    try {
      const stored = scopedKey ? localStorage.getItem(scopedKey) : null;
      if (stored === "dark" || stored === "light") mode = stored;
      else {
        // 账号维度 key 缺失时退回旧版全局配置（原生自己也这么兜底）
        const legacy = JSON.parse(localStorage.getItem("agent-ui-theme") ?? "null");
        if (legacy && typeof legacy === "object") {
          if (legacy.followSystem) {
            mode = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
          } else if (legacy.theme === "dark" || legacy.theme === "light") mode = legacy.theme;
        }
      }
    } catch {}
    try {
      const ctx = findNativeThemeContext();
      if (ctx && typeof ctx.overrideThemeForSkin === "function") ctx.overrideThemeForSkin(mode);
    } catch {}
  };

  // ---- 「外观禁用」护栏（极性化，2026-09-20 由单向改为双向）----
  // 需求：**皮肤与外观必须同深浅**，禁止把外观切到与皮肤相反的那一侧。
  //   · 浅色系皮肤 → 禁止切「深色」（原行为，保留）
  //   · 深色系皮肤 → 禁止切「浅色」（本次新增：深底皮肤 + 浅色外观会露出原生浅色底，显示异常）
  // 所以护栏不是"永远锁深色"，而是"锁住与皮肤相反的那一侧"：
  //   lockedPolarity = 皮肤浅 ? "dark" : "light"；皮肤卸下（选「原生」）时为 null。
  // 做法分三层，缺一不可：
  //   1) 视觉层：给「被锁的那一侧」按钮加禁用态（半透明 + not-allowed）
  //   2) 行为层：捕获阶段拦截 pointerdown/click，吞掉事件（原生按钮没有 disabled 概念，
  //      只能由我们拦；用捕获阶段才抢在 React 的委托监听之前）
  //   3) 兜底层：万一被别处（快捷键 / 原生 setTheme）切成被锁的那一侧，观察 body 的
  //      data-vscode-theme-kind 把它按回皮肤那一侧 —— 但**只在皮肤接管期间**，
  //      否则会在原生皮肤模式下误伤用户自己的选择。
  const APPEARANCE_LOCK_ATTR = "data-wb-appearance-lock";
  // 被锁住的那一侧："dark" | "light" | null（null = 不锁，交还原生）
  let lockedPolarity = null;

  const themeOptionButtons = () => [...document.querySelectorAll(".user-menu-popover .user-menu-theme-option")];
  // 选项文案判定：/浅色|Light/ 命中的就是「浅色」那一侧
  const isLightOptionEl = (el) => /浅色|Light/i.test(el.textContent || "");
  const isLockedOption = (isLightOption) =>
    lockedPolarity !== null && (lockedPolarity === "light") === isLightOption;

  const syncAppearanceGuardUi = () => {
    const options = themeOptionButtons();
    if (!options.length) return;
    for (const el of options) {
      if (!isLockedOption(isLightOptionEl(el))) {
        if (el.dataset.wbLocked === "1") {
          el.removeAttribute("data-wb-locked");
          el.style.removeProperty("opacity");
          el.style.removeProperty("cursor");
          el.style.removeProperty("pointer-events");
          el.removeAttribute("aria-disabled");
          el.removeAttribute("title");
        }
        continue;
      }
      if (el.dataset.wbLocked === "1") continue;
      el.dataset.wbLocked = "1";
      // ⚠️ 不能只写 pointer-events:none —— 那样连捕获阶段的监听器也收不到事件；
      // 我们要的是「收得到但吞掉」，所以只做视觉禁用，拦截交给监听器。
      el.style.opacity = "0.4";
      el.style.cursor = "not-allowed";
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("title", lockedPolarity === "dark"
        ? "当前皮肤为浅色系，已禁用深色外观"
        : "当前皮肤为深色系，已禁用浅色外观");
    }
  };
  const enforceAppearanceGuard = (polarity) => {
    lockedPolarity = polarity === "dark" || polarity === "light" ? polarity : null;
    if (lockedPolarity) document.documentElement.setAttribute(APPEARANCE_LOCK_ATTR, lockedPolarity);
    else document.documentElement.removeAttribute(APPEARANCE_LOCK_ATTR);
    syncAppearanceGuardUi();
  };

  // 捕获阶段吞掉对「被锁那一侧」按钮的点击（原生按钮是 <button type=button>，没有 disabled）
  const onGuardCapture = (event) => {
    if (!lockedPolarity) return;
    const target = event.target instanceof Element ? event.target.closest(".user-menu-theme-option") : null;
    if (!target) return;
    // 点的不是被锁的那一侧 → 放行
    if (!isLockedOption(isLightOptionEl(target))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener("pointerdown", onGuardCapture, true);
  document.addEventListener("click", onGuardCapture, true);

  // 个人中心浮层是 React portal，点了才挂载，每次都是新节点。
  // 光靠 600ms 轮询会在「刚打开就操作」的窗口里闪一下未同步的按钮，
  // 所以再挂一个只盯 <body> 直接子节点增减的轻量观察器 —— 浮层出现时**立刻**刷一次。
  // （只 observe childList 不 observe subtree：portal 是 body 的直接子节点，
  //   这样不会把弹窗内部的频繁渲染也拉到回调里来。）
  // 注意这里**不**按 lockedPolarity 提前 return：解锁后浮层再开时也要能把
  // 可能残留的禁用态清掉，而 syncAppearanceGuardUi 本身在无锁时就是纯清理。
  const guardUiObserver = new MutationObserver(() => {
    if (stopped) return;
    if (!document.querySelector(".user-menu-popover")) return;
    syncAppearanceGuardUi();
  });
  guardUiObserver.observe(document.body, { childList: true });

  // 兜底：外观被别处切成「被锁那一侧」时按回皮肤那一侧（仅在皮肤接管期间）
  let guardWatchTimer = null;
  const startGuardWatch = () => {
    if (guardWatchTimer !== null) return;
    guardWatchTimer = setInterval(() => {
      if (stopped) return;
      if (lockedPolarity && activeSurface !== null) {
        const lockedKind = lockedPolarity === "dark" ? "vscode-dark" : "vscode-light";
        if (document.body.getAttribute("data-vscode-theme-kind") === lockedKind) {
          applyMode(activeSurface);
        }
      }
      syncAppearanceGuardUi();
      // 侧边栏被 React 重建时会丢掉内联的模糊变量 → 顺手补回（只在真的不一致时写，平时是空操作）
      reapplySidebarBlur();
    }, 600);
  };

  // ---- 记住上次用的主题：重启后由 apply --theme last 自动恢复（自定义主题也能恢复）----
  const LAST_KEY = "anonbuddySkinLastTheme";
  const NATIVE_MARK = "__native__";
  const readLastTheme = () => {
    try { return localStorage.getItem(LAST_KEY); } catch { return null; }
  };
  const writeLastTheme = (value) => {
    try { localStorage.setItem(LAST_KEY, value); } catch {}
  };
  // 开机默认主题：用户在右键菜单里显式指定的那个，优先级高于自动记录的 LAST_KEY。
  const BOOT_KEY = "anonbuddySkinBootTheme";
  const readBootTheme = () => {
    try { return localStorage.getItem(BOOT_KEY); } catch (error) { return null; }
  };
  const writeBootTheme = (value) => {
    try { localStorage.setItem(BOOT_KEY, value || ""); } catch (error) {}
  };
  // 存的主题可能已经被删掉（比如自定义主题被右键删除），这时要能判断出"已失效"
  const canApplyTheme = (id) => id !== NATIVE_MARK
    && (customThemes.some((candidate) => candidate.id === id) || data.themes.some((candidate) => candidate.id === id));

  const setTheme = (id) => {
    // 自定义上传的主题不在 data.themes 里，从本地保存的列表里取，避免为了恢复它而重新压缩图片
    const custom = customThemes.find((candidate) => candidate.id === id);
    if (custom) { applyCustomTheme(custom); return; }
    const theme = data.themes.find((candidate) => candidate.id === id);
    if (!theme) return;
    onLeaveWeTheme();
    skinOwned = true;
    style.textContent = theme.css;
    document.documentElement.dataset.anonbuddySkin = theme.id;
    applyMode(theme.surface);
    paint(theme.id);
    writeLastTheme(theme.id);
  };
  const clearTheme = () => {
    // 交还给 WorkBuddy 自带外观：撤掉 data-skin（让原生 ThemeManager 恢复自理）、
    // 解开外观护栏，并把外观状态恢复成用户上次在原生面板里选的那个。
    onLeaveWeTheme();
    skinOwned = false;
    style.textContent = "";
    delete document.documentElement.dataset.anonbuddySkin;
    releaseAppearanceOwnership();
    applyMode("#ffffff");
    paint(null);
    writeLastTheme(NATIVE_MARK);
  };

  // 5.6.x 的设置是独立窗口：在那边点主题只改它自己的 DOM，主窗口不会跟着变
  // （实测：在设置窗口调 setTheme 后，主窗口的 dataset.anonbuddySkin 纹丝不动，
  //  但 localStorage 已经写进去了）。两个窗口共享同一个 file:// origin 的
  // localStorage，所以用 storage 事件把状态同步过去。
  // 该事件只在"别的窗口"写入时触发，本窗口自己写不会触发，天然不会形成回环；
  // 再加一道值比较，避免重复应用。
  //
  // ⚠️ 要同步的不止主题：Wallpaper Engine 壁纸走的是另外两个键
  //    （WE_THEME_KEY / WE_PAUSED_KEY）。只盯 LAST_KEY 的话，
  //    在设置窗口里点「应用」换壁纸，主窗口不会有任何反应。
  window.addEventListener("storage", (event) => {
    if (!event) return;

    if (event.key === LAST_KEY) {
      const current = document.documentElement.dataset.anonbuddySkin ?? null;
      const next = event.newValue;
      if (!next || next === NATIVE_MARK) {
        if (current) clearTheme();
        return;
      }
      if (next === current) return;
      if (canApplyTheme(next)) setTheme(next);
      return;
    }

    if (event.key === WE_THEME_KEY) {
      syncWeFromStorage();
      return;
    }

    if (event.key === WE_PAUSED_KEY) {
      wePaused = readWePaused();
      syncBgVideoPlayback();
      syncWeUi();
    }
  });

  for (const theme of data.themes) {
    rows.set(theme.id, row(displayName(theme.id, theme.name), theme.accent, () => { setTheme(theme.id); panel.style.display = "none"; }, { id: theme.id, renamable: true, defaultLabel: theme.name }));
  }

  // ---- 自定义图片：本地选图 -> 压缩 -> 取色 -> 生成 CSS -> 持久化 ----
  // 多主题：每个上传的图片都是独立条目，存成一个数组，互不覆盖。
  const buildCustomCss = (dataUrl, colors, id) => data.cssTemplate
    .split(data.sentinels.hero).join(dataUrl)
    .split(data.sentinels.accent).join(colors.accent)
    .split(data.sentinels.secondary).join(colors.secondary)
    .split(data.sentinels.surface).join(colors.surface)
    .split(data.sentinels.text).join(colors.text)
    .split(data.sentinels.id).join(id);

  const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  const extractPalette = (canvas) => {
    const ctx = canvas.getContext("2d");
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map();
    let lumSum = 0, count = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum; count += 1;
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.18 || lum < 24 || lum > 245) continue;   // 灰、过暗、过曝不参与取主色
      const d = max - min || 1;
      let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const bucket = Math.round(h) % 6 * 2 + (sat > 0.55 ? 1 : 0);
      const entry = buckets.get(bucket) ?? { w: 0, r: 0, g: 0, b: 0, h: h * 60 };
      const weight = sat * sat;
      entry.w += weight; entry.r += r * weight; entry.g += g * weight; entry.b += b * weight;
      buckets.set(bucket, entry);
    }
    const avgLum = count ? lumSum / count : 128;
    const ranked = [...buckets.values()].sort((a, b2) => b2.w - a.w)
      .map((e) => ({ rgb: [e.r / e.w, e.g / e.w, e.b / e.w], h: e.h, w: e.w }));
    const accent = ranked[0]?.rgb ?? [36, 201, 215];
    const second = ranked.find((e) => Math.abs(e.h - (ranked[0]?.h ?? 0)) > 50)?.rgb
      ?? mix(accent, [255, 255, 255], 0.35);
    const light = avgLum > 128;
    const surface = light ? mix(accent, [252, 252, 255], 0.92) : mix(accent, [12, 12, 18], 0.86);
    const text = light ? mix(accent, [16, 24, 40], 0.82) : mix(accent, [244, 246, 252], 0.85);
    return {
      accent: hex(...accent),
      secondary: hex(...second),
      surface: hex(...surface),
      text: hex(...text),
    };
  };

  // 每个上传的图片是一条独立记录：{ id, name, dataUrl, colors }，存成数组，互不覆盖。
  const customThemes = [];
  const customRows = new Map();

  const newCustomId = () => "custom-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const normalizeCustom = (raw, fallbackId) => {
    if (!raw || typeof raw.dataUrl !== "string" || !raw.colors) return null;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : (fallbackId ?? newCustomId()),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "\\u6211\\u7684\\u56fe\\u7247",
      dataUrl: raw.dataUrl,
      colors: raw.colors,
    };
  };

  const writeCustomThemes = () => {
    try { localStorage.setItem(data.customListKey, JSON.stringify(customThemes)); return true; }
    catch (error) {
      console.warn("WorkBuddy Skin：自定义主题已占满 localStorage 配额，本次生效但重启后不保留；可在右键菜单里删掉几张旧图", error);
      return false;
    }
  };

  // 读取历史自定义主题；旧版只存了单个（键 workbuddyCustomTheme），首次运行自动迁移进数组
  const readCustomThemes = () => {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(data.customListKey) ?? "null"); } catch {}
    if (Array.isArray(stored)) return stored.map((raw) => normalizeCustom(raw)).filter(Boolean);
    try {
      const legacy = JSON.parse(localStorage.getItem(data.storageKey) ?? "null");
      const migrated = normalizeCustom(legacy ? { ...legacy, id: data.customId } : null);
      if (migrated) {
        try {
          localStorage.setItem(data.customListKey, JSON.stringify([migrated]));
          localStorage.removeItem(data.storageKey);
        } catch {}
        return [migrated];
      }
    } catch {}
    return [];
  };

  const applyCustomTheme = (theme) => {
    onLeaveWeTheme();
    skinOwned = true;
    style.textContent = buildCustomCss(theme.dataUrl, theme.colors, theme.id);
    document.documentElement.dataset.anonbuddySkin = theme.id;
    applyMode(theme.colors.surface);
    paint(theme.id);
    writeLastTheme(theme.id);
  };

  const renderCustomRow = (theme) => {
    const item = row(displayName(theme.id, theme.name), theme.colors.accent, () => { applyCustomTheme(theme); panel.style.display = "none"; }, {
      before: uploadRow,
      id: theme.id,
      renamable: true,
      defaultLabel: theme.name,
      menuHint: "\\uff08\\u53f3\\u952e\\uff1a\\u91cd\\u547d\\u540d / \\u5220\\u9664\\uff09",
    });
    customRows.set(theme.id, item);
    rows.set(theme.id, item);
    return item;
  };

  const deleteCustomTheme = (id) => {
    const index = customThemes.findIndex((candidate) => candidate.id === id);
    if (index === -1) return false;
    customThemes.splice(index, 1);
    writeCustomThemes();
    customRows.get(id)?.remove();
    customRows.delete(id);
    rows.delete(id);
    const key = aliasKeyOf(id);
    if (key in aliases) { delete aliases[key]; writeAliases(); }
    if (document.documentElement.dataset.anonbuddySkin === id) clearTheme();
    return true;
  };

  const importFromDataUrl = (dataUrl, name) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.width);
      const full = document.createElement("canvas");
      full.width = Math.round(img.width * scale);
      full.height = Math.round(img.height * scale);
      full.getContext("2d").drawImage(img, 0, 0, full.width, full.height);
      const sample = document.createElement("canvas");
      sample.width = 48; sample.height = Math.max(1, Math.round(48 * img.height / img.width));
      sample.getContext("2d").drawImage(img, 0, 0, sample.width, sample.height);
      const theme = {
        id: newCustomId(),
        name: name || "\\u6211\\u7684\\u56fe\\u7247",
        dataUrl: full.toDataURL("image/webp", 0.8),
        colors: extractPalette(sample),
      };
      customThemes.push(theme);
      writeCustomThemes();
      renderCustomRow(theme);
      applyCustomTheme(theme);
      resolve(theme.colors);
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = dataUrl;
  });

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/png,image/jpeg,image/webp";
  picker.style.display = "none";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importFromDataUrl(reader.result, file.name.replace(/\\.[a-z0-9]+$/i, ""));
    reader.readAsDataURL(file);
    picker.value = "";
    panel.style.display = "none";
  });

  const uploadRow = row("\\uff0b \\u81ea\\u5b9a\\u4e49\\u56fe\\u7247", "rgba(36,201,215,.9)", () => picker.click());
  uploadRow.style.borderTop = "1px solid rgba(0,0,0,.08)";

  // ==================== Wallpaper Engine 壁纸（方案 A：file:// 直读）====================
  // 可行性结论见 docs/WE-INTEGRATION.md。要点：
  //   · 渲染进程本身就是 file:// 页面，可以直接 <video src="file:///..."> 播本机文件（已实测）
  //     → 零字节拷贝、零存储、零 payload 膨胀，不碰 localStorage 配额
  //   · 只传路径，绝不把媒体打进仓库（创意工坊内容版权归作者）
  //   · ⚠️ 这些主题**只在本机有效**，不可分享（面板上必须标注）
  const WE_THEME_KEY = "anonbuddySkinWeTheme";
  const WE_PAUSED_KEY = "anonbuddySkinWePaused";
  const WE_FALLBACK_COLORS = { accent: "#24c9d7", secondary: "#ef8fd3", surface: "#f7fbff", text: "#17344f" };
  // 1×1 透明 GIF：视频条目没有预览图时给 CSS 占位（视频会盖在上面）
  const WE_BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const weItems = Array.isArray(data.weItems) ? data.weItems : [];
  const weThemeId = (item) => "we-" + item.id;
  const readWeTheme = () => { try { return localStorage.getItem(WE_THEME_KEY) || null; } catch { return null; } };
  const writeWeTheme = (id) => { try { localStorage.setItem(WE_THEME_KEY, id || ""); } catch {} };
  const readWePaused = () => { try { return localStorage.getItem(WE_PAUSED_KEY) === "1"; } catch { return false; } };
  const writeWePaused = (paused) => { try { localStorage.setItem(WE_PAUSED_KEY, paused ? "1" : "0"); } catch {} };

  let wePaused = readWePaused();
  let weActiveId = null;
  let bgVideo = null;

  // 声音与音量（对齐 dsh 皮肤中心）：默认静音  浏览器自动播放策略会拦住非静音首播，
  // 所以先静音起播，用户打开声音开关时再解除（那时已经产生用户手势）。
  const WE_SOUND_KEY = "anonbuddySkinWeSound";
  const WE_VOLUME_KEY = "anonbuddySkinWeVolume";
  const readFlag = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw === null ? fallback : raw === "1"; } catch (error) { return fallback; } };
  const writeFlag = (key, value) => { try { localStorage.setItem(key, value ? "1" : "0"); } catch (error) {} };
  let weSound = readFlag(WE_SOUND_KEY, false);
  let weVolume = (() => {
    try {
      const raw = localStorage.getItem(WE_VOLUME_KEY);
      if (raw === null) return 35;
      const num = Number(raw);
      return Number.isFinite(num) && num >= 0 && num <= 100 ? num : 35;
    } catch (error) { return 35; }
  })();

  const applyVolume = () => {
    // 用 DOM 兜底，不只认 bgVideo 这个引用：
    // 切换主题/重建视频的时序里，bgVideo 可能已经和图层里的真实元素脱钩
    // （实测：拖音量时 localStorage 正确写入、muted 也跟着变，唯独 volume 停在 0
    //   —— 说明写到了一个不再是当前画面的节点上）。以 DOM 里的元素为准最稳。
    const el = bgVideo && bgVideo.isConnected
      ? bgVideo
      : document.querySelector("#" + BG_LAYER_ID + " > video");
    if (!el) return;
    try {
      el.volume = Math.min(1, Math.max(0, weVolume / 100));
      el.muted = !weSound;
    } catch (error) {}
  };

  const setWeSound = (value) => {
    weSound = Boolean(value);
    writeFlag(WE_SOUND_KEY, weSound);
    applyVolume();
    syncWeUi();
  };

  // 音量与播放状态是联动的：
  //   拖音量（>0）= 用户想听声音 → 自动解除静音，并让暂停中的壁纸恢复播放；
  //   暂停播放   = setWePaused 会把音量归零（见下），所以两个动作不会打架。
  // options.fromPause 区分"因暂停而被动归零"这一路，避免它反过来把自己唤醒。
  const setWeVolume = (value, options = {}) => {
    const next = Math.round(Number(value));
    weVolume = Number.isFinite(next) ? Math.min(100, Math.max(0, next)) : weVolume;
    try { localStorage.setItem(WE_VOLUME_KEY, String(weVolume)); } catch (error) {}
    if (!options.fromPause && weVolume > 0) {
      if (!weSound) { weSound = true; writeFlag(WE_SOUND_KEY, weSound); }
      if (wePaused) { wePaused = false; writeWePaused(false); }
    }
    applyVolume();
    syncBgVideoPlayback();
    syncWeUi();
  };

  // 从预览图取色（复用上传图片那条链路）。失败就退回默认色，不让主题因此不可用。
  const paletteFromUrl = (url) => new Promise((resolve) => {
    if (!url) { resolve(WE_FALLBACK_COLORS); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const sample = document.createElement("canvas");
        sample.width = 48;
        sample.height = Math.max(1, Math.round(48 * img.height / Math.max(1, img.width)));
        sample.getContext("2d").drawImage(img, 0, 0, sample.width, sample.height);
        resolve(extractPalette(sample));
      } catch (error) { resolve(WE_FALLBACK_COLORS); }
    };
    img.onerror = () => resolve(WE_FALLBACK_COLORS);
    img.src = url;
  });

  // 释放旧视频。必须 pause + 清 src + load()：只把节点摘掉，解码器可能还在跑（幂等红线）。
  const releaseBgVideo = () => {
    if (!bgVideo) return;
    try { bgVideo.pause(); } catch (error) {}
    try { bgVideo.removeAttribute("src"); bgVideo.load(); } catch (error) {}
    try { bgVideo.remove(); } catch (error) {}
    bgVideo = null;
  };

  const syncBgVideoPlayback = () => {
    if (!bgVideo) return;
    if (wePaused) { try { bgVideo.pause(); } catch (error) {} return; }
    const playing = bgVideo.play();
    if (playing && typeof playing.catch === "function") playing.catch(() => {});
  };

  // 把视频挂进背景图层。非视频条目（静态预览）只需清掉旧视频 —— 图走 CSS 的 hero 槽位。
  const setBackgroundMedia = (item) => {
    releaseBgVideo();
    if (!bgLayer || !item || item.kind !== "video") return;
    const video = document.createElement("video");
    video.dataset.wbWeVideo = "1";
    video.src = item.fileUrl;
    video.loop = true;
    video.autoplay = true;
    video.muted = !weSound;
    video.volume = Math.min(1, Math.max(0, weVolume / 100));
    video.defaultMuted = !weSound;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";
    video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;";
    bgLayer.appendChild(video);
    bgVideo = video;
    syncBgVideoPlayback();
  };

  // 从 localStorage 读出当前该用哪个 WE 壁纸并真正换过去。
  // 供 storage 事件使用：在设置窗口里点「应用」只写了 WE_THEME_KEY，
  // 另一个窗口要靠这个函数把壁纸切过去。
  // （applyWeTheme 定义在本函数之后，但只会在事件触发时被调用，那时已就绪。）
  const syncWeFromStorage = () => {
    const id = readWeTheme();
    if (!id) { onLeaveWeTheme(); return; }
    // 注意比较的是 item.id，不是 weThemeId(item)：
    // writeWeTheme 存的是 item.id（如 "3668718297"），而 weThemeId 会加 we- 前缀
    // 变成 dataset 用的 "we-3668718297"。拿带前缀的值去比就永远匹配不上。
    const item = (data.weItems || []).find((candidate) => candidate.id === id);
    if (item) applyWeTheme(item);
  };

  const setWePaused = (paused) => {
    wePaused = Boolean(paused);
    writeWePaused(wePaused);
    // 暂停就把音量归零：既避免"暂停了还在出声"，也让"拖音量"成为恢复播放的
    // 唯一入口（音量不为 0 就自动播放，见 setWeVolume）。
    if (wePaused && weVolume !== 0) setWeVolume(0, { fromPause: true });
    syncBgVideoPlayback();
    syncWeButtons();
  };

  const applyWeTheme = async (item) => {
    const id = weThemeId(item);
    // hero 优先用 RePKG 解出来的原始贴图（通常 4K），没有才退回创意工坊缩略图（1K）
    const heroSource = item.heroUrl || item.previewUrl || null;
    const colors = await paletteFromUrl(heroSource);
    const hero = heroSource || WE_BLANK;
    skinOwned = true;
    style.textContent = buildCustomCss(hero, colors, id);
    document.documentElement.dataset.anonbuddySkin = id;
    applyMode(colors.surface);
    setBackgroundMedia(item);
    weActiveId = item.id;
    writeWeTheme(item.id);
    paint(id);
    writeLastTheme(id);
    syncWeList();
    syncWeButtons();
    syncWeUi();
  };


  // 离开 WE 主题（切到普通主题 / 选原生）时必须收掉视频与状态，否则视频会在后台一直解码
  const leaveWeTheme = () => {
    releaseBgVideo();
    if (weActiveId !== null) { weActiveId = null; writeWeTheme(null); }
    syncWeList();
    syncWeButtons();
  };

  // 悬浮小图标旁边的暂停/播放键：只在用视频壁纸时出现
  const weToggleBtn = document.createElement("button");
  weToggleBtn.type = "button";
  weToggleBtn.dataset.wbWeToggle = "1";
  weToggleBtn.style.cssText = "position:absolute;right:44px;top:50%;transform:translateY(-50%);display:none;" +
    "width:30px;height:30px;border-radius:50%;border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.92);" +
    "box-shadow:0 3px 12px rgba(0,0,0,.24);cursor:pointer;line-height:1;padding:0;font-size:14px;";
  weToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setWePaused(!wePaused);
  });

  const syncWeButtons = () => {
    const isVideoWe = weActiveId !== null && (weItems.find((x) => x.id === weActiveId)?.kind === "video");
    weToggleBtn.style.display = isVideoWe ? "block" : "none";
    weToggleBtn.textContent = wePaused ? "\\u25b6" : "\\u23f8";
    weToggleBtn.title = wePaused ? "继续播放动态壁纸" : "暂停动态壁纸";
    if (wePaneToggle) {
      wePaneToggle.textContent = wePaused ? "继续播放" : "暂停播放";
      wePaneToggle.dataset.wbPaused = wePaused ? "1" : "0";
    }
  };

  let wePaneToggle = null;
  let syncWeList = () => {};
  let syncWeUi = () => {};
  onLeaveWeTheme = leaveWeTheme;

  const NATIVE_LABEL = "\\u539f\\u751f\\u754c\\u9762";
  const native = row(displayName(null, NATIVE_LABEL), "rgba(0,0,0,.24)", () => { clearTheme(); panel.style.display = "none"; }, { id: null, renamable: true, defaultLabel: NATIVE_LABEL });
  rows.set(null, native);

  // ---- 文案替换：侧边栏应用名 + 欢迎页主标题 ----
  // 这两处都是 React 从 i18n 词条直接渲染的文本，皮肤只能改样式改不到字。
  // 做法是原地改**文本节点**，不重建节点：
  //   - 侧边栏 .logo-workbuddy-title 是个 <span>，直接写 textContent 即可；
  //   - 欢迎页主标题 h1 是 "滚动槽" 的结构（原生翻滚会往里插 roll-cell），
  //     所以只替换它**当前那个 span** 的文字，绝不动 h1 本身和它的兄弟节点，
  //     否则会把原生翻滚动画赖以工作的裁剪槽结构拆掉。
  // 用 MutationObserver 守着：React 每次重新渲染 / 重新挂载都会把文案写回原文，
  // 必须改回去（切页、切场景、启动都会重渲染）。
  const BRAND_TEXT = "ChihayaAnon AI";
  const HERO_TITLE_TEXT = "\\u63a2\\u7d22\\u672a\\u81f3\\u4e4b\\u5883";
  const BRAND_ORIGINALS = new Set(["WorkBuddy AI", "WorkBuddy"]);
  const HERO_ORIGINALS = new Set([
    "WorkBuddy, 我帮你",
    "WorkBuddy，我帮你",
    "WorkBuddy, Ideas into reality",
  ]);

  // 换掉元素里所有文本节点，但保留元素/子节点结构（只改 nodeValue）
  const replaceText = (el, text) => {
    let changed = false;
    for (const node of el.childNodes) {
      if (node.nodeType !== 3) continue;          // 只认文本节点
      if (node.nodeValue === text) continue;
      node.nodeValue = text;
      changed = true;
    }
    return changed;
  };

  // ---- 逐字拆分（打字机动画的载体）----
  // 为什么必须拆：CSS 没法"按第 n 个字"分别给动画延迟，纯 CSS 做不到真正的逐字。
  // 所以把 <span>探索未至之境</span> 拆成 <span><i>探</i><i>索</i>...</span>，
  // 每个字自己一个 animation-delay。
  //
  // 实测 React **不会**还原这个结构：它只 diff 自己管理的节点，插进内层 span 的
  // 孙子节点不在它的 reconciler 视野里（3 秒内 + 切场景重渲染都保持完好）。
  //
  // 拆字后有个必须处理的副作用：每个字变成独立盒子，background-image 会在
  // 每个字上**重新开始**，整行渐变就退化成"6 个相同色块"。解法是给每个字设
  // background-size = 整行宽、background-position-x = 负的该字左偏移，
  // 让渐变"跨字连续"。实测与不拆的基线渲染完全一致。
  const CHAR_TAG = "i";
  const charSelector = (root) => root.querySelectorAll(":scope > span > " + CHAR_TAG);

  const splitTitle = (host) => {
    // host 是承载文字的 span（h1 > span > 文字）
    const text = (host.textContent ?? "").trim();
    if (!text) return false;
    // 幂等：已经拆过就不重复拆（否则每帧都在重组 DOM）
    const existing = charSelector(host.parentElement ?? host);
    if (existing.length === [...text].length && [...existing].map((c) => c.textContent).join("") === text) return false;

    host.textContent = "";
    const chars = [...text];
    const frag = document.createDocumentFragment();
    chars.forEach((ch, index) => {
      const node = document.createElement(CHAR_TAG);
      node.textContent = ch;
      // 延迟靠 CSS 变量下发，CSS 里用 calc 算，避免把时序写死在 JS 里
      node.style.setProperty("--wb-char-index", String(index));
      frag.appendChild(node);
    });
    host.appendChild(frag);
    return true;
  };

  // 拆字后重新对齐渐变：让整行看起来还是一整条渐变，而不是每个字各一条。
  // 入参可以是 h1，也可以是 document（resize / 字体就绪时全量重算）。
  const alignCharGradient = (scope) => {
    // 承载文字的 span = h1 的直接子 span；它内部才是逐字 <i>
    const hosts = scope.matches?.(".wb-home-header__title")
      ? scope.querySelectorAll(":scope > span")
      : scope.querySelectorAll(".wb-home-header__title > span");
    for (const host of hosts) {
      const chars = host.querySelectorAll(":scope > " + CHAR_TAG);
      if (!chars.length) continue;
      // 先清掉上一轮的背景尺寸，量到自然宽度后才能算准
      for (const node of chars) {
        node.style.backgroundSize = "";
        node.style.backgroundPosition = "";
      }
      const hostRect = host.getBoundingClientRect();
      const total = hostRect.width;
      if (!total) continue;                 // 布局未稳定（如还没挂载完），下一帧再算
      for (const node of chars) {
        const rect = node.getBoundingClientRect();
        const offset = rect.left - hostRect.left;
        node.style.backgroundSize = total + "px 100%";
        node.style.backgroundPosition = (-offset) + "px 0";
      }
    }
  };

  const applyCopy = () => {
    document.querySelectorAll(".logo-workbuddy-title").forEach((el) => {
      if (BRAND_ORIGINALS.has((el.textContent ?? "").trim())) {
        replaceText(el, BRAND_TEXT);
        el.setAttribute("title", BRAND_TEXT);
      }
    });
    document.querySelectorAll(".wb-home-header__title").forEach((el) => {
      const current = (el.textContent ?? "").trim();
      const isMine = current === HERO_TITLE_TEXT;
      if (!isMine && !HERO_ORIGINALS.has(current)) return;

      if (!isMine) {
        // 直接子文本节点（有些版本把文字直接放 h1 里）
        const hitDirect = replaceText(el, HERO_TITLE_TEXT);
        // 常见结构是 h1 > span > "文字"，也要照顾到
        let hitSpan = false;
        for (const child of el.children) {
          if (child.tagName === "SPAN" && HERO_ORIGINALS.has((child.textContent ?? "").trim())) {
            replaceText(child, HERO_TITLE_TEXT);
            hitSpan = true;
          }
        }
        // h1 是 inline-flex + gap:10px，多出来的子元素之间会被撑开间距。
        // 已经替换成功且只剩一个子文本载体时，把 gap 收掉，保证视觉上还是一句话。
        if (hitDirect || hitSpan) el.style.gap = "0px";
      }

      // 拆分 + 对齐渐变。拆完必须重新对一遍 —— 每个字都是新盒子，
      // 而且字体加载 / 窗口尺寸变化都会让字宽变。
      for (const host of el.querySelectorAll(":scope > span")) {
        if (host.querySelector(":scope > " + CHAR_TAG)) continue;
        if ((host.textContent ?? "").trim() !== HERO_TITLE_TEXT) continue;
        splitTitle(host);
      }
      alignCharGradient(el);
    });
  };

  // 节流：MutationObserver 在 React 渲染期会疯狂回调，合并到下一帧统一处理
  // stopped：实例被 dispose 后，已经排进队列的 rAF / interval 回调必须变成空操作，
  // 否则旧实例会在新实例（或 restore 之后）把标题又拆一次。
  // （声明位置故意靠前：外观联动那段的 interval 回调也要读它）
  let copyScheduled = false;
  const scheduleCopy = () => {
    if (stopped || copyScheduled) return;
    copyScheduled = true;
    requestAnimationFrame(() => {
      copyScheduled = false;
      if (stopped) return;
      applyCopy();
    });
  };
  applyCopy();

  const copyObserver = new MutationObserver(scheduleCopy);
  // 只观察这两处的父容器（子树 + 文字），避免监听整个 body 带来的开销
  const watchRoots = () => {
    if (stopped) return;
    const roots = new Set();
    for (const el of document.querySelectorAll(".conversation-list-header, .wb-home-header__title-wrap")) {
      roots.add(el);
    }
    // 侧边栏整体重挂时 header 会换节点，所以再兜一层侧边栏 + 首页路由容器
    for (const sel of ["[data-view-id=sidebar]", "[data-view-id=main-content]"]) {
      const el = document.querySelector(sel);
      if (el) roots.add(el);
    }
    for (const root of roots) {
      if (copyObserver.__roots?.has(root)) continue;
      copyObserver.observe(root, { childList: true, subtree: true, characterData: true });
      (copyObserver.__roots ??= new Set()).add(root);
    }
    if (window.__anonbuddySkin?.copy) window.__anonbuddySkin.copy.applied = (copyObserver.__roots?.size ?? 0);
  };
  watchRoots();

  // 路由切换后侧边栏 / 首页容器会换成新节点，定期把观察目标补全（幂等，开销极低）
  const watchTimer = setInterval(() => {
    watchRoots();
    scheduleCopy();
  }, 1500);

  // 窗口尺寸变化会让字宽变，渐变偏移要重算（防抖，因为 resize 事件很密）
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { alignCharGradient(document); }, 120);
  };
  window.addEventListener("resize", onResize);

  // 字体加载完成后字宽会变（PingFang SC 是系统字体，一般已就绪，但首次仍可能闪一下）
  if (document.fonts?.ready) document.fonts.ready.then(() => { if (!stopped) alignCharGradient(document); });

  // 统一停机：停掉本实例所有定时器 / 监听器 / 观察器。
  // 必须幂等，且要在合并逐字节点之前调用（见 copy.restore 的注释）。
  const dispose = () => {
    stopped = true;
    clearInterval(watchTimer);
    clearInterval(settingsTimer);
    clearTimeout(resizeTimer);
    window.removeEventListener("resize", onResize);
    copyObserver.disconnect();
    settingsObserver.disconnect();
    // 设置面板里的注入物要一起收掉：它们是挂在 React 容器里的，
    // 只 disconnect 观察器会留下一份"孤儿"条目/面板。重新 apply 时新实例
    // 又会插一份 → 导航栏出现两个同名条目、内容区出现两层列表。
    try { pluginEntry?.remove(); } catch {}
    try { settingsPane?.remove(); } catch {}
    pluginEntry = null;
    settingsPane = null;
    pluginEntryActive = false;
    // 外观联动：监听器与轮询必须一起收掉。否则旧实例的捕获监听器还挂在 document 上，
    // 「外观护栏」会叠加多份（虽然幂等，但 stopped 之后的行为不可预期），
    // 护栏轮询也会一直被旧实例继续跑。
    document.removeEventListener("pointerdown", onGuardCapture, true);
    document.removeEventListener("click", onGuardCapture, true);
    guardUiObserver.disconnect();
    if (guardWatchTimer !== null) { clearInterval(guardWatchTimer); guardWatchTimer = null; }
    // 卸载时把「皮肤接管」的声明撤掉，并解除外观护栏，让原生外观恢复自理
    enforceAppearanceGuard(null);
    document.documentElement.removeAttribute("data-skin");
    // 背景媒体层是我们插的节点，必须一起收掉（幂等红线：重复 apply 不能叠层）
    try { bgLayer?.remove(); } catch {}
    bgLayer = null;
    // 侧边栏上的内联模糊也要清掉，否则 pause 后原生界面会留着我们的模糊
    try { document.querySelector(SIDEBAR_SEL)?.style.removeProperty("backdrop-filter"); } catch {}
    // WE 视频必须真释放（pause + 清 src + load()），否则旧实例的解码器会一直在后台跑
    releaseBgVideo();
    try { weToggleBtn.remove(); } catch {}
  };

  // 历史自定义主题全部还原成菜单行（按上传顺序，排在「＋ 自定义图片」上面）
  for (const theme of readCustomThemes()) {
    customThemes.push(theme);
    renderCustomRow(theme);
  }

  // ---- 位置记忆 + 拖动：图标可拖到任意位置，坐标存 localStorage ----
  // 存的是「贴左边还是贴右边 + 距该边的距离」，不是绝对 x/y。
  // 绝对坐标在窗口缩小后会被夹到右边缘，之后再放大也回不到原位 ——
  // 这就是"窗口非最大化时插件图标位置偏移"的成因。
  const POS_KEY = "anonbuddySkinMenuPos";
  // 悬浮图标显隐开关：设置面板里的「显示悬浮小图标」控制；关掉后按钮隐藏，
  // 但菜单本身与皮肤照常工作（入口改从设置面板进）。
  // ---- 两个外观调节项：侧边栏毛玻璃 / 背景图模糊（2026-09-20）----
  // 只改 html 上的 CSS 变量（内联样式），**不重建 <style>** —— 避免整张样式表重解析与重排。
  // 滑块对外是 1..100 的整数，换算成 px 的系数写在这里；CSS 侧只认 *-px 变量。
  // 默认值刻意与"没这功能之前"的观感一致：侧边栏 100（= 原来的 24px）、背景 1（≈0.3px，肉眼无感）。
  const TUNABLES_KEY = "anonbuddySkinTunables";
  const TUNABLE_SPEC = [
    { key: "sidebarBlur", label: "侧边栏毛玻璃", varName: "--wb-sidebar-blur-px", factor: 0.24, def: 100 },
    { key: "bgBlur", label: "背景图模糊", varName: "--wb-bg-blur-px", factor: 0.3, def: 1 },
  ];
  const clampTunable = (spec, value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return spec.def;
    return Math.max(1, Math.min(100, Math.round(n)));
  };
  const readTunables = () => {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(TUNABLES_KEY) ?? "null"); } catch {}
    const out = {};
    for (const spec of TUNABLE_SPEC) out[spec.key] = clampTunable(spec, stored?.[spec.key] ?? spec.def);
    return out;
  };
  const tunables = readTunables();
  const writeTunables = () => {
    try { localStorage.setItem(TUNABLES_KEY, JSON.stringify(tunables)); return true; } catch { return false; }
  };

  // 背景媒体层的节点引用。真实节点在下方创建（那时才能 append 到 body），
  // 这里先声明 —— applyTunables 在初始化阶段就会被调用，直接引用 const 会撞 TDZ。
  let bgLayer = null;
  // 侧边栏模糊的补涂钩子（React 重建侧边栏会丢掉内联值，由护栏轮询顺手补回）。
  // 同样是前置声明，实现在 applySidebarBlur 之后赋值。
  let reapplySidebarBlur = () => {};

  // 背景媒体层的 id。CSS 侧硬编码同名选择器（与 #anonbuddy-skin-menu 的既有做法一致）。
  const BG_LAYER_ID = "anonbuddy-skin-bg";
  const SIDEBAR_SEL = "[data-view-id=sidebar]";

  // ⚠️ 侧边栏的模糊**直接写 backdrop-filter 内联样式**，不要走自定义属性。
  // 实测（本机 2269 个元素）：
  //   · 在 html 上 style.setProperty 写自定义属性 → 全文档重算，23ms/次（拖动只有 ~40fps）
  //   · 在侧边栏元素上写自定义属性 → 只重算它自己那 408 个后代，3.2ms/次
  //   · 直接写 backdrop-filter 内联样式 → 0ms
  // 三者视觉效果一样，所以选最便宜的那个。CSS 里保留 24px 作为脚本尚未接管时的兜底。
  const applySidebarBlur = () => {
    const el = document.querySelector(SIDEBAR_SEL);
    if (!el) return;
    const want = "blur(" + (tunables.sidebarBlur * 0.24).toFixed(2) + "px) saturate(1.15)";
    if (el.style.backdropFilter !== want) el.style.backdropFilter = want;
  };

  const applyTunables = () => {
    const blurPx = tunables.bgBlur * 0.3;
    if (bgLayer) {
      // 模糊≈0 时不挂 filter：blur(0px) 照样会建一层全屏合成层，白付显存。
      const wantFilter = blurPx >= 0.5 ? "blur(" + blurPx.toFixed(2) + "px)" : "";
      if (bgLayer.style.filter !== wantFilter) bgLayer.style.filter = wantFilter;
      // 图层随模糊量反向外扩：blur() 会在视口边缘采样到透明区，不外扩就露白边。
      const wantInset = blurPx >= 0.5 ? (-2 * blurPx).toFixed(2) + "px" : "0px";
      if (bgLayer.style.inset !== wantInset) bgLayer.style.inset = wantInset;
    }
    applySidebarBlur();
  };
  reapplySidebarBlur = applySidebarBlur;

  const ICON_HIDDEN_KEY = "anonbuddySkinIconHidden";
  const readIconHidden = () => {
    try { return localStorage.getItem(ICON_HIDDEN_KEY) === "1"; } catch { return false; }
  };
  const writeIconHidden = (hidden) => {
    try { localStorage.setItem(ICON_HIDDEN_KEY, hidden ? "1" : "0"); } catch {}
  };
  let iconHidden = readIconHidden();
  const applyIconVisibility = () => {
    button.style.display = iconHidden ? "none" : "block";
    if (iconHidden) { panel.style.display = "none"; closeCtxMenu(); }
  };

  const SIZE = 38;
  const clampPos = (x, y) => ({
    x: Math.max(0, Math.min(Math.max(0, innerWidth - SIZE), x)),
    y: Math.max(0, Math.min(Math.max(0, innerHeight - SIZE), y)),
  });
  // 把存下来的锚点还原成"当前窗口尺寸下"的绝对坐标
  const resolvePos = (saved) => {
    if (!saved) return null;
    // 兜底：万一还读到旧格式（绝对坐标），按当前窗口夹一次
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampPos(saved.x, saved.y);
    if (!Number.isFinite(saved.dx) || !Number.isFinite(saved.y)) return null;
    const x = saved.ax === "left" ? saved.dx : innerWidth - SIZE - saved.dx;
    return clampPos(x, saved.y);
  };
  // 拖完把绝对坐标编码成"离得近的那一边 + 距离"
  const encodePos = (pos) => {
    const rightDist = Math.max(0, innerWidth - SIZE - pos.x);
    return rightDist < pos.x
      ? { ax: "right", dx: Math.round(rightDist), y: Math.round(pos.y) }
      : { ax: "left", dx: Math.round(pos.x), y: Math.round(pos.y) };
  };
  // 旧格式（绝对坐标）→ 锚点格式
  const migratePos = (saved) => {
    if (!saved) return null;
    if (Number.isFinite(saved.dx)) return saved;
    if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
    // 旧坐标已经超出当前视口 → 说明是在更大的窗口里记下的，按默认的"离右边 16px"换算，
    // 这样窗口放大后能回到原位，而不是被夹死在右边缘
    const x = saved.x > innerWidth - SIZE ? innerWidth - SIZE - 16 : saved.x;
    return encodePos({ x: Math.max(0, Math.min(innerWidth - SIZE, x)), y: saved.y });
  };
  const placeAt = (pos) => {
    root.style.left = pos.x + "px";
    root.style.top = pos.y + "px";
    root.style.right = "auto";
  };
  const readPos = () => { try { return JSON.parse(localStorage.getItem(POS_KEY) ?? "null"); } catch { return null; } };
  const writePos = (pos) => { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {} };

  const storedPos = migratePos(readPos());
  if (storedPos) {
    writePos(storedPos);
    placeAt(resolvePos(storedPos));
  } else {
    root.style.top = "48px";
    root.style.right = "16px";
  }

  let drag = null;
  let suppressClick = false;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = root.getBoundingClientRect();
    drag = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      x0: event.clientX,
      y0: event.clientY,
      moved: false,
    };
    try { button.setPointerCapture(event.pointerId); } catch {}
    button.style.cursor = "grabbing";
  });
  button.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < 4) return;
    drag.moved = true;
    panel.style.display = "none";
    placeAt(clampPos(event.clientX - drag.dx, event.clientY - drag.dy));
  });
  const endDrag = (event) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    button.style.cursor = "grab";
    try { button.releasePointerCapture(event.pointerId); } catch {}
    if (moved) {
      suppressClick = true;
      const rect = root.getBoundingClientRect();
      writePos(encodePos({ x: Math.round(rect.left), y: Math.round(rect.top) }));
    }
  };
  button.addEventListener("pointerup", endDrag);
  button.addEventListener("pointercancel", endDrag);
  // 窗口缩放时按"贴边锚点"重算，图标跟着它贴着的那条边跑，而不是被夹死在旧坐标上
  window.addEventListener("resize", () => {
    const resolved = resolvePos(readPos());
    if (resolved) placeAt(resolved);
    else { const rect = root.getBoundingClientRect(); placeAt(clampPos(rect.left, rect.top)); }
  });
  const resetPosition = () => {
    try { localStorage.removeItem(POS_KEY); } catch {}
    root.style.left = "auto";
    root.style.top = "48px";
    root.style.right = "16px";
  };

  button.addEventListener("click", () => {
    if (suppressClick) { suppressClick = false; return; }
    closeCtxMenu();
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  // ctxMenu 用 position:fixed 挂在 root 下：root 没有 transform/filter，fixed 仍是相对视口定位，
  // 放在 root 里是为了让「重新注入」时随 root 一起被移除
  root.append(button, weToggleBtn, panel, picker, ctxMenu);
  document.body.appendChild(root);

  // ---- 背景媒体层（真实节点，不是 body::before）----
  // 为什么不用伪元素：拖"背景图模糊"滑块时要实时改模糊量，而实测在 html 上
  // style.setProperty 写自定义属性会触发全文档样式重算（23ms/次），拖动只有 ~40fps；
  // 直接写这个节点的 style.filter / style.inset 则是 0ms。见 skin.css 里的同段说明。
  //
  // ⚠️ 子窗口不铺这一层。
  // 5.6.x 的设置是独立窗口（URL 带 windowKind=settings），它的窗口顶部有一段原生
  // 「安全区」—— 面板从 y=62 才开始，那 62px 留给标题栏按钮。壁纸层按 inset:0 铺满
  // 整窗时会把这 62px 也一起铺上，于是在设置面板上方露出一条壁纸条。
  // 主窗口没有这个安全区（面板贴着窗口边），所以国际版的设置弹层不会出现该现象。
  // 设置这类工具窗口本来也不需要底图，配色覆盖（skin.css 的 --cb-* 变量）照常生效。
  // 判断依据用 URL 里的 windowKind / windowAppId，两者都是稳定的原生查询参数。
  const isChildWindow = /[?&](?:windowKind|windowAppId)=/.test(location.search);
  // 子窗口的 body 上没有 data-application-name，而 skin.css 的配色规则全部以
  // body[data-application-name=workbuddy] 开头 —— 不补这一下，设置窗口会停在原生灰白，
  // 深色主题下就成了"深色主窗口 + 纯白设置面板"。
  // 这里刻意加插件自己的属性而不是伪造原生那个，免得干扰 WorkBuddy 自己的逻辑。
  if (isChildWindow && document.body) {
    document.body.setAttribute("data-wb-child-window", "1");
  }
  // 先按 id 清掉可能残留的孤儿节点（旧实例异常中断时留下的），与 root 的写法一致。
  document.getElementById(BG_LAYER_ID)?.remove();
  bgLayer = isChildWindow ? null : document.createElement("div");
  if (bgLayer) {
    bgLayer.id = BG_LAYER_ID;
    // 图层的内容（底色/遮罩/hero）全部由 skin.css 的 #anonbuddy-skin-bg 规则给，
    // 这里只负责 append + 后面用内联样式驱动模糊。
    document.body.appendChild(bgLayer);
  }

  // 启动时应用哪个主题：
  //   restoreLast（apply --theme last）→ 用用户上次在菜单里选的那个，自定义主题也能恢复；
  //   还没记录过（例如刚升级到这一版）→ 沿用当前页面上已经生效的主题，避免升级后突然变脸；
  //   存的主题已失效（例如被删掉）→ 退回 CLI 指定的主题。
  const currentSkin = document.documentElement.dataset.anonbuddySkin ?? null;
  // 开机默认主题（用户显式指定）优先于「上次选的主题」（自动记录），这是「开机默认」的语义；
  // 两者都可能失效（主题被删 / WE 条目换机器后不存在），所以逐级回退，最后才用 CLI 指定的主题。
  const bootRaw = data.restoreLast ? readBootTheme() : null;
  const bootOk = typeof bootRaw === "string" && bootRaw !== "" && bootRaw.indexOf("we-") !== 0 && canApplyTheme(bootRaw);
  const preferred = data.restoreLast ? ((bootOk ? bootRaw : null) ?? (readLastTheme() ?? currentSkin)) : null;
  // WE 主题的 id 形如 we-<条目ID>，不在 data.themes / customThemes 里，要单独恢复
  const preferredWe = typeof preferred === "string" && preferred.indexOf("we-") === 0
    ? weItems.find((item) => weThemeId(item) === preferred)
    : null;
  if (preferredWe) applyWeTheme(preferredWe);
  else if (preferred === NATIVE_MARK) clearTheme();
  else if (preferred !== null && canApplyTheme(preferred)) setTheme(preferred);
  else if (data.activeId === null) clearTheme();
  else setTheme(data.activeId);

  // 外观护栏的轮询与个人中心浮层的按钮同步：
  //   ① 轮询兜底（600ms）负责"被别处切成与皮肤相反的那一侧时按回来"，并持续刷新按钮禁用态 ——
  //      个人中心浮层是 React portal，每次打开都是新节点，没有稳定的挂载时机可观察；
  //      用低压轮询比 MutationObserver 监听整个 body 便宜得多（浮层按需出现，不是热路径）；
  //   ② stopped 后回调变空操作（见 dispose）。
  // ⚠️ 必须带 skinOwned 判断：用户选「原生」时皮肤已卸下，这时再去锁原生外观
  //    会让用户再也切不动它 —— 是联动最危险的副作用。
  if (skinOwned && activeSurface !== null) {
    enforceAppearanceGuard(isLightSurface(activeSurface) ? "dark" : "light");
  }
  startGuardWatch();

  // ==================== 设置面板集成 ====================
  // 在 WorkBuddy 设置面板（.settings-modal-overlay）左侧「功能」分组里插一个
  // 「ChihayaAnon 插件」条目，点它时右侧内容区换成我们的面板。
  //
  // 为什么用 MutationObserver 而不是直接在导航栏上插：
  //   设置面板是 React 渲染的，每次打开 / 切换 tab 都会重建整个 .settings-navigation，
  //   我们插进去的按钮会被一起回收。只能守着导航栏，出现就补。
  //
  // 内容区不能真的"接管"右上角面板（那需要 React 路由），做法是：
  //   原生 .settings-modal__panel 保留，我们只在它上面盖一层自己的面板并切换显隐。
  //   切到别的 tab 时（原生面板内容变了）自动把自己收起来。

  const pluginEntryId = data.menuId + "-settings-entry";
  const pluginPaneId = data.menuId + "-settings-pane";
  let settingsPane = null;      // 右侧我们的面板
  let pluginEntry = null;       // 左侧导航条目
  let pluginEntryActive = false;

  // 面板配色必须跟着「设置弹窗自身的底色」走，而不是跟着皮肤主题走。
  // 踩过的坑：设置弹窗是 WorkBuddy 原生的白色/深色实底，皮肤并没有把它染色
  // （皮肤只覆盖主页视图，弹窗保持原生）。如果按皮肤主题取色，选中深色皮肤时
  // 会把文字设成浅色 —— 白色弹窗上就成了白字白底，整个面板"看起来是空的"。
  // 所以这里直接读内容区的实际计算背景色来判断深浅。
  // 注意：这段代码整体在模板字符串里，正则里的反斜杠会被模板字面量吃掉一层，
  // 所以字面量要写成双反斜杠（同文件 file.name.replace 那处的做法）。
  // 设置弹窗根容器解析：按候选列表逐个试，不依赖单一类名，也不依赖任何顺序。
  // 旧版（5.5.x）：设置是主窗口内的弹层，根是 .settings-modal-overlay。
  // 新版（5.6.x）：设置跑在独立 renderer 窗口里，没有 overlay 包装，根是 .settings-modal--window。
  // 两者内层结构一致，所以只需要在这里吸掉差异。
  const resolveSettingsRoot = () => {
    for (const selector of data.settingsRootSelectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  const paneSurface = () => {
    const root = resolveSettingsRoot();
    const content = root?.querySelector(".settings-modal__content") ?? root;
    const bg = content ? getComputedStyle(content).backgroundColor : "";
    const m = /rgba?\\(([0-9]+), ([0-9]+), ([0-9]+)/.exec(bg || "");
    if (m) return "#" + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, "0")).join("");
    return "#f7f7f7";
  };

  const currentThemeId = () => document.documentElement.dataset.anonbuddySkin ?? null;

  // 面板行：和悬浮菜单的 row 同源（复用 row()），只是容器不同、点击后不关面板
  const paneRow = (label, dotColor, onPick, options = {}) => row(label, dotColor, onPick, options);

  const buildSettingsPane = () => {
    const pane = document.createElement("div");
    pane.id = pluginPaneId;
    pane.dataset.wbPluginPane = "1";
    pane.style.cssText = "display:none;flex-direction:column;height:100%;overflow:hidden;font:400 14px/1.5 system-ui;color:var(--wb-pane-text,#1a1a1a);";

    // 头部：和原生 settings-modal__header 对齐
    const header = document.createElement("div");
    header.textContent = data.pluginName;
    header.style.cssText = "flex:none;padding:16px 0 12px;font:600 16px/1.4 system-ui;";
    pane.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 2px 24px;";

    // ---- 分组 1：皮肤列表 ----
    // 行的主题 id 存在 data-wb-theme-id 上，null（原生界面）编码成 "native"：
    // dataset 会把 null 序列化成字符串 "null"，不能直接存原值。
    const encodeRowId = (id) => (id === null ? "native" : String(id));
    const decodeRowId = (raw) => (raw === "native" ? null : raw);
    const listGroup = document.createElement("div");
    listGroup.style.cssText = "margin-bottom:18px;";
    const listLabel = document.createElement("p");
    listLabel.textContent = "皮肤";
    listLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    // 皮肤列表：三列网格（2026-09-20 由单列改为网格）。
    // 原先每行占满整宽、右侧大片留白，主题一多列表就拉得很长；改成 3 列后
    // 9 个主题正好 3×3，列表高度约减半，横向空间也用满了。
    // ⚠️ 用「gap + 每格独立边框」而不是「1px gap 借容器底色当分隔线」：
    //    深色下 --wb-pane-card 是 rgba(255,255,255,.06) 半透明，
    //    容器底色会透上来，hairline 分隔线那套会直接失效。
    const listCard = document.createElement("div");
    listCard.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:6px;border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));background:var(--wb-pane-card,#fff);";
    listGroup.append(listLabel, listCard);

    // 原生界面行 + 全部内置主题 + 全部自定义主题
    const paneRows = new Map();
    const renderList = () => {
      listCard.textContent = "";
      paneRows.clear();
      const mk = (label, dotColor, onPick, options) => {
        const item = paneRow(label, dotColor, onPick, {
          ...options,
          container: listCard,
          hoverBg: "var(--wb-pane-hover,rgba(0,0,0,.04))",
          // 离开时重算整列选中态：网格里每格是独立卡片，不能靠 paint() 擦掉悬停底
          onLeave: () => syncPaneSelection(),
        });
        // 网格单元格：自带圆角与边框（不再是"整块卡片 + 行间分隔线"）
        item.style.padding = "8px 10px";
        item.style.borderRadius = "8px";
        item.style.border = "1px solid var(--wb-pane-border,rgba(0,0,0,.06))";
        // 名字在窄格子里要能吃满剩余宽度，否则截断得太早
        item.__text.style.maxWidth = "none";
        paneRows.set(options?.id ?? null, item);
        markRow(item, options?.id ?? null);
        return item;
      };
      mk(displayName(null, NATIVE_LABEL), "rgba(0,0,0,.24)", () => { clearTheme(); syncPaneSelection(); }, { id: null, renamable: true, defaultLabel: NATIVE_LABEL, menuHint: "\\uff08\\u53f3\\u952e\\u91cd\\u547d\\u540d\\uff09" });
      for (const theme of data.themes) {
        mk(displayName(theme.id, theme.name), theme.accent, () => { setTheme(theme.id); syncPaneSelection(); }, { id: theme.id, renamable: true, defaultLabel: theme.name });
      }
      for (const theme of customThemes) {
        mk(displayName(theme.id, theme.name), theme.colors.accent, () => { applyCustomTheme(theme); syncPaneSelection(); }, { id: theme.id, renamable: true, defaultLabel: theme.name, menuHint: "\\uff08\\u53f3\\u952e\\uff1a\\u91cd\\u547d\\u540d / \\u5220\\u9664\\uff09" });
      }
      syncPaneSelection();
    };

    // 当前选中：底色 + 打勾
    let selectionMark = null;
    const markRow = (item, id) => {
      item.dataset.wbThemeId = encodeRowId(id);
      const check = document.createElement("span");
      check.textContent = "\\u2713";
      check.style.cssText = "flex:none;width:16px;text-align:center;opacity:0;color:var(--wb-pane-accent,#24c9d7);font-weight:700;";
      item.appendChild(check);
      item.__check = check;
    };
    const syncPaneSelection = () => {
      const active = currentThemeId();
      for (const [id, item] of paneRows) {
        const on = id === active;
        if (item.__check) item.__check.style.opacity = on ? "1" : "0";
        item.style.background = on ? "var(--wb-pane-active,rgba(36,201,215,.12))" : "transparent";
        // 网格里每格是独立卡片，选中态再给一道强调色描边，比只靠一个 ✓ 更醒目
        item.style.borderColor = on
          ? "var(--wb-pane-accent,rgba(36,201,215,.6))"
          : "var(--wb-pane-border,rgba(0,0,0,.06))";
      }
      // 悬浮菜单的选中态也同步一下
      paint(active);
    };

    // ---- 分组 2：添加皮肤 ----
    const addGroup = document.createElement("div");
    addGroup.style.cssText = "margin-bottom:18px;";
    const addLabel = document.createElement("p");
    addLabel.textContent = "添加";
    addLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    const addCard = document.createElement("div");
    addCard.style.cssText = "border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));overflow:hidden;background:var(--wb-pane-card,#fff);";
    const addRow = document.createElement("div");
    addRow.setAttribute("role", "button");
    addRow.tabIndex = 0;
    addRow.style.cssText = "display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;";
    const addPlus = document.createElement("span");
    addPlus.textContent = "\\uff0b";
    addPlus.style.cssText = "flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--wb-pane-active,rgba(36,201,215,.12));color:var(--wb-pane-accent,#0e8fa0);font-weight:700;";
    const addText = document.createElement("span");
    addText.textContent = "上传图片作为新皮肤";
    addText.style.cssText = "flex:1;min-width:0;";
    const addHint = document.createElement("span");
    addHint.textContent = "PNG / JPG / WebP";
    addHint.style.cssText = "flex:none;font-size:12px;opacity:.5;";
    addRow.append(addPlus, addText, addHint);
    addRow.addEventListener("mouseenter", () => { addRow.style.background = "var(--wb-pane-hover,rgba(0,0,0,.04))"; });
    addRow.addEventListener("mouseleave", () => { addRow.style.background = "transparent"; });
    addRow.addEventListener("click", () => picker.click());
    addCard.appendChild(addRow);
    addGroup.append(addLabel, addCard);

    // ---- 分组 3：悬浮图标开关 ----
    const toggleGroup = document.createElement("div");
    const toggleLabel = document.createElement("p");
    toggleLabel.textContent = "悬浮图标";
    toggleLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    const toggleCard = document.createElement("div");
    toggleCard.style.cssText = "border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));background:var(--wb-pane-card,#fff);";
    const toggleRow = document.createElement("div");
    toggleRow.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px 14px;";
    const toggleCopy = document.createElement("div");
    toggleCopy.style.cssText = "flex:1;min-width:0;";
    const toggleTitle = document.createElement("div");
    toggleTitle.textContent = "显示悬浮小图标";
    const toggleDesc = document.createElement("div");
    toggleDesc.textContent = "关闭后隐藏页面上的悬浮按钮，仍可从本页切换皮肤。";
    toggleDesc.style.cssText = "font-size:12px;opacity:.55;margin-top:2px;";
    toggleCopy.append(toggleTitle, toggleDesc);

    // 开关：仿原生 wb-switch 的两态按钮
    const switchEl = document.createElement("button");
    switchEl.type = "button";
    switchEl.setAttribute("role", "switch");
    switchEl.style.cssText = "flex:none;position:relative;width:38px;height:22px;border-radius:11px;border:none;padding:0;cursor:pointer;transition:background .18s;";
    const knob = document.createElement("span");
    knob.style.cssText = "position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.28);transition:transform .18s;";
    switchEl.appendChild(knob);
    const syncSwitch = () => {
      switchEl.setAttribute("aria-checked", iconHidden ? "false" : "true");
      switchEl.style.background = iconHidden ? "rgba(0,0,0,.18)" : "var(--wb-pane-accent,#24c9d7)";
      knob.style.transform = iconHidden ? "translateX(0)" : "translateX(16px)";
      toggleDesc.textContent = iconHidden
        ? "\\u5f53\\u524d\\u5df2\\u9690\\u85cf\\uff0c\\u4ecd\\u53ef\\u4ece\\u672c\\u9875\\u5207\\u6362\\u76ae\\u80a4\\u3002"
        : "\\u5173\\u95ed\\u540e\\u9690\\u85cf\\u9875\\u9762\\u4e0a\\u7684\\u60ac\\u6d6e\\u6309\\u94ae\\uff0c\\u4ecd\\u53ef\\u4ece\\u672c\\u9875\\u5207\\u6362\\u76ae\\u80a4\\u3002";
    };
    switchEl.addEventListener("click", () => {
      iconHidden = !iconHidden;
      writeIconHidden(iconHidden);
      applyIconVisibility();
      syncSwitch();
    });
    toggleRow.append(toggleCopy, switchEl);
    toggleCard.appendChild(toggleRow);
    toggleGroup.append(toggleLabel, toggleCard);
    // 开关状态可能被别处改（例如测试重置），每次打开面板都重读一次
    pane.__syncSwitch = syncSwitch;

    // ---- 分组 4：外观调节（两个 1..100 的滑块）----
    const tuneGroup = document.createElement("div");
    const tuneLabel = document.createElement("p");
    tuneLabel.textContent = "外观调节";
    tuneLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    const tuneCard = document.createElement("div");
    tuneCard.style.cssText = "border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));background:var(--wb-pane-card,#fff);";
    const tuneSyncers = [];
    const mkSlider = (spec) => {
      const rowEl = document.createElement("div");
      rowEl.style.cssText = "padding:12px 14px;";
      const head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px;";
      const name = document.createElement("span");
      name.textContent = spec.label;
      name.style.cssText = "flex:1;min-width:0;";
      const value = document.createElement("span");
      value.style.cssText = "flex:none;font:500 12px/1 ui-monospace,monospace;opacity:.75;min-width:28px;text-align:right;";
      head.append(name, value);

      const input = document.createElement("input");
      input.type = "range";
      input.min = "1";
      input.max = "100";
      input.step = "1";
      input.dataset.wbTunable = spec.key;
      // 根节点是 user-select:none，滑块必须显式开回交互（与重命名输入框同理）
      input.style.cssText = "width:100%;margin:0;accent-color:var(--wb-pane-accent,#24c9d7);cursor:pointer;user-select:none;";
      input.setAttribute("aria-label", spec.label);

      const sync = () => {
        input.value = String(tunables[spec.key]);
        value.textContent = String(tunables[spec.key]);
      };
      input.addEventListener("input", () => {
        tunables[spec.key] = clampTunable(spec, input.value);
        // ⚠️ 只跑渲染同步，**不更新数字标签**（见下面的性能说明）。
        applyTunables();
      });
      // 松手才落盘 + 才刷新数字：拖动过程中每次 input 都写 localStorage 是没必要的同步 IO。
      //
      // ⚠️ 数字为什么不在拖动中实时更新（2026-09-20 实测）：
      //    设置弹窗打开时，**任何**文本改动都会让文档布局变脏，而一次布局约 29ms
      //    （弹窗内有 2700+ 元素）→ 拖动只剩 ~33fps，明显卡顿。
      //    实测对照：改 textContent 后强制布局 = 29ms；同一元素只改 transform = 0ms；
      //    把读数挪到弹窗之外也一样是 29ms（代价来自"弹窗开着时整篇布局都很贵"，不是位置问题）。
      //    所以拖动路径刻意做成"零布局"：数字在松手时补上，拖动中的反馈交给
      //    滑块自身的位置 + 背景模糊的实时变化（那两项都是 0ms）。
      input.addEventListener("change", () => { writeTunables(); sync(); });
      // 别让拖动事件冒泡出去（设置弹窗有"点空白处关闭"之类的外部点击逻辑）
      ["click", "pointerdown", "mousedown"].forEach((type) => {
        input.addEventListener(type, (event) => event.stopPropagation());
      });

      rowEl.append(head, input);
      tuneSyncers.push(sync);
      sync();
      return rowEl;
    };
    TUNABLE_SPEC.forEach((spec, index) => {
      const el = mkSlider(spec);
      if (index > 0) el.style.borderTop = "1px solid var(--wb-pane-border,rgba(0,0,0,.06))";
      tuneCard.appendChild(el);
    });
    tuneGroup.append(tuneLabel, tuneCard);
    // 值可能被别处改（测试/重置），每次打开面板都重读一次
    pane.__syncTunables = () => {
      for (const spec of TUNABLE_SPEC) tunables[spec.key] = clampTunable(spec, readTunables()[spec.key]);
      applyTunables();
      tuneSyncers.forEach((fn) => fn());
    };

    // ---- 分组 5：Wallpaper Engine 壁纸（本机）----
    // 面板结构对齐 dsh 皮肤中心的壁纸库：声音/音量 -> 手动目录 -> 评级筛选 -> 分页 -> 卡片。
    const weGroup = document.createElement("div");
    const weLabel = document.createElement("p");
    weLabel.textContent = "Wallpaper Engine 壁纸";
    weLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    const weCard = document.createElement("div");
    weCard.style.cssText = "border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));background:var(--wb-pane-card,#fff);overflow:hidden;";

    // 「仅本机」标注：WE 主题引用的是本机绝对路径，换台机器就是死链；
    // 创意工坊内容版权归作者，不可再分发。
    const weNote = document.createElement("div");
    weNote.textContent = "\\u26a0\\ufe0f 仅本机可用、不可分享";
    weNote.title = "这些壁纸引用你电脑上的本地文件路径，换机器即失效；创意工坊内容版权归作者，请不要打包分发";
    weNote.style.cssText = "padding:9px 12px;font:500 11px/1.5 system-ui;color:#c2761a;" +
      "background:color-mix(in srgb, #f0a63a 14%, transparent);border-bottom:1px solid var(--wb-pane-border,rgba(0,0,0,.06));";

    const mkWeBtn = (text, primary) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.style.cssText = "border-radius:8px;cursor:pointer;font:500 12px/1 system-ui;padding:7px 11px;" +
        (primary
          ? "border:1px solid var(--wb-pane-accent,#24c9d7);background:var(--wb-pane-accent,#24c9d7);color:#fff;"
          : "border:1px solid var(--wb-pane-border,rgba(0,0,0,.14));background:transparent;color:inherit;");
      return btn;
    };
    const mkWeHeadRow = (labelText) => {
      const rowEl = document.createElement("div");
      rowEl.style.cssText = "display:flex;align-items:center;gap:10px;";
      const labelEl = document.createElement("span");
      labelEl.textContent = labelText;
      labelEl.style.cssText = "flex:none;font:400 12px/1.4 system-ui;opacity:.8;";
      rowEl.appendChild(labelEl);
      return rowEl;
    };

    // ---------- 声音 / 音量（对齐 dsh 的 skin-wallpaper.sound / volume）----------
    const weHead = document.createElement("div");
    weHead.style.cssText = "padding:10px 12px;display:flex;flex-direction:column;gap:10px;" +
      "border-bottom:1px solid var(--wb-pane-border,rgba(0,0,0,.06));";

    const soundRow = mkWeHeadRow("壁纸声音");
    const soundToggle = document.createElement("button");
    soundToggle.type = "button";
    soundToggle.dataset.wbWeSound = "1";
    soundToggle.setAttribute("role", "switch");
    soundToggle.style.cssText = "flex:none;width:40px;height:22px;border-radius:11px;border:none;" +
      "cursor:pointer;padding:0;position:relative;transition:background .15s;";
    const soundKnob = document.createElement("span");
    soundKnob.style.cssText = "position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;" +
      "background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s;";
    soundToggle.appendChild(soundKnob);
    soundToggle.addEventListener("click", () => setWeSound(!weSound));
    // 面板里的暂停键：只在用视频壁纸时才有意义，文案与显隐由 syncWeButtons 同步
    wePaneToggle = mkWeBtn("暂停播放", false);
    wePaneToggle.dataset.wbWePaneToggle = "1";
    wePaneToggle.style.cssText += "margin-left:auto;padding:6px 10px;";
    wePaneToggle.addEventListener("click", () => setWePaused(!wePaused));
    soundRow.append(wePaneToggle, soundToggle);

    const volumeRow = mkWeHeadRow("壁纸音量");
    const volumeInput = document.createElement("input");
    volumeInput.type = "range";
    volumeInput.min = "0";
    volumeInput.max = "100";
    volumeInput.step = "1";
    volumeInput.dataset.wbWeVolume = "1";
    volumeInput.style.cssText = "flex:1;min-width:0;accent-color:var(--wb-pane-accent,#24c9d7);cursor:pointer;";
    const volumeText = document.createElement("span");
    volumeText.style.cssText = "flex:none;min-width:36px;text-align:right;font:400 12px/1.4 system-ui;opacity:.7;";
    volumeInput.addEventListener("input", () => setWeVolume(volumeInput.value));
    volumeRow.append(volumeInput, volumeText);
    weHead.append(soundRow, volumeRow);

    // ---------- 手动目录 ----------
    // renderer 拿不到本地绝对路径，所以这一行用 <input webkitdirectory> 直接选目录：
    // 选中的媒体文件立即灌进面板（视频走 Blob / file URL），不经过 Node 侧二次扫描。
    const weDirWrap = document.createElement("div");
    weDirWrap.style.cssText = "padding:10px 12px;display:flex;flex-direction:column;gap:8px;" +
      "border-bottom:1px solid var(--wb-pane-border,rgba(0,0,0,.06));";
    const dirRow = document.createElement("div");
    dirRow.style.cssText = "display:flex;align-items:center;gap:8px;";
    const dirLabel = document.createElement("span");
    dirLabel.textContent = "手动目录";
    dirLabel.style.cssText = "flex:none;font:400 12px/1.4 system-ui;opacity:.8;";
    const dirInput = document.createElement("input");
    dirInput.type = "text";
    dirInput.readOnly = true;
    dirInput.dataset.wbWeDirInput = "1";
    dirInput.placeholder = "/path/to/wallpapers 或 ~/";
    dirInput.style.cssText = "flex:1;min-width:0;border-radius:8px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.14));" +
      "background:transparent;color:inherit;font:400 12px/1.4 system-ui;padding:6px 9px;";
    const dirAddBtn = mkWeBtn("添加", true);
    const dirBrowseBtn = mkWeBtn("浏览", false);
    dirRow.append(dirLabel, dirInput, dirAddBtn, dirBrowseBtn);

    const dirHint = document.createElement("div");
    dirHint.dataset.wbWeDirHint = "1";
    dirHint.style.cssText = "font:400 11px/1.5 system-ui;opacity:.6;";

    const dirPicker = document.createElement("input");
    dirPicker.type = "file";
    dirPicker.webkitdirectory = true;
    dirPicker.multiple = true;
    dirPicker.style.display = "none";
    const openDirPicker = () => dirPicker.click();
    dirAddBtn.addEventListener("click", openDirPicker);
    dirBrowseBtn.addEventListener("click", openDirPicker);
    weDirWrap.append(dirRow, dirHint, dirPicker);

    // ---------- 状态 ----------
    const WE_FILTER_KEY = "anonbuddySkinWeFilter";
    const WE_PIN_KEY = "anonbuddySkinWePinned";
    const WE_PAGE_SIZE = 9;
    let weFilter = (() => { try { const raw = localStorage.getItem(WE_FILTER_KEY); return ["all", "g", "pg13", "r18"].indexOf(raw) >= 0 ? raw : "all"; } catch (error) { return "all"; } })();
    let wePage = 1;
    let weLocalItems = [];
    const readPins = () => { try { const raw = JSON.parse(localStorage.getItem(WE_PIN_KEY) || "[]"); return Array.isArray(raw) ? raw : []; } catch (error) { return []; } };
    const writePins = (pins) => { try { localStorage.setItem(WE_PIN_KEY, JSON.stringify(pins)); } catch (error) {} };
    let wePins = readPins();

    // ---------- 评级筛选 + 页码 ----------
    const weToolbar = document.createElement("div");
    weToolbar.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 12px;flex-wrap:wrap;" +
      "border-bottom:1px solid var(--wb-pane-border,rgba(0,0,0,.06));";
    const RATING_TABS = [
      { id: "all", label: "全部" },
      { id: "g", label: "G" },
      { id: "pg13", label: "PG-13" },
      { id: "r18", label: "R18" },
    ];
    const ratingPills = new Map();
    for (const tab of RATING_TABS) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.textContent = tab.label;
      pill.dataset.wbWeRating = tab.id;
      pill.style.cssText = "border-radius:999px;cursor:pointer;font:500 12px/1 system-ui;padding:6px 12px;";
      pill.addEventListener("click", () => {
        weFilter = tab.id;
        wePage = 1;
        try { localStorage.setItem(WE_FILTER_KEY, weFilter); } catch (error) {}
        renderWeGrid();
        syncWeUi();
      });
      ratingPills.set(tab.id, pill);
      weToolbar.appendChild(pill);
    }
    const pageText = document.createElement("span");
    pageText.dataset.wbWePageText = "1";
    pageText.style.cssText = "margin-left:auto;font:400 12px/1.4 system-ui;opacity:.7;";
    weToolbar.appendChild(pageText);

    // ---------- 卡片网格 ----------
    const weGrid = document.createElement("div");
    weGrid.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:10px 12px;";
    const weEmpty = document.createElement("div");
    weEmpty.dataset.wbWeEmpty = "1";
    weEmpty.style.cssText = "grid-column:1/-1;padding:22px 14px;text-align:center;font:400 12px/1.6 system-ui;opacity:.6;";

    // ---------- 分页 ----------
    const wePager = document.createElement("div");
    wePager.style.cssText = "display:flex;align-items:center;gap:8px;padding:0 12px 12px;";
    const prevBtn = mkWeBtn("上一页", false);
    const nextBtn = mkWeBtn("下一页", false);
    const jumpInput = document.createElement("input");
    jumpInput.type = "number";
    jumpInput.min = "1";
    jumpInput.dataset.wbWeJump = "1";
    jumpInput.style.cssText = "width:58px;border-radius:8px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.14));" +
      "background:transparent;color:inherit;font:400 12px/1.4 system-ui;padding:6px 8px;";
    const jumpBtn = mkWeBtn("跳转", false);
    wePager.append(prevBtn, nextBtn, jumpInput, jumpBtn);

    // ---------- 数据 ----------
    const ratingOf = (value) => (value === "pg13" || value === "r18" ? value : "g");
    const allLocal = () => weLocalItems.concat(wePins);
    const sourceItems = () => weItems.concat(allLocal());
    const visibleItems = () => {
      const list = sourceItems();
      return weFilter === "all" ? list : list.filter((x) => ratingOf(x.rating) === weFilter);
    };
    const pageCount = () => Math.max(1, Math.ceil(visibleItems().length / WE_PAGE_SIZE));
    const typeLabel = (item) => {
      if (item.kind === "video") return "视频";
      if (item.rawType === "scene") return "场景(静态)";
      if (item.rawType === "web") return "网页";
      return "静态图片";
    };
    const ratingLabel = (rating) => (rating === "r18" ? "R18" : rating === "pg13" ? "PG-13" : "G");
    const ratingColor = (rating) => (rating === "r18" ? "#d14343" : rating === "pg13" ? "#d18b2b" : "#3f9e5a");

    // ---------- 渲染 ----------
    syncWeList = () => {
      for (const cell of weGrid.querySelectorAll("[data-wb-we-item]")) {
        const on = cell.dataset.wbWeItem === weActiveId;
        cell.style.borderColor = on ? "var(--wb-pane-accent,rgba(36,201,215,.6))" : "var(--wb-pane-border,rgba(0,0,0,.06))";
        cell.style.background = on ? "var(--wb-pane-active,rgba(36,201,215,.12))" : "transparent";
        const applyBtn = cell.querySelector("[data-wb-we-apply]");
        if (applyBtn) {
          applyBtn.textContent = on ? "当前激活" : "应用";
          applyBtn.disabled = on;
          applyBtn.style.opacity = on ? ".6" : "1";
          applyBtn.style.cursor = on ? "default" : "pointer";
        }
      }
    };

    const renderWeGrid = () => {
      weGrid.textContent = "";
      const list = visibleItems();
      const total = pageCount();
      if (wePage > total) wePage = total;
      if (wePage < 1) wePage = 1;
      const slice = list.slice((wePage - 1) * WE_PAGE_SIZE, (wePage - 1) * WE_PAGE_SIZE + WE_PAGE_SIZE);

      for (const item of slice) {
        const cell = document.createElement("div");
        cell.dataset.wbWeItem = item.id;
        cell.style.cssText = "display:flex;flex-direction:column;border-radius:10px;overflow:hidden;" +
          "border:1px solid var(--wb-pane-border,rgba(0,0,0,.06));background:transparent;";

        const thumbWrap = document.createElement("div");
        thumbWrap.style.cssText = "position:relative;aspect-ratio:16/9;background:rgba(0,0,0,.08);overflow:hidden;";
        if (item.previewUrl) {
          const thumb = document.createElement("img");
          thumb.src = item.previewUrl;
          thumb.loading = "lazy";
          thumb.alt = "";
          thumb.style.cssText = "display:block;width:100%;height:100%;object-fit:cover;";
          thumbWrap.appendChild(thumb);
        }
        const typeTag = document.createElement("span");
        typeTag.textContent = typeLabel(item);
        typeTag.style.cssText = "position:absolute;top:6px;left:6px;border-radius:6px;padding:2px 6px;" +
          "background:rgba(0,0,0,.55);color:#fff;font:500 10px/1.4 system-ui;";
        thumbWrap.appendChild(typeTag);
        const rating = ratingOf(item.rating);
        const rateTag = document.createElement("span");
        rateTag.textContent = ratingLabel(rating);
        rateTag.style.cssText = "position:absolute;top:6px;right:6px;border-radius:6px;padding:2px 6px;" +
          "color:#fff;font:600 10px/1.4 system-ui;background:" + ratingColor(rating) + ";";
        thumbWrap.appendChild(rateTag);
        cell.appendChild(thumbWrap);

        const cardBody = document.createElement("div");
        cardBody.style.cssText = "padding:7px 8px 8px;display:flex;flex-direction:column;gap:7px;flex:1;";
        const nameEl = document.createElement("div");
        nameEl.textContent = item.title;
        nameEl.title = item.title + (item.sizeMB ? "（" + item.sizeMB + " MB）" : "");
        nameEl.style.cssText = "font:400 11px/1.35 system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;gap:6px;margin-top:auto;";
        const applyBtn = mkWeBtn("应用", true);
        applyBtn.dataset.wbWeApply = "1";
        applyBtn.style.cssText += "flex:1;padding:6px 8px;";
        applyBtn.addEventListener("click", () => { applyWeTheme(item); });
        btnRow.appendChild(applyBtn);

        if (item.manual || item.pinned) {
          const sideBtn = mkWeBtn(item.pinned ? "移除" : "导入", false);
          sideBtn.style.cssText += "flex:none;padding:6px 8px;";
          sideBtn.addEventListener("click", () => {
            if (item.pinned) {
              wePins = wePins.filter((x) => x.id !== item.id);
              writePins(wePins);
            } else {
              // 「导入」= 把这条手动条目固定下来：写进 localStorage，重新 apply 后仍然显示。
              // 只有拿到真实 file:// 路径的条目才固定得住（Blob URL 出不了这次会话）。
              if (!/^file:/i.test(item.fileUrl || "")) {
                sideBtn.textContent = "本会话有效";
                setTimeout(() => { sideBtn.textContent = "导入"; }, 1400);
                return;
              }
              const pin = {
                id: item.id, title: item.title, kind: item.kind, rawType: item.rawType,
                fileUrl: item.fileUrl, previewUrl: item.previewUrl, sizeMB: item.sizeMB,
                rating: item.rating, manual: true, pinned: true,
              };
              wePins = wePins.filter((x) => x.id !== item.id).concat(pin);
              writePins(wePins);
              weLocalItems = weLocalItems.filter((x) => x.id !== item.id);
            }
            renderWeGrid();
            syncWeUi();
          });
          btnRow.appendChild(sideBtn);
        }

        cardBody.append(nameEl, btnRow);
        cell.appendChild(cardBody);
        weGrid.appendChild(cell);
      }

      if (!slice.length) {
        weEmpty.textContent = sourceItems().length === 0
          ? "未发现壁纸。可先在 Wallpaper Engine 创意工坊订阅，或在上面的手动目录里添加文件夹。"
          : "该评级下没有壁纸，换个筛选看看。";
        weGrid.appendChild(weEmpty);
      }
      syncWeList();
    };

    syncWeUi = () => {
      soundToggle.style.background = weSound ? "var(--wb-pane-accent,#24c9d7)" : "rgba(120,120,120,.35)";
      soundKnob.style.transform = weSound ? "translateX(18px)" : "translateX(0)";
      soundToggle.setAttribute("aria-checked", weSound ? "true" : "false");
      if (volumeInput.value !== String(weVolume)) volumeInput.value = String(weVolume);
      // 静音时标明状态：声音开关是独立的一行，只拖音量滑块不会解除静音
      //（浏览器不允许非静音自动播放，所以默认是静音起播）。
      // 不提示的话很容易误判成"音量功能坏了"。
      volumeText.textContent = weSound ? weVolume + "%" : weVolume + "% 静音";

      for (const [id, pill] of ratingPills) {
        const on = id === weFilter;
        pill.style.background = on ? "var(--wb-pane-accent,#24c9d7)" : "transparent";
        pill.style.color = on ? "#fff" : "inherit";
        pill.style.border = on ? "1px solid transparent" : "1px solid var(--wb-pane-border,rgba(0,0,0,.14))";
      }

      const total = pageCount();
      pageText.textContent = "第 " + wePage + " / " + total + " 页";
      jumpInput.max = String(total);
      prevBtn.disabled = wePage <= 1;
      nextBtn.disabled = wePage >= total;
      prevBtn.style.opacity = wePage <= 1 ? ".45" : "1";
      nextBtn.style.opacity = wePage >= total ? ".45" : "1";

      const localCount = weLocalItems.length + wePins.length;
      dirInput.value = localCount ? localCount + " 个条目" : "";
      dirHint.textContent = localCount
        ? "已加入 " + localCount + " 个条目（仅本机）。点卡片上的「导入」可把带真实路径的条目固定下来。"
        : "还没有手动目录。没有 Wallpaper Engine（或想用零散素材）？把任意 .mp4/.webm 视频或项目文件夹加进来，就是你的壁纸库。";
    };

    prevBtn.addEventListener("click", () => { if (wePage > 1) { wePage -= 1; renderWeGrid(); syncWeUi(); } });
    nextBtn.addEventListener("click", () => { if (wePage < pageCount()) { wePage += 1; renderWeGrid(); syncWeUi(); } });
    jumpBtn.addEventListener("click", () => {
      const want = Math.round(Number(jumpInput.value));
      if (!Number.isFinite(want)) return;
      wePage = Math.min(pageCount(), Math.max(1, want));
      renderWeGrid();
      syncWeUi();
    });

    const ratingFromTitle = (title) => {
      if (/(^|[^\\w])(r-?18|nsfw|18\\+)([^\\w]|$)/i.test(title)) return "r18";
      if (/(^|[^\\w])(pg-?13|r-?16)([^\\w]|$)/i.test(title)) return "pg13";
      return "g";
    };
    const toFileUrlLocal = (rawPath) => {
      const norm = String(rawPath).replace(/\\\\/g, "/").replace(/^\\/+/, "");
      const parts = norm.split("/");
      return "file:///" + parts.map((seg, index) => (index === 0 ? seg : encodeURIComponent(seg))).join("/");
    };
    // Electron 能给出真实绝对路径时优先用它（可持久），拿不到才退回 Blob URL（仅本次会话有效）
    const localUrlOf = (file) => {
      try {
        const wu = window.webUtils;
        if (wu && typeof wu.getPathForFile === "function") {
          const real = wu.getPathForFile(file);
          if (real) return toFileUrlLocal(real);
        }
      } catch (error) {}
      try {
        if (typeof file.path === "string" && file.path) return toFileUrlLocal(file.path);
      } catch (error) {}
      try { return URL.createObjectURL(file); } catch (error) { return null; }
    };

    dirPicker.addEventListener("change", () => {
      const files = Array.from(dirPicker.files || []);
      dirPicker.value = "";
      if (!files.length) return;
      const picked = [];
      for (const file of files) {
        const name = file.name;
        const dot = name.lastIndexOf(".");
        if (dot <= 0) continue;
        const ext = name.slice(dot).toLowerCase();
        const isVideo = ext === ".mp4" || ext === ".webm";
        const isImage = ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp";
        if (!isVideo && !isImage) continue;
        const url = localUrlOf(file);
        if (!url) continue;
        const title = name.slice(0, dot);
        picked.push({
          id: "local-" + (file.webkitRelativePath || name),
          title,
          kind: isVideo ? "video" : "preview",
          rawType: isVideo ? "video" : "image",
          fileUrl: url,
          previewUrl: isVideo ? null : url,
          sizeMB: Math.round((file.size / 1048576) * 10) / 10,
          rating: ratingFromTitle(title),
          manual: true,
        });
      }
      if (!picked.length) return;
      const known = new Set(weLocalItems.map((x) => x.id));
      for (const item of picked) if (!known.has(item.id)) { known.add(item.id); weLocalItems.push(item); }
      wePage = 1;
      renderWeGrid();
      syncWeUi();
    });

    weCard.append(weNote, weHead, weDirWrap, weToolbar, weGrid, wePager);
    weGroup.append(weLabel, weCard);
    renderWeGrid();
    syncWeUi();
    syncWeButtons();

    body.append(listGroup, addGroup, toggleGroup, tuneGroup, weGroup);
    pane.append(body);
    pane.__renderList = renderList;
    pane.__syncSelection = syncPaneSelection;
    return pane;
  };

  // 主题变量：让面板颜色跟随「设置弹窗自己的底色」（不是皮肤主题，见 paneSurface 注释）
  const syncPaneThemeVars = () => {
    if (!settingsPane || !settingsPane.isConnected) return;
    // ⚠️ 这里**始终重算、但只在值真的变了才写**（2026-09-20 踩过两次）：
    // applyMode 每次切主题都会走到这里，而往面板元素上写自定义属性会让它**整棵子树**样式失效
    // （设置弹窗 2700+ 元素）—— 无脑写会把「重复应用同一主题」从 ~0ms 抬到 53.8ms。
    // 但也不能"面板没显示就跳过"：那样面板关闭期间切主题，强调色会停在旧值（被
    // test-settings-panel 的「原生模式下强调色兜底」抓住）。所以是"算而不写"。
    const surface = paneSurface();
    const dark = !isLightSurface(surface);
    // 强调色可以沿用当前皮肤，它只是点缀，深浅背景下都够醒目。
    // 三个兜底依次是：自定义主题 → 内置主题 → 全局默认色。
    // ⚠️ 最后一个兜底正是「原生模式」会走到的分支（currentThemeId() 为 null 时前两个都落空），
    // 所以它必须是 payload 里的值，不能直接引用 Node 侧常量（会抛 ReferenceError）。
    const id = currentThemeId();
    const custom = customThemes.find((c) => c.id === id);
    const accent = custom?.colors.accent ?? data.themes.find((t) => t.id === id)?.accent ?? data.defaultAccent;
    // 每个值都先比对再写：值没变时 setProperty 照样会触发样式失效，纯属白付钱
    const setVar = (name, value) => {
      if (settingsPane.style.getPropertyValue(name) !== value) settingsPane.style.setProperty(name, value);
    };
    setVar("--wb-pane-accent", accent);
    setVar("--wb-pane-text", dark ? "#f0f2f6" : "#1a1a1a");
    setVar("--wb-pane-card", dark ? "rgba(255,255,255,.06)" : "#ffffff");
    setVar("--wb-pane-border", dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.08)");
    setVar("--wb-pane-active", dark ? "rgba(255,255,255,.10)" : "rgba(36,201,215,.12)");
    // 悬停底色：深色面板上不能再用 rgba(0,0,0,...) 那套（黑压黑等于没有反馈）
    setVar("--wb-pane-hover", dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.04)");
    setVar("--wb-pane-surface", surface);
    // 卡片底色由变量给，这里兜一个显式值，避免变量在极端情况下没生效就变透明
    const wantColor = dark ? "#f0f2f6" : "#1a1a1a";
    if (settingsPane.style.color !== wantColor) settingsPane.style.color = wantColor;
  };

  // ---- 设置界面可读性兜底（2026-09-19）----
  // 原生 .settings-modal-overlay 的 background 是透明的、.settings-navigation
  // 也没有底色 —— 弹窗整体直接压在深色皮肤的主界面上（背景图 + 深色底）。
  // 浅色模式下 .settings-modal__content 自己带了 rgb(247,247,247) 实底，所以看不出问题；
  // 但一旦弹窗底色变透明（原生主题状态下就会），左侧导航与正文会直接和背景图叠在一起，
  // 浅色文字落在深色/花哨的背景图上 → 对比度不足、看不清。
  // 对策：只在检测到"弹窗没有实底"时，给弹窗铺一层与内容区一致的实底，
  // 并且不覆盖原生已有的底色（原生有就不动，避免画蛇添足）。
  const SOLID_ONLY_WHEN_TRANSPARENT = true;
  const ensureModalSurface = () => {
    const modal = resolveSettingsRoot();
    const content = modal?.querySelector(".settings-modal__content");
    if (!content) return false;
    const alphaOf = (value) => {
      const m = /rgba?\\([0-9.]+, [0-9.]+, [0-9.]+(?:, ([0-9.]+))?\\)/.exec(value || "");
      return m ? (m[1] === undefined ? 1 : Number(m[1])) : 0;
    };
    // 内容区已有足够实底 → 原生自己能处理，别插手
    const contentBg = getComputedStyle(content).backgroundColor;
    if (alphaOf(contentBg) >= 0.9) {
      if (content.dataset.wbPaneSurface === "1") {
        content.style.removeProperty("background-color");
        delete content.dataset.wbPaneSurface;
      }
      return false;
    }
    if (!SOLID_ONLY_WHEN_TRANSPARENT) return false;
    // 只在我们自己加的那层上生效；用 dataset 标记，避免覆盖原生内联样式
    if (content.dataset.wbPaneSurface === "1") return true;
    const surface = paneSurface();
    content.style.backgroundColor = surface;
    content.dataset.wbPaneSurface = "1";
    const nav = modal.querySelector(".settings-navigation");
    if (nav && alphaOf(getComputedStyle(nav).backgroundColor) < 0.9) {
      nav.style.backgroundColor = surface;
      nav.dataset.wbPaneSurface = "1";
    }
    return true;
  };

  // 主题切换后刷新面板自身的配色（由 applyMode 调用）。
  // 为什么需要它：面板的 --wb-pane-* 变量是按「弹窗自身底色」算的，而弹窗底色会随主题变。
  // 原来只在 openPluginPane() 里算一次 → 面板开着时切主题，面板配色会停在打开那一刻的值
  // （深色弹窗配浅色变量 = 浅字压白底，面板看着像空的）。
  // ⚠️ 本段在模板字符串里，注释里不能出现反引号，变量名一律不加反引号包裹。
  refreshPaneChrome = () => {
    if (!settingsPane || !settingsPane.isConnected) return;
    // 如果我们之前给弹窗铺过实底，必须先撤掉再重算：
    // 否则 ensureModalSurface 读到的"不透明底色"其实是我们自己写的，会被误判成
    // "原生自己有实底"从而把覆盖撤掉，来回抖动。
    const modal = resolveSettingsRoot();
    const content = modal?.querySelector(".settings-modal__content");
    if (content?.dataset.wbPaneSurface === "1") {
      content.style.removeProperty("background-color");
      delete content.dataset.wbPaneSurface;
      ensureModalSurface();
    }
    syncPaneThemeVars();
  };

  // 点我们的导航条目：显示自己的面板、藏掉原生面板
  const openPluginPane = () => {
    const modal = resolveSettingsRoot();
    if (!modal) return false;
    const content = modal.querySelector(".settings-modal__content");
    if (!content) return false;
    if (!settingsPane) settingsPane = buildSettingsPane();
    if (settingsPane.parentElement !== content) content.appendChild(settingsPane);
    // 原生面板与头部：保留 DOM（React 要管），只是不显示
    settingsPane.__renderList();
    ensureModalSurface();
    syncPaneThemeVars();
    settingsPane.__syncSwitch();
    settingsPane.__syncTunables();
    settingsPane.style.display = "flex";
    content.querySelectorAll(":scope > .settings-modal__header, :scope > .settings-modal__panel").forEach((el) => {
      el.style.display = "none";
    });
    modal.querySelectorAll(".settings-navigation__item").forEach((el) => el.classList.remove("settings-navigation__item--active"));
    pluginEntry?.classList.add("settings-navigation__item--active");
    pluginEntryActive = true;
    return true;
  };

  // 原生面板回来（用户点了别的 tab / 面板重渲染）
  const closePluginPane = () => {
    if (!pluginEntryActive) return;
    pluginEntryActive = false;
    if (settingsPane) settingsPane.style.display = "none";
    const modal = resolveSettingsRoot();
    const content = modal?.querySelector(".settings-modal__content");
    content?.querySelectorAll(":scope > .settings-modal__header, :scope > .settings-modal__panel").forEach((el) => {
      el.style.display = "";
    });
  };

  // 把我们的条目补进「功能」分组（幂等）
  const ensureSettingsEntry = () => {
    if (stopped) return;
    const overlay = resolveSettingsRoot();
    if (!overlay) {
      // 面板关掉了：清掉引用，下次打开重建
      if (settingsPane) { settingsPane.remove(); settingsPane = null; }
      pluginEntry = null;
      pluginEntryActive = false;
      return;
    }
    const nav = overlay.querySelector(".settings-navigation");
    if (!nav) return;

    // 防御性去重：只按「我们自己的变量」清理不够 —— 旧版本脚本 / 异常中断留下的
    // 孤儿节点不在任何变量里，会和新插入的叠成两份。这里按 id 全量扫一遍，
    // 只保留当前实例的那一个，其余直接摘掉。
    const staleEntries = [...document.querySelectorAll('[id="' + pluginEntryId + '"]')].filter((el) => el !== pluginEntry);
    for (const el of staleEntries) el.remove();
    const stalePanes = [...document.querySelectorAll('[id="' + pluginPaneId + '"]')].filter((el) => el !== settingsPane);
    for (const el of stalePanes) el.remove();
    // 字体/卡片层也按标记扫一次（面板被 React 重建后可能留下游离的列表容器）
    for (const el of document.querySelectorAll('[data-wb-plugin-pane="1"]')) {
      if (el !== settingsPane) el.remove();
    }

    // 已经补过且还挂在树上就什么都不做
    if (pluginEntry?.isConnected) {
      if (pluginEntryActive) {
        // 面板可能被 React 重建，确认我们的面板还在
        if (!settingsPane?.isConnected || settingsPane.style.display === "none") openPluginPane();
      }
      return;
    }

    const groups = [...nav.querySelectorAll(data.settingsNavSelector)];
    // 定位「功能」分组：主匹配按分组标题文本走，不依赖分组数量与顺序。
    // 兜底也不按索引（原来的 groups[1] ?? groups[0] 会在分组增删时插错位置）：
    // 先挑第一个「里面已经有可点条目」的分组，再退到导航容器本身，
    // 这样 WorkBuddy 无论改名、合并还是新增分组，入口都仍然插得进去。
    const featureGroup = groups.find((g) =>
      (g.querySelector(".settings-navigation__group-title")?.textContent || "").trim() === data.settingsNavGroup)
      ?? groups.find((g) => g.querySelector(".settings-navigation__item"))
      ?? nav;
    if (!featureGroup) return;

    const entry = document.createElement("button");
    entry.type = "button";
    entry.id = pluginEntryId;
    entry.className = "settings-navigation__item";
    // 图标：和插件悬浮按钮同源（有自定义图就贴图，否则用调色盘字符）
    const icon = document.createElement("span");
    icon.className = "settings-navigation__icon";
    if (data.icon) {
      const img = document.createElement("span");
      img.style.cssText = "display:block;width:16px;height:16px;border-radius:4px;background-image:url(" + JSON.stringify(data.icon) + ");background-size:cover;background-position:center;";
      icon.appendChild(img);
    } else {
      icon.textContent = "\\u{1F3A8}";
      icon.style.cssText = "font-size:13px;line-height:16px;";
    }
    const label = document.createElement("span");
    label.textContent = data.pluginName;
    entry.append(icon, label);
    entry.addEventListener("click", (event) => {
      event.stopPropagation();
      openPluginPane();
    });
    featureGroup.appendChild(entry);
    pluginEntry = entry;

    // 用户点了别的导航项 → 收起我们的面板
    if (!nav.__wbPluginBound) {
      nav.__wbPluginBound = true;
      nav.addEventListener("click", (event) => {
        if (event.target.closest?.("#" + pluginEntryId)) return;
        closePluginPane();
      }, true);
    }
  };
  ensureSettingsEntry();

  // 设置面板整体是 React 渲染的，守着 body 补条目（幂等，开销可控）
  const settingsObserver = new MutationObserver(() => ensureSettingsEntry());
  settingsObserver.observe(document.body, { childList: true, subtree: true });
  const settingsTimer = setInterval(ensureSettingsEntry, 1200);

  // 悬浮图标的显隐：启动时按存档还原
  applyIconVisibility();
  // 两个外观调节项：启动时按存档还原（只写 CSS 变量，不碰 <style>）
  applyTunables();

  // 供脚本化调用与测试：
  //   importFromDataUrl(dataUrl, name)  新增一个自定义主题
  //   renameTheme(id, name)             id 传主题 id；原生界面行传 null；name 传空串恢复默认名
  //   deleteCustomTheme(id)             删除某个自定义主题（只对上传的主题有效）
  //   customThemes() / aliases() / lastTheme()   查看自定义主题、别名表、上次选用的主题
  const renameTheme = (id, name) => {
    const key = aliasKeyOf(id ?? null);
    const target = rows.get(id ?? null);
    const next = typeof name === "string" ? name.trim() : "";
    if (!next || (target && next === target.__defaultLabel)) delete aliases[key];
    else aliases[key] = next;
    writeAliases();
    if (target) {
      target.__text.textContent = next || target.__defaultLabel;
      syncTitle(target);
    }
    return next || null;
  };
  window.__anonbuddySkin = {
    importFromDataUrl,
    setTheme,
    clearTheme,
    resetPosition,
    renameTheme,
    deleteCustomTheme,
    // ---- 设置面板集成（供测试与脚本化调用）----
    settings: {
      // 面板名 / 选择器常量，测试用来定位
      name: data.pluginName,
      entryId: pluginEntryId,
      paneId: pluginPaneId,
      overlaySelector: data.settingsOverlaySelector,
      navGroup: data.settingsNavGroup,
      // 面板强调色的兜底值（没有皮肤时用），供测试断言"原生模式真的走到了这一级兜底"
      defaultAccent: data.defaultAccent,
      // 把条目补进导航栏（幂等）；面板没开时返回 false
      ensure: ensureSettingsEntry,
      // 打开我们的面板（等价于点那个导航条目）
      open: openPluginPane,
      close: closePluginPane,
      isOpen: () => pluginEntryActive,
      entry: () => document.getElementById(pluginEntryId),
      pane: () => document.getElementById(pluginPaneId),
      // 面板里列出/点选的条目
      rows: () => [...(document.getElementById(pluginPaneId)?.querySelectorAll("[data-wb-theme-id]") ?? [])].map((el) => ({
        id: el.dataset.wbThemeId === "native" ? null : el.dataset.wbThemeId,
        label: el.__text?.textContent ?? "",
        selected: el.__check ? el.__check.style.opacity === "1" : false,
      })),
      clickRow: (id) => {
        const key = id === null ? "native" : String(id);
        const el = document.getElementById(pluginPaneId)?.querySelector('[data-wb-theme-id="' + key + '"]');
        if (!el) return false;
        el.click();
        return true;
      },
    },
    // 悬浮小图标开关
    icon: {
      isHidden: () => iconHidden,
      setHidden: (hidden) => {
        iconHidden = Boolean(hidden);
        writeIconHidden(iconHidden);
        applyIconVisibility();
        settingsPane?.__syncSwitch?.();
        return iconHidden;
      },
      visible: () => button.style.display !== "none",
      key: ICON_HIDDEN_KEY,
    },
    // Wallpaper Engine 壁纸（本机、file:// 直读）—— 供测试与脚本化调用
    we: {
      // ⚠️ 别在这里裁剪字段：面板内部用的是原始 weItems（带 heroUrl/canExtract），
      //    这里漏字段会让测试断言看不到它们（踩过：误判成 payload 没传）。
      items: () => weItems.map((x) => ({ ...x })),
      active: () => weActiveId,
      paused: () => wePaused,
      setPaused: (paused) => { setWePaused(paused); return wePaused; },
      apply: (id) => {
        const item = weItems.find((x) => x.id === id);
        if (!item) return null;
        applyWeTheme(item);
        return weThemeId(item);
      },
      themeKey: WE_THEME_KEY,
      pausedKey: WE_PAUSED_KEY,
      /** 背景图层里的视频节点（没有则为 null） */
      videoEl: () => document.querySelector("#" + BG_LAYER_ID + " > video[data-wb-we-video]"),
      videoState: () => {
        const v = document.querySelector("#" + BG_LAYER_ID + " > video[data-wb-we-video]");
        if (!v) return null;
        return {
          src: v.getAttribute("src"), paused: v.paused, loop: v.loop,
          muted: v.muted, autoplay: v.autoplay, playsInline: v.playsInline,
          readyState: v.readyState, videoWidth: v.videoWidth, videoHeight: v.videoHeight,
        };
      },
      /** 悬浮小图标旁的暂停键（测试断言它的显隐与文案） */
      toggleBtn: () => document.querySelector("button[data-wb-we-toggle]"),
    },
    // 两个外观调节项（侧边栏毛玻璃 / 背景图模糊）—— 供测试与脚本化调用
    tunables: {
      key: TUNABLES_KEY,
      /** 当前值（1..100） */
      get: () => ({ ...tunables }),
      /** 规格：min/max/默认值/换算系数/CSS 变量名 */
      spec: () => TUNABLE_SPEC.map(({ key, label, varName, factor, def }) => ({ key, label, varName, factor, def })),
      /** 设置某一项（会自动 clamp 到 1..100 并落盘） */
      set: (key, value) => {
        const spec = TUNABLE_SPEC.find((s) => s.key === key);
        if (!spec) return null;
        tunables[key] = clampTunable(spec, value);
        applyTunables();
        writeTunables();
        settingsPane?.__syncTunables?.();
        return tunables[key];
      },
      /**
       * 读回**实际生效**的渲染状态（诊断与断言用）。
       * ⚠️ 两个值都不在 html 上：背景模糊是背景图层的内联 style.filter，
       * 侧边栏模糊是侧边栏元素自身的内联变量 —— 这是为了避开
       * "在 html 上改自定义属性会触发全文档重算"那个性能坑。
       */
      cssVars: () => {
        const layer = document.getElementById(BG_LAYER_ID);
        const sidebar = document.querySelector(SIDEBAR_SEL);
        return {
          layerPresent: Boolean(layer),
          bgFilter: layer?.style.filter || "none",
          bgInset: layer?.style.inset || "0px",
          sidebarVar: sidebar?.style.backdropFilter || "",
          sidebarBackdrop: sidebar ? getComputedStyle(sidebar).backdropFilter : null,
        };
      },
      /** 背景图层节点（测试用来断言节点存在与收尾清理） */
      layerId: BG_LAYER_ID,
      /** 只跑渲染同步（不写 localStorage）—— 用于量"拖动中"的真实代价 */
      apply: () => { applyTunables(); return true; },
    },
    // 文案替换（侧边栏应用名 / 欢迎页主标题）+ 主标题逐字拆分 —— 供测试与脚本化调用
    copy: {
      apply: applyCopy,
      brand: BRAND_TEXT,
      title: HERO_TITLE_TEXT,
      originals: { brand: [...BRAND_ORIGINALS], title: [...HERO_ORIGINALS] },
      // 逐字拆分后的字节点（测试用：断言个数、延迟、文本）
      chars: () => [...document.querySelectorAll(".wb-home-header__title span > " + CHAR_TAG)],
      // 把拆开的字并回一个文本节点
      unsplit: () => {
        for (const host of document.querySelectorAll(".wb-home-header__title > span")) {
          const chars = host.querySelectorAll(":scope > " + CHAR_TAG);
          if (!chars.length) continue;
          host.textContent = [...chars].map((c) => c.textContent).join("");
        }
      },
      // 完整还原（卸载皮肤时调）：
      // 顺序很关键 —— 必须先停掉观察器，再合并节点。
      // 否则合并动作会被 MutationObserver 捕捉到，applyCopy 立刻把它又拆一次，
      // 结果就是"pause 之后界面还留着一堆 <i>"（这个坑实测撞过）。
      // dispose() 里会把 stopped 置位，所以即使还有 rAF / interval 回调排在队列里，
      // 它们也只会空转，不会再把节点拆开。
      restore: () => {
        dispose();
        // 先合并逐字节点，再还原文案（合并会丢内联的 background-size/position）
        for (const host of document.querySelectorAll(".wb-home-header__title > span")) {
          const chars = host.querySelectorAll(":scope > " + CHAR_TAG);
          if (!chars.length) continue;
          host.textContent = [...chars].map((c) => c.textContent).join("");
        }
        for (const el of document.querySelectorAll(".wb-home-header__title")) {
          if ((el.textContent ?? "").trim() === HERO_TITLE_TEXT) {
            // 还原成原生文案里最可能的那一条（中文简体优先）
            const original = [...HERO_ORIGINALS].find((t) => /[\u4e00-\u9fa5]/.test(t) && !t.includes(",")) ?? [...HERO_ORIGINALS][0];
            replaceText(el, original);
            for (const child of el.children) {
              if (child.tagName === "SPAN") replaceText(child, original);
            }
          }
          el.style.gap = "";
        }
        for (const el of document.querySelectorAll(".logo-workbuddy-title")) {
          if ((el.textContent ?? "").trim() === BRAND_TEXT) {
            replaceText(el, "WorkBuddy AI");
            el.setAttribute("title", "WorkBuddy AI");
          }
        }
      },
      // 只停机不还原（兼容旧调用名；也用于重新 apply 前清掉旧实例）
      stop: () => dispose(),
    },
    // 重新 apply 前先收掉上一个实例：只删 DOM 节点不够，旧观察器/定时器还活着
    dispose,
    // ---- 与 WorkBuddy 自带「外观（浅色/深色）」的联动（供测试与脚本化调用）----
    appearance: {
      /** 当前外观是深色还是浅色（由皮肤底色决定，不读原生状态） */
      mode: () => (activeSurface !== null && !isLightSurface(activeSurface) ? "dark" : "light"),
      /** 当前被锁住的那一侧："dark" | "light" | null（null = 未锁，交还原生） */
      locked: () => lockedPolarity,
      /**
       * 解除外观护栏（**仅供测试隔离使用**）。
       * 用途：验证「data-skin 原生契约」时必须让护栏闭嘴 —— 否则皮肤接管期间
       * 任何把外观改到相反侧的尝试都会被兜底轮询纠正，测不出"原生有没有抢写类名"。
       * 下一次 applyMode（切主题 / 换肤）会自动重新上锁。
       */
      releaseLock: () => { enforceAppearanceGuard(null); return true; },
      /** 皮肤是否已声明接管原生外观（写进 <html data-skin>） */
      owns: () => document.documentElement.getAttribute("data-skin") === "wb-skin-studio",
      /** 账号维度外观偏好 key（可能是 null：还没登录 / 没跑过外观面板） */
      scopedKey: readAccountScopedModeKey,
      /** 手动把外观同步一次（幂等，给脚本/测试用） */
      sync: () => {
        if (activeSurface !== null) applyMode(activeSurface);
        return document.body.getAttribute("data-vscode-theme-kind");
      },
      /** 读原生外观状态（用于诊断：皮肤有没有真的覆盖住原生） */
      native: () => ({
        kind: document.body.getAttribute("data-vscode-theme-kind"),
        name: document.body.getAttribute("data-vscode-theme-name"),
        colorScheme: document.documentElement.style.colorScheme,
        themeAttr: document.documentElement.getAttribute("data-theme"),
      }),
    },
    aliases: () => ({ ...aliases }),
    customThemes: () => customThemes.map(({ id, name }) => ({ id, name })),
    lastTheme: () => readLastTheme(),
    // 开机默认主题：读 / 写（传 null 或空串即清除） 供测试与脚本化调用
    bootTheme: () => readBootTheme(),
    setBootTheme: (id) => { writeBootTheme(id); return readBootTheme(); },
  };
  return true;
})()`;
}
