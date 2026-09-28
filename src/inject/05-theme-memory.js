  // ---- 记住上次用的主题：重启后由 apply --theme last 自动恢复（自定义主题也能恢复）----
  const LAST_KEY = "anonbuddySkinLastTheme";
  const NATIVE_MARK = "__native__";
  const readLastTheme = () => {
    try { return localStorage.getItem(LAST_KEY); } catch { return null; }
  };
  // 把"现在用的是哪套皮肤"回写到 Node 侧的状态文档
  // （%LOCALAPPDATA%\AnonBuddySkin\state.json，见 src/active-state.mjs）。
  // 通道是常驻守护用 Runtime.addBinding 挂在 window 上的函数；一次性注入
  // （cli apply）时它不存在，那就静默跳过 —— 状态文档是旁路信息，
  // 绝不能反过来把换肤流程搞挂。
  const reportActive = (value) => {
    try {
      const channel = data.reportBinding ? window[data.reportBinding] : null;
      if (typeof channel === "function") channel(JSON.stringify({ type: "active", id: value }));
    } catch {}
  };
  const writeLastTheme = (value) => {
    try { localStorage.setItem(LAST_KEY, value); } catch {}
    reportActive(value);
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

  // ---- 换肤事务：要么整体生效，要么完全不动 ----
  // 思路借自 DSH 皮肤中心的 effect-ledger（每个 activation 记下自己写过哪些节点/属性，
  // 替换时逆序撤销；装不上就保留旧皮肤）。原来三条切换路径（setTheme / applyCustomTheme /
  // clearTheme）都是"边走边改"，任何一步抛错都会留下半截状态：CSS 已经换成新的、
  // dataset 还指着旧的、菜单高亮停在上一套 —— 而 theme.css 来自用户主题包，
  // 坏主题是真实存在的输入，不是理论风险。
  // 现在把"落地"收成一个事务：拍快照 → 落地 → 出错按相反顺序还原。
  //
  // ⚠️ paint() 的高亮目标恒等于 dataset 里的 id（三条路径都这么写），
  //    所以快照不必单独记它，回滚时直接用 dataset 的旧值。
  // ⚠️ skinOwned 必须在 applyMode 之前落好：applyMode 靠它决定要不要 syncAppearance。
  const commitTheme = (next) => {
    const before = {
      css: style.textContent,
      skinId: document.documentElement.dataset.anonbuddySkin ?? null,
      owned: skinOwned,
      surface: activeSurface,
    };
    const applySkinId = (id) => {
      if (id === null) delete document.documentElement.dataset.anonbuddySkin;
      else document.documentElement.dataset.anonbuddySkin = id;
    };
    try {
      style.textContent = next.css;
      applySkinId(next.skinId);
      skinOwned = next.owned;
      applyMode(next.surface);
      paint(next.skinId);
      writeLastTheme(next.storageValue);
      return true;
    } catch (error) {
      try {
        // 逆序撤：先还原样式，再还原身份，最后还原外观与高亮，
        // 顺序和上面落地时相反，中途失败也不会叠出更坏的状态。
        style.textContent = before.css;
        applySkinId(before.skinId);
        skinOwned = before.owned;
        applyMode(before.surface);
        paint(before.skinId);
      } catch {}
      // 回滚成功 = 页面回到换肤前的样子，用户感受是"点了没反应"，
      // 总好过"皮肤坏了"。错误照旧抛出去，控制台里能看到真实原因。
      throw error;
    }
  };

  const setTheme = (id) => {
    // 自定义上传的主题不在 data.themes 里，从本地保存的列表里取，避免为了恢复它而重新压缩图片
    const custom = customThemes.find((candidate) => candidate.id === id);
    if (custom) { applyCustomTheme(custom); return; }
    const theme = data.themes.find((candidate) => candidate.id === id);
    if (!theme) return;
    onLeaveWeTheme();
    commitTheme({ css: theme.css, skinId: theme.id, owned: true, surface: theme.surface, storageValue: theme.id });
  };
  const clearTheme = () => {
    // 交还给 WorkBuddy 自带外观：撤掉 data-skin（让原生 ThemeManager 恢复自理）、
    // 解开外观护栏，并把外观状态恢复成用户上次在原生面板里选的那个。
    // 护栏解开后若事务失败，回滚路径里 skinOwned 回到 true、applyMode 会重新 syncAppearance
    // 把代管权拿回来 —— 不需要给 releaseAppearanceOwnership 写一个反函数。
    onLeaveWeTheme();
    releaseAppearanceOwnership();
    commitTheme({ css: "", skinId: null, owned: false, surface: "#ffffff", storageValue: NATIVE_MARK });
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

