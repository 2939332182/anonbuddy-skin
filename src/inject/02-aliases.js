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
    input.title = "\u56de\u8f66\u4fdd\u5b58 \u00b7 Esc \u53d6\u6d88 \u00b7 \u6e05\u7a7a\u540e\u56de\u8f66\u6062\u590d\u9ed8\u8ba4";
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

