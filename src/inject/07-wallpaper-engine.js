  // ==================== Wallpaper Engine 壁纸（方案 A：file:// 直读）====================
  // 可行性结论见 docs/WE-INTEGRATION.md。要点：
  //   · 渲染进程本身就是 file:// 页面，可以直接 <video src="file:///..."> 播本机文件（已实测）
  //     → 零字节拷贝、零存储、零 payload 膨胀，不碰 localStorage 配额
  //   · 只传路径，绝不把媒体打进仓库（创意工坊内容版权归作者）
  //   · ⚠️ 这些主题**只在本机有效**，不可分享（面板上必须标注）
  //
  // scene（场景）壁纸不走 <video>：它是 WE 引擎解释的 scene.pkg。这一版把静态贴图路线
  // 升级成"渐进增强"——静态 4K 贴图（或预览图）先铺上，WebWallGL 在后台解析 pkg、
  // 出首帧后再淡入顶替。见本文件下方 WebWallGL 段与 docs 的集成方案。
  const WE_THEME_KEY = "anonbuddySkinWeTheme";
  const WE_PAUSED_KEY = "anonbuddySkinWePaused";
  const WE_FALLBACK_COLORS = { accent: "#24c9d7", secondary: "#ef8fd3", surface: "#f7fbff", text: "#17344f" };
  // 1×1 透明 GIF：视频条目没有预览图时给 CSS 占位（视频会盖在上面）
  const WE_BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const weItems = Array.isArray(data.weItems) ? data.weItems : [];
  const weThemeId = (item) => "we-" + item.id;

  // ---- 降级链第四档：主题取色渐变（永不为黑）----
  // 前三档都可能落空：没跑过 we-extract、工坊缩略图本身缺失、路径失效。
  // 这一档纯本地取色，不依赖任何文件 —— 只要换了主题，背景就一定有内容。
  // 它只在**没有静态图**时出现：它是 bgLayer 的子元素，会盖住父层的 background-image。
  let weGradientEl = null;
  const applyWeGradient = (colors, needed) => {
    if (!bgLayer) return;
    if (!needed) {
      if (weGradientEl) { try { weGradientEl.remove(); } catch (error) {} weGradientEl = null; }
      return;
    }
    if (!weGradientEl) {
      weGradientEl = document.createElement("div");
      weGradientEl.dataset.wbWeGradient = "1";
      weGradientEl.style.cssText = "position:absolute;inset:0;";
      bgLayer.appendChild(weGradientEl);
    }
    weGradientEl.style.background =
      "linear-gradient(135deg, " + colors.accent + " 0%, " + colors.secondary + " 52%, " + colors.surface + " 100%)";
  };

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
    syncWwglVolume();
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

  // ==================== WebWallGL：scene 壁纸真渲染（渐进增强）====================
  // 设计原则：**静态贴图先上，渲染好了淡入顶替**。任何一步失败都静默留在静态图/渐变上，
  // 用户不该知道背后发生了什么 —— 真渲染因此是一个可以随时安全放弃的"锦上添花"。
  //
  // 库走 vendored 副本（vendor/webwallgl/，950KB），运行时按需 <script src> 加载：
  // 不内联进注入脚本（每次 apply 推 950KB 过 CDP 不可接受），而且只有真用 scene 壁纸的
  // 用户才付这份成本。上游版本、哈希、以及"为什么锁 1.4.2 而不是 2.0.2"记在
  // vendor/webwallgl/.upstream.json 里。
  const wwglUrl = typeof data.wwglUrl === "string" && data.wwglUrl ? data.wwglUrl : null;
  // mount 只在**首帧真画出来之后**才 resolve，而窗口被隐藏时浏览器不跑 rAF
  // （最小化 / 收进托盘），首帧永远不来 —— 没有超时就会一直挂着。
  // 取值是"最慢实测（复杂场景叠加皮肤负载 9.1s）× 数倍余量"，给慢机器和大包留够空间。
  const WE_WWGL_MOUNT_TIMEOUT_MS = 60000;
  let wwglLib = null;         // 库命名空间（只加载一次，之后所有 scene 复用）
  let wwglLoading = null;     // 加载去重：连点几个 scene 不会重复插 <script>
  let wwglInstance = null;    // 当前渲染实例
  let wwglHolder = null;      // 承载 canvas 的容器
  let wwglRenderId = null;    // 当前实例对应的 WE 条目 id
  let wwglGeneration = 0;     // 世代号：每次释放自增，在飞的 renderScene 据此早退

  const loadWebWallGL = () => {
    if (wwglLib) return Promise.resolve(wwglLib);
    if (wwglLoading) return wwglLoading;
    if (!wwglUrl) return Promise.reject(new Error("没有 WebWallGL 地址"));
    wwglLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.dataset.wbWwgl = "1";
      script.src = wwglUrl;
      script.onload = () => {
        if (window.WebWallGL) { wwglLib = window.WebWallGL; resolve(wwglLib); }
        else reject(new Error("WebWallGL 未挂到 window"));
      };
      script.onerror = () => reject(new Error("库加载失败"));
      document.head.appendChild(script);
    }).catch((error) => { wwglLoading = null; throw error; });
    return wwglLoading;
  };

  // 幂等释放：作废世代号 → destroy 实例 → 移除容器。
  // destroy() 是唯一会停掉渲染循环并释放 WebGL 上下文的动作（浏览器同页上下文数量有限），
  // 漏掉它 = 漏上下文 + 叠渲染循环，这是本项目的幂等红线（视频壁纸那轮踩过）。
  const releaseWebWallGL = () => {
    wwglGeneration += 1;
    wwglRenderId = null;
    if (wwglInstance) {
      try { wwglInstance.destroy(); } catch (error) {}
      wwglInstance = null;
    }
    if (wwglHolder) {
      try { wwglHolder.remove(); } catch (error) {}
      wwglHolder = null;
    }
    // 实例没了 → 暂停键也该跟着消失（按钮只在**真有东西可暂停**时出现）
    try { syncWeButtons(); } catch (error) {}
    return wwglGeneration;
  };

  // 暂停/恢复走实例 API，**绝不 destroy 重建**：重建要重新解析 pkg（复杂场景实测 9 秒起）
  const syncWwglPlayback = () => {
    if (!wwglInstance) return;
    try {
      if (wePaused) wwglInstance.pause();
      else wwglInstance.resume();
    } catch (error) {}
  };

  // 音量：scene 自带音频（场景内 BGM / 音频响应），静音开关未开时给 0
  const syncWwglVolume = () => {
    if (!wwglInstance) return;
    try {
      wwglInstance.setVolume(weSound ? Math.min(1, Math.max(0, weVolume / 100)) : 0);
    } catch (error) {}
  };

  // 渲染一个 scene。**不要 await 它**：调用方（setBackgroundMedia）必须立刻返回。
  const renderScene = async (item) => {
    if (!wwglUrl || !item || !item.pkgUrl || !bgLayer) return;
    const myId = item.id;
    const myGeneration = releaseWebWallGL();
    let holder = null;
    // 每个 await 之后都要重新比对：用户可能已经切走（甚至切了两次）。
    // 少了这道闸，快速连点几个壁纸时多个 mount 会并发挂上同一个图层。
    const stale = () => myGeneration !== wwglGeneration || weActiveId !== myId;
    try {
      const lib = await loadWebWallGL();
      if (stale()) return;

      holder = document.createElement("div");
      holder.dataset.wbWeScene = "1";
      // opacity 从 0 起步：此刻静态 4K 贴图正在显示，canvas 先隐形，首帧出来才淡入
      holder.style.cssText = "position:absolute;inset:0;opacity:0;transition:opacity .45s ease;pointer-events:none;";
      bgLayer.appendChild(holder);
      wwglHolder = holder;

      // file:// 直读：渲染进程本身就是 file:// 页面（这条路径视频壁纸已验证过），零拷贝。
      // key 参与库内解析缓存（切回同一场景不再重解析），所以用稳定的条目 id 拼。
      const bytes = await (await fetch(item.pkgUrl)).arrayBuffer();
      if (stale()) { try { holder.remove(); } catch (error) {} if (wwglHolder === holder) wwglHolder = null; return; }

      let timeoutId = 0;
      const mounting = lib.mount(holder, {
        source: lib.bytesSource(bytes, null, "anonbuddy-we-" + myId),
        fps: 30,   // 场景多是慢速动效，30fps 观感损失很小，GPU 直接省一半
        volume: weSound ? Math.min(1, Math.max(0, weVolume / 100)) : 0,
        autoplay: !wePaused,
      });
      let wp = null;
      try {
        wp = await Promise.race([
          mounting,
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("mount 超时 " + WE_WWGL_MOUNT_TIMEOUT_MS + "ms")),
              WE_WWGL_MOUNT_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (error) {
        // 超时那条路：在飞的 mount 稍后仍可能成功，而那时它**没人接管** ——
        // 必须自己接住并销毁，否则它会在容器上一直渲染（漏 WebGL 上下文，幂等红线）。
        //
        // ⚠️ 这个兜底**只能注册在超时分支里**。挂在 race 外侧的话，正常返回的实例也会被它
        //    销毁：先注册的 .then 回调排在 await 续体**之前**，那一刻 wwglInstance 还没赋值，
        //    所以"late !== wwglInstance"恒成立 → 刚 mount 好的实例被立刻 destroy()。
        //    症状极具迷惑性：mount 正常 resolve、日志打「渲染就绪」、canvas 尺寸也对，
        //    但 info 永远是 null、stats.fps 恒为 0（实测在 1.0.5 实测阶段抓到这个）。
        mounting.then((late) => { try { late.destroy(); } catch (innerError) {} }).catch(() => {});
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
      // mount 完成期间又被切走：立刻销毁，不留泄漏
      if (stale()) { try { wp.destroy(); } catch (error) {} return; }

      wwglInstance = wp;
      wwglRenderId = myId;
      // 首帧已出 → 淡入，静态图被顶替。用户只看到"更顺滑了"，看不到切换过程。
      requestAnimationFrame(() => { if (holder) holder.style.opacity = "1"; });
      syncWeButtons();
      console.log("[anonbuddy] scene 渲染就绪", myId, JSON.stringify(wp.info));
    } catch (error) {
      // 静默降级：静态图（或渐变兜底）还在，用户无感
      console.warn("[anonbuddy] scene 渲染失败，保持静态贴图", item.id, error && error.message);
      try { if (holder) holder.remove(); } catch (innerError) {}
      if (wwglHolder === holder) wwglHolder = null;
    }
  };

  // 把媒体挂进背景图层。
  //   · video：<video> 顶上去（原逻辑）
  //   · scene：静态贴图已由 CSS hero 槽位顶上，这里**异步**升级成 WebWallGL 真渲染
  //   · 其余：只需清掉旧的视频/GL —— 图走 CSS 的 hero 槽位
  const setBackgroundMedia = (item) => {
    releaseBgVideo();
    releaseWebWallGL();     // 先收掉上一轮的 GL：反复换壁纸不能叠渲染循环（幂等红线）
    if (!bgLayer || !item) return;
    if (item.kind === "video") {
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
      return;
    }
    // ⚠️ 不 await renderScene：换肤必须立刻返回，慢的部分由静态图遮着在后台跑
    if (item.rawType === "scene" && item.pkgUrl) renderScene(item);
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
    syncWwglPlayback();
    syncWeButtons();
  };

  const applyWeTheme = async (item) => {
    const id = weThemeId(item);
    // 降级链（自上而下）：① WebWallGL 实时渲染 ② 解出来的静态 4K 贴图 ③ 工坊预览图
    // ④ 主题取色渐变兜底。前三档都可能拿不到，第四档保证用户看到的绝不是黑屏。
    const heroSource = item.heroUrl || item.previewUrl || null;
    const colors = await paletteFromUrl(heroSource);
    const hero = heroSource || WE_BLANK;
    skinOwned = true;
    style.textContent = buildCustomCss(hero, colors, id);
    document.documentElement.dataset.anonbuddySkin = id;
    applyMode(colors.surface);
    applyWeGradient(colors, !heroSource);
    // ⚠️ weActiveId 必须在 setBackgroundMedia 之前落好：renderScene 靠它做"是否已被切走"
    //    的世代校验，晚一步就会把自己误判成过期请求而放弃渲染。
    weActiveId = item.id;
    setBackgroundMedia(item);
    writeWeTheme(item.id);
    paint(id);
    writeLastTheme(id);
    syncWeList();
    syncWeButtons();
    syncWeUi();
  };


  // 离开 WE 主题（切到普通主题 / 选原生）时必须收掉视频、GL 与状态，
  // 否则视频会在后台一直解码，而 GL 会连着渲染循环一起活着（幂等红线）
  const leaveWeTheme = () => {
    releaseBgVideo();
    releaseWebWallGL();
    if (weGradientEl) { try { weGradientEl.remove(); } catch (error) {} weGradientEl = null; }
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
    const active = weActiveId === null ? null : weItems.find((x) => x.id === weActiveId);
    // 按钮只在**真有东西可暂停**时出现：视频有 <video>，scene 要有已就绪的 GL 实例。
    // 不用"这个条目理论上能渲染"来预判 —— 引擎没就绪时按了没反应，那不叫可用；
    // 而且 mount 还没 resolve 时按钮就出现，会让人以为壁纸是"静态图播放失败"。
    const sceneReady = Boolean(wwglInstance && wwglRenderId === weActiveId);
    const playable = Boolean(active && (active.kind === "video" || sceneReady));
    weToggleBtn.style.display = playable ? "block" : "none";
    weToggleBtn.textContent = wePaused ? "\u25b6" : "\u23f8";
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

  const NATIVE_LABEL = "\u539f\u751f\u754c\u9762";
  const native = row(displayName(null, NATIVE_LABEL), "rgba(0,0,0,.24)", () => { clearTheme(); panel.style.display = "none"; }, { id: null, renamable: true, defaultLabel: NATIVE_LABEL });
  rows.set(null, native);

