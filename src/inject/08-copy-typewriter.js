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
  const HERO_TITLE_TEXT = "\u63a2\u7d22\u672a\u81f3\u4e4b\u5883";
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

