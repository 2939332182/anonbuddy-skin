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

