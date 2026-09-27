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

