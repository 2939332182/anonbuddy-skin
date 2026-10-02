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
      const m = /rgba?\([0-9.]+, [0-9.]+, [0-9.]+(?:, ([0-9.]+))?\)/.exec(value || "");
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
      icon.textContent = "\u{1F3A8}";
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
      // 声音与音量：scene 渲染走自己的音频通道（syncWwglVolume），
      // 这一组让实测脚本能从外面把音量/静音推过去并读回实际值。
      sound: () => weSound,
      volume: () => weVolume,
      setSound: (value) => { setWeSound(value); return weSound; },
      setVolume: (value) => { setWeVolume(value); return weVolume; },
      soundKey: WE_SOUND_KEY,
      volumeKey: WE_VOLUME_KEY,
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
      // ---- WebWallGL（scene 实时渲染）----
      // 这一组是给实测脚本用的"能自证"的读数：渲染是否就绪、canvas 是否真的进了图层、
      // 上下文有没有被收掉。没有这些，测试只能靠截图肉眼看。
      wwglUrl: () => wwglUrl,
      wwglLibLoaded: () => Boolean(wwglLib),
      wwglActive: () => Boolean(wwglInstance),
      wwglId: () => wwglRenderId,
      wwglGeneration: () => wwglGeneration,
      wwglStats: () => {
        if (!wwglInstance) return null;
        try { return { fps: wwglInstance.stats?.fps ?? null, running: wwglInstance.stats?.running ?? null, info: wwglInstance.info ?? null }; }
        catch (error) { return null; }
      },
      /** scene 渲染容器（没有则为 null） */
      sceneEl: () => document.querySelector("#" + BG_LAYER_ID + " > div[data-wb-we-scene]"),
      sceneCanvas: () => document.querySelector("#" + BG_LAYER_ID + " > div[data-wb-we-scene] canvas"),
      /** 第四档兜底渐变层（没有则为 null） */
      gradientEl: () => document.querySelector("#" + BG_LAYER_ID + " > div[data-wb-we-gradient]"),
      /** 一键等渲染就绪：实测脚本用它避免 sleep 猜时间 */
      waitReady: (timeoutMs) => new Promise((resolve) => {
        const deadline = Date.now() + (Number(timeoutMs) || 20000);
        const tick = () => {
          if (wwglInstance) { resolve(true); return; }
          if (Date.now() > deadline) { resolve(false); return; }
          setTimeout(tick, 200);
        };
        tick();
      }),
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
            const original = [...HERO_ORIGINALS].find((t) => /[一-龥]/.test(t) && !t.includes(",")) ?? [...HERO_ORIGINALS][0];
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
