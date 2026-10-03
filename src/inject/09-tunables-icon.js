  // ---- 位置记忆 + 拖动：图标可拖到任意位置，坐标存 localStorage ----
  // 存的是「贴左边还是贴右边 + 距该边的距离」，不是绝对 x/y。
  // 绝对坐标在窗口缩小后会被夹到右边缘，之后再放大也回不到原位 ——
  // 这就是"窗口非最大化时插件图标位置偏移"的成因。
  const POS_KEY = "anonbuddySkinMenuPos";
  // 悬浮图标显隐开关：设置面板里的「显示悬浮小图标」控制；关掉后按钮隐藏，
  // 但菜单本身与皮肤照常工作（入口改从设置面板进）。
  // ---- 外观调节项（2026-10-04 从"两个滑块"扩成一套外观系统）----
  // 原来只有「侧边栏毛玻璃 / 背景图模糊」，覆盖不到真正决定观感的东西：
  // 壁纸压多暗、玻璃透不透、边缘有没有厚度。现在按两组给六个：
  //   壁纸组     —— 壁纸模糊、磨砂遮罩
  //   液态玻璃组 —— 玻璃模糊、玻璃通透、顶部高光、边缘描边
  // 配方与取值区间照 dsh-wallpaper-engine（MIT）的实测口径，见 skin.css 顶部注释。
  //
  // 每个键：0..100 的滑块值 × factor = CSS 变量的最终取值（换算区间写在行尾注释里）。
  // 默认值不是随手取的：玻璃 0.3×55≈16px、遮罩 0.01×25=0.25、通透 62% 都对齐参考实现的默认观感。
  // legacyKey 是给老用户留的迁移通道：sidebarBlur 这个键在新版里泛化成了 glassBlur
  // （从"只作用于侧边栏"扩到所有玻璃面），读到旧值时按同一个含义搬过来，不让用户的调节白调。
  const TUNABLES_KEY = "anonbuddySkinTunables";
  const TUNABLE_SPEC = [
    { key: "bgBlur", group: "壁纸", label: "壁纸模糊", def: 1, varName: "--wb-bg-blur-px", factor: 0.3 },     // 0..30px
    { key: "scrim", group: "壁纸", label: "磨砂遮罩", def: 25, varName: "--wb-scrim-alpha", factor: 0.01 },    // 0..1
    { key: "glassBlur", group: "液态玻璃", label: "玻璃模糊", def: 55, varName: "--wb-glass-blur-px", factor: 0.3, legacyKey: "sidebarBlur" }, // 0..30px
    { key: "glassTint", group: "液态玻璃", label: "玻璃通透", def: 62, varName: "--wb-glass-tint", factor: 1 },        // 0..100%
    { key: "glassSheen", group: "液态玻璃", label: "顶部高光", def: 50, varName: "--wb-glass-sheen", factor: 0.0064 },  // 0..0.64
    { key: "glassBorder", group: "液态玻璃", label: "边缘描边", def: 25, varName: "--wb-glass-border", factor: 0.0032 }, // 0..0.32
  ];
  // 滑块对外统一 0..100（0 是"关掉这一项"，有意义：遮罩 0 = 不压暗、高光 0 = 平板玻璃）
  const clampTunable = (spec, value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return spec.def;
    const lo = typeof spec.min === "number" ? spec.min : 0;
    const hi = typeof spec.max === "number" ? spec.max : 100;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  };
  const readTunables = () => {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(TUNABLES_KEY) ?? "null"); } catch {}
    const out = {};
    for (const spec of TUNABLE_SPEC) {
      let raw = stored ? stored[spec.key] : undefined;
      // 旧键迁移：sidebarBlur → glassBlur
      if (raw === undefined && spec.legacyKey && stored) raw = stored[spec.legacyKey];
      out[spec.key] = clampTunable(spec, raw ?? spec.def);
    }
    return out;
  };
  const tunables = readTunables();
  const writeTunables = () => {
    try { localStorage.setItem(TUNABLES_KEY, JSON.stringify(tunables)); return true; } catch { return false; }
  };

  // 背景媒体层的节点引用。真实节点在下方创建（那时才能 append 到 body），
  // 这里先声明 —— applyTunables 在初始化阶段就会被调用，直接引用 const 会撞 TDZ。
  let bgLayer = null;
  // 磨砂遮罩层：bgLayer 的子元素，同样先声明后创建（理由同上）。
  let weScrimEl = null;
  // 侧边栏模糊的补涂钩子（React 重建侧边栏会丢掉内联值，由护栏轮询顺手补回）。
  // 同样是前置声明，实现在 applySidebarBlur 之后赋值。
  let reapplySidebarBlur = () => {};

  // 背景媒体层的 id。CSS 侧硬编码同名选择器（与 #anonbuddy-skin-menu 的既有做法一致）。
  const BG_LAYER_ID = "anonbuddy-skin-bg";
  const SIDEBAR_SEL = "[data-view-id=sidebar]";

  // ---- 玻璃面：直接写 backdrop-filter 内联样式，不走自定义属性 ----
  // 实测（本机 2269 个元素）：
  //   · 在 html 上 style.setProperty 写自定义属性 → 全文档重算，23ms/次（拖动只有 ~40fps）
  //   · 在元素上写自定义属性 → 只重算它自己那棵子树，3.2ms/次
  //   · 直接写 backdrop-filter 内联样式 → 0ms
  // 三者视觉效果一样，所以选最便宜的那个。
  //
  // ⚠️ 只给**顶层**玻璃面写。后代写了也白写：父级一旦有 backdrop-filter 就建立了新的
  //    backdrop root，后代的 backdrop-filter 只能模糊到父级内部（实测 blur(40px) 依然清晰穿透）。
  // ⚠️ 不要往这个列表里加 .wb-home-page__main-content：它覆盖右半屏，一旦挂上
  //    backdrop-filter，整个视野的背部就糊成一片，壁纸失去细节（实测观感像"壁纸没加载"）。
  //    玻璃只加在**有边界的卡片**上 —— 侧边栏、输入框、设置面板。
  const GLASS_SURFACES = [SIDEBAR_SEL, ".cr-input-container"];
  // saturate 用 1.3、brightness 1.04、contrast 1.01 —— 这是 dsh-wallpaper-engine 实际写入的值
  // （不是它 CSS 里的兜底 1.8）。隔着玻璃看到的颜色比直接看更艳，这正是"液态"观感的来源。
  const GLASS_FILTER_TAIL = " saturate(1.3) brightness(1.04) contrast(1.01)";
  const applyGlassBlur = () => {
    const want = "blur(" + (tunables.glassBlur * 0.3).toFixed(2) + "px)" + GLASS_FILTER_TAIL;
    for (const selector of GLASS_SURFACES) {
      const el = document.querySelector(selector);
      if (el && el.style.backdropFilter !== want) el.style.backdropFilter = want;
    }
  };

  // 颜色类参数（遮罩浓度 / 玻璃通透 / 高光 / 描边）只能走 CSS 自定义属性 ——
  // 它们参与 color-mix 与 box-shadow 的计算，没法内联到某一个元素上。
  // 但写 html 变量会让整篇样式失效重算（实测 23ms/次），所以用 rAF 节流：
  // 一帧最多落一次，拖动中不会把主线程占满。外观调节本来就是精细操作，这个频率够用。
  let glassVarFrame = 0;
  const writeGlassVars = () => {
    glassVarFrame = 0;
    const root = document.documentElement;
    const setVar = (name, value) => {
      if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
    };
    setVar("--wb-glass-blur-px", (tunables.glassBlur * 0.3).toFixed(2) + "px");
    setVar("--wb-glass-tint", Math.round(tunables.glassTint) + "%");
    setVar("--wb-glass-sheen", (tunables.glassSheen * 0.0064).toFixed(3));
    setVar("--wb-glass-border", (tunables.glassBorder * 0.0032).toFixed(3));
    setVar("--wb-scrim-alpha", (tunables.scrim * 0.01).toFixed(3));
  };
  const scheduleGlassVars = () => {
    if (glassVarFrame) return;
    glassVarFrame = requestAnimationFrame(writeGlassVars);
  };

  const applyTunables = () => {
    // ① 壁纸模糊：内联 filter —— 唯一一个必须"零延迟跟手"的参数
    const blurPx = tunables.bgBlur * 0.3;
    if (bgLayer) {
      // 模糊≈0 时不挂 filter：blur(0px) 照样会建一层全屏合成层，白付显存。
      const wantFilter = blurPx >= 0.5 ? "blur(" + blurPx.toFixed(2) + "px)" : "";
      if (bgLayer.style.filter !== wantFilter) bgLayer.style.filter = wantFilter;
      // 图层随模糊量反向外扩：blur() 会在视口边缘采样到透明区，不外扩就露白边。
      const wantInset = blurPx >= 0.5 ? (-2 * blurPx).toFixed(2) + "px" : "0px";
      if (bgLayer.style.inset !== wantInset) bgLayer.style.inset = wantInset;
    }
    // ② 磨砂遮罩：内联背景色，同为 0ms
    if (weScrimEl) {
      const want = "rgba(6, 10, 18, " + (tunables.scrim * 0.01).toFixed(3) + ")";
      if (weScrimEl.style.background !== want) weScrimEl.style.background = want;
    }
    // ③ 玻璃模糊：内联 backdrop-filter，0ms
    applyGlassBlur();
    // ④ 其余颜色类参数：节流后落变量
    scheduleGlassVars();
  };
  reapplySidebarBlur = applyGlassBlur;

  // ---- 跨窗口同步（2026-10-04，用户实测报的 bug）----
  // 设置面板跑在**独立 renderer** 里（国内版和国际版都是，URL 带 windowAppId=settings），
  // 而 CSS 自定义属性是**每个文档各写一份**的：在设置窗口拖滑块，改的只是那个窗口的
  // html 变量，主窗口的侧边栏与输入框用的还是它自己那份旧值 —— 症状正是
  // "这些选项只在设置里看得到变化，主界面左侧不动"。
  // localStorage 是同 origin 共享的，所以用 storage 事件把它接回来：谁改了参数，
  // 另一个窗口重新读一遍并应用（背景层的内联 filter、玻璃面的内联 backdrop-filter
  // 都会跟着更新）。落盘发生在松手时，所以拖动过程中另一侧不跟手，抬手后立即一致 ——
  // 与面板里"数字标签松手才更新"是同一条取舍。
  window.addEventListener("storage", (event) => {
    if (!event || event.key !== TUNABLES_KEY) return;
    let next = null;
    try { next = JSON.parse(event.newValue ?? "null"); } catch (error) { return; }
    if (!next || typeof next !== "object") return;
    for (const spec of TUNABLE_SPEC) tunables[spec.key] = clampTunable(spec, next[spec.key]);
    applyTunables();
  });

  // ---- 自动调优：看当前壁纸一眼，把参数调到一组协调的值 ----
  // 依据是 dsh-wallpaper-engine（MIT）的两条实测口径，只是反过来用：
  //   · 它用 WCAG 相对亮度判定壁纸明暗，**阈值取 0.40 而不是中灰 0.2159** ——
  //     因为它实测本机壁纸亮度的中位数正好是 0.214，中灰阈值切在分布最密处，
  //     会把大量饱和的中间调判反。
  //   · 它有一层"可读性地板"（浅色 0.45 / 深色 0.59）保证玻璃再透也读得清字。
  // 我们据此反推：亮壁纸本来压不住文字，遮罩要给多、玻璃底要更实；
  // 暗壁纸自己就压得住，遮罩可以给少，而高光与描边反而要加 ——
  // 暗底上那两道白边才是"玻璃厚度"的来源，不给就成了一块脏玻璃。
  // 只调这四项。模糊与壁纸模糊属于风格偏好，不该被自动改掉。
  const SAMPLE_PX = 64;
  const srgbToLinear = (channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const relativeLuminance = (r, g, b) =>
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

  // 取当前壁纸的代表帧。三条来源按可靠性排序 —— 关键是**设置窗口里没有 bgLayer**
  // （子窗口不铺背景层），而"自动调优"按钮恰恰长在设置面板上，所以必须有回退：
  //   ① 主窗口：直接问背景层的计算样式要（最准，WE 静态贴图与内置主题 hero 都在这里）
  //   ② 任意窗口：从当前皮肤样式表的 url(...) 里抠出 hero（皮是同一套，图也是同一张）
  //   ③ 再退一步：当前 WE 条目的预览图
  // 三条都拿不到就返回 null，调用方据此提示"读不到壁纸"，绝不猜。
  const wallpaperSourceUrl = () => {
    if (bgLayer) {
      let bgImage = "";
      try { bgImage = getComputedStyle(bgLayer).backgroundImage || ""; } catch (error) { bgImage = ""; }
      const urls = [];
      const re = /url\((?:"|')?([^"')]+)(?:"|')?\)/g;
      let hit = re.exec(bgImage);
      while (hit) { urls.push(hit[1]); hit = re.exec(bgImage); }
      const src = urls.length ? urls[urls.length - 1] : "";
      // 1×1 透明 GIF 是"没有 hero"的占位，不能拿去采样
      if (src && src.indexOf("data:image/gif") !== 0) return src;
    }
    const styleEl = document.getElementById(data.styleId);
    if (styleEl && typeof styleEl.textContent === "string" && styleEl.textContent) {
      const m = /url\((?:"|')?(data:image\/[^"')]+|file:[^"')]+)(?:"|')?\)/.exec(styleEl.textContent);
      if (m && m[1].indexOf("data:image/gif") !== 0) return m[1];
    }
    if (weActiveId !== null) {
      const item = weItems.find((candidate) => candidate.id === weActiveId);
      if (item) return item.heroUrl || item.previewUrl || null;
    }
    return null;
  };

  const loadImage = (src) => new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    } catch (error) {
      resolve(null);
    }
  });

  // 画面占比最大色：缩到 64×64，按 4bit/通道（4096 桶）量化后取众数桶，返回桶中心。
  // 用众数而不是平均色 —— 平均色会被大片纯背景稀释成"哪张壁纸都差不多"的灰，
  // 而众数更接近人眼认的那个主色。同票取 key 小的，保证同一张图每次结论一致。
  // 顺带把整幅的平均亮度算出来（判定明暗用）。
  const analyzeWallpaper = async () => {
    const src = wallpaperSourceUrl();
    if (!src) return null;
    const img = await loadImage(src);
    if (!img || !img.width || !img.height) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_PX;
      canvas.height = SAMPLE_PX;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, SAMPLE_PX, SAMPLE_PX);
      const data = ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data;
      const buckets = new Map();
      let lumSum = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;   // 透明区域不是画面
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        lumSum += relativeLuminance(r, g, b);
        count += 1;
        const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
      if (!count) return null;
      let topKey = -1;
      let topCount = -1;
      for (const entry of buckets) {
        const key = entry[0];
        const n = entry[1];
        if (n > topCount || (n === topCount && (topKey < 0 || key < topKey))) { topKey = key; topCount = n; }
      }
      return {
        lum: lumSum / count,
        top: {
          r: ((topKey >> 8) & 15) * 16 + 8,
          g: ((topKey >> 4) & 15) * 16 + 8,
          b: (topKey & 15) * 16 + 8,
        },
      };
    } catch (error) {
      // 跨源污染 / 解码失败 / getImageData 被拒 —— 一律当作"拿不到"，绝不抛给调用方
      return null;
    }
  };

  /**
   * 按当前壁纸算一组参数并应用。
   * @returns {Promise<{lum:number, applied:object}|null>} 拿不到画面时返回 null（调用方据此提示）
   */
  const autoTuneFromWallpaper = async () => {
    const sample = await analyzeWallpaper();
    if (!sample) return null;
    const lum = Math.max(0, Math.min(1, sample.lum));
    const pct = (n) => Math.max(0, Math.min(100, Math.round(n)));
    const next = {
      // 亮壁纸压不住字 → 遮罩给多；暗壁纸自己就压得住 → 给少
      scrim: pct(8 + lum * 42),
      // 玻璃底同理：亮底要更实，暗底可以更透
      glassTint: pct(34 + lum * 22),
      // 高光与描边反过来：暗底上那两道白边才看得出来
      glassSheen: pct(30 + (1 - lum) * 40),
      glassBorder: pct(20 + (1 - lum) * 34),
    };
    for (const spec of TUNABLE_SPEC) {
      if (next[spec.key] === undefined) continue;
      tunables[spec.key] = clampTunable(spec, next[spec.key]);
    }
    writeTunables();
    applyTunables();
    return { lum, applied: next };
  };

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

    // 磨砂遮罩：压在壁纸之上、内容之下的一层。挂成 bgLayer 的子元素，
    // 所以它天然落在 z-index:-1 这一层里，不需要额外调层级（内容照旧压在上面）。
    // 它的职责不是"挡住壁纸"，而是把壁纸对比度压下来保证文字可读 ——
    // 所以默认值刻意给低（0.25），压太黑玻璃就透不出壁纸的颜色了。
    weScrimEl = document.createElement("div");
    weScrimEl.dataset.wbWeScrim = "1";
    bgLayer.appendChild(weScrimEl);
  }

  // 擦掉早期版本留在**原生元素**上的内联 backdrop-filter。
  // 背景：重新注入只会重建我们自己创建的节点，原生元素上的内联样式会原地留着；
  // 而 GLASS_SURFACES 已经不再包含这些选择器，于是没有谁去覆盖它 ——
  // 结果是"改了代码却没效果"（实测：整片内容区一直被 blur(9.9px) 糊着，
  // 看着像壁纸糊了，其实是上一版写下的残留）。
  for (const staleSelector of [".wb-home-page__main-content"]) {
    const stale = document.querySelector(staleSelector);
    if (stale && stale.style.backdropFilter) stale.style.backdropFilter = "";
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
  // 外部状态文档里的当前皮肤（Node 侧维护的镜像，见 src/active-state.mjs）。
  // ⚠️ 它排在 LAST_KEY **之后**，不抢权威：用户是在这个页面里换皮肤的，
  //    localStorage 永远比镜像新。它只在本地记录不存在或已失效时兜底
  //    （清过缓存、跨会话新开的第一个窗口、以及守护在新文档里注入的场合）。
  //    WE 主题（we-xxx）不在 data.themes 里，判定要单独放行，和 LAST_KEY 一致。
  const hintValue = typeof data.activeHint === "string" && data.activeHint !== "" ? data.activeHint : null;
  const hintOk = hintValue !== null && (hintValue.indexOf("we-") === 0 || canApplyTheme(hintValue));
  const preferred = data.restoreLast ? ((bootOk ? bootRaw : null) ?? (readLastTheme() ?? (hintOk ? hintValue : null) ?? currentSkin)) : null;
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

