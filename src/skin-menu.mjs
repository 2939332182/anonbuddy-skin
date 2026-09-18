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

export function buildSkinMenuScript({ entries, activeId, styleId, menuId, cssTemplate = "", restoreLast = false, iconDataUrl = null }) {
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
    // 旧版单主题：id 固定 custom-upload，键 workbuddyCustomTheme（首次运行会迁移进 customListKey）
    customId: "custom-upload",
    storageKey: "workbuddyCustomTheme",
    customListKey: "workbuddyCustomThemes",
  });

  return `(() => {
  const data = ${payload};

  // 幂等收尾：apply 会被反复调用（启动 / 换主题 / 测试脚本），每次都 eval 一遍整段脚本。
  // 卸载上一个实例时只删 DOM 节点是不够的 —— 旧实例的 MutationObserver 和 1.5s setInterval
  // 还活着，会继续把主标题拆成逐字节点。结果就是 pause 时已经合并好的文本被旧实例
  // "拆回去"，看起来像 restore 完全失效（实测踩过：第一次 pause 有效，之后全部无效）。
  // 所以这里必须显式把上一个实例停掉，且顺序在创建新实例之前。
  try { window.__workbuddySkin?.copy?.stop?.(); } catch {}
  try { window.__workbuddySkin?.dispose?.(); } catch {}
  delete window.__workbuddySkin;

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
  button.title = "WorkBuddy Skin Studio\\uff08\\u53ef\\u62d6\\u52a8\\uff09";
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
  const ALIAS_KEY = "workbuddySkinAliases";
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
    // __defaultLabel 必须是主题真名，不能是别名 —— 否则「清空还原」会还原成上一次的别名
    item.__defaultLabel = options.defaultLabel ?? label;
    item.__themeId = options.renamable ? (options.id ?? null) : undefined;
    item.__hint = options.menuHint ?? "\\uff08\\u53f3\\u952e\\u91cd\\u547d\\u540d\\uff09";
    item.addEventListener("mouseenter", () => { if (item.style.fontWeight !== "700") item.style.background = "rgba(0,0,0,.05)"; });
    item.addEventListener("mouseleave", () => paint(document.documentElement.dataset.workbuddySkin ?? null));
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
    if (options.before) panel.insertBefore(item, options.before); else panel.appendChild(item);
    return item;
  };

  const isLightSurface = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return true;
    const v = parseInt(m[1], 16);
    return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) > 140;
  };
  // 同步切换 WorkBuddy 的 VS Code 主题模式，让原生控件（输入框/按钮等）跟着深浅色变
  const applyMode = (surface) => {
    const dark = !isLightSurface(surface);
    const body = document.body;
    const html = document.documentElement;
    body.dataset.vscodeThemeKind = dark ? "vscode-dark" : "vscode-light";
    body.dataset.vscodeThemeName = dark ? "IDE Dark" : "IDE Light";
    html.style.colorScheme = dark ? "dark" : "light";
    ["light", "vscode-light", "cb-light", "dark", "vscode-dark", "cb-dark"].forEach((cls) => {
      const isDarkCls = cls === "dark" || cls === "vscode-dark" || cls === "cb-dark";
      body.classList.toggle(cls, dark ? isDarkCls : !isDarkCls);
      html.classList.toggle(cls, dark ? isDarkCls : !isDarkCls);
    });
  };
  // ---- 记住上次用的主题：重启后由 apply --theme last 自动恢复（自定义主题也能恢复）----
  const LAST_KEY = "workbuddySkinLastTheme";
  const NATIVE_MARK = "__native__";
  const readLastTheme = () => {
    try { return localStorage.getItem(LAST_KEY); } catch { return null; }
  };
  const writeLastTheme = (value) => {
    try { localStorage.setItem(LAST_KEY, value); } catch {}
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
    style.textContent = theme.css;
    document.documentElement.dataset.workbuddySkin = theme.id;
    applyMode(theme.surface);
    paint(theme.id);
    writeLastTheme(theme.id);
  };
  const clearTheme = () => {
    style.textContent = "";
    delete document.documentElement.dataset.workbuddySkin;
    applyMode("#ffffff");
    paint(null);
    writeLastTheme(NATIVE_MARK);
  };

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
    style.textContent = buildCustomCss(theme.dataUrl, theme.colors, theme.id);
    document.documentElement.dataset.workbuddySkin = theme.id;
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
    if (document.documentElement.dataset.workbuddySkin === id) clearTheme();
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
  let stopped = false;
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
    if (window.__workbuddySkin?.copy) window.__workbuddySkin.copy.applied = (copyObserver.__roots?.size ?? 0);
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
    clearTimeout(resizeTimer);
    window.removeEventListener("resize", onResize);
    copyObserver.disconnect();
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
  const POS_KEY = "workbuddySkinMenuPos";
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
  root.append(button, panel, picker, ctxMenu);
  document.body.appendChild(root);

  // 启动时应用哪个主题：
  //   restoreLast（apply --theme last）→ 用用户上次在菜单里选的那个，自定义主题也能恢复；
  //   还没记录过（例如刚升级到这一版）→ 沿用当前页面上已经生效的主题，避免升级后突然变脸；
  //   存的主题已失效（例如被删掉）→ 退回 CLI 指定的主题。
  const currentSkin = document.documentElement.dataset.workbuddySkin ?? null;
  const preferred = data.restoreLast ? (readLastTheme() ?? currentSkin) : null;
  if (preferred === NATIVE_MARK) clearTheme();
  else if (preferred !== null && canApplyTheme(preferred)) setTheme(preferred);
  else if (data.activeId === null) clearTheme();
  else setTheme(data.activeId);

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
  window.__workbuddySkin = {
    importFromDataUrl,
    setTheme,
    clearTheme,
    resetPosition,
    renameTheme,
    deleteCustomTheme,
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
    aliases: () => ({ ...aliases }),
    customThemes: () => customThemes.map(({ id, name }) => ({ id, name })),
    lastTheme: () => readLastTheme(),
  };
  return true;
})()`;
}
