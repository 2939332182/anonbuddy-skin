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

