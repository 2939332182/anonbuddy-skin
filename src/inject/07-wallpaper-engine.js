  // ==================== Wallpaper Engine 壁纸（方案 A：file:// 直读）====================
  // 可行性结论见 docs/WE-INTEGRATION.md。要点：
  //   · 渲染进程本身就是 file:// 页面，可以直接 <video src="file:///..."> 播本机文件（已实测）
  //     → 零字节拷贝、零存储、零 payload 膨胀，不碰 localStorage 配额
  //   · 只传路径，绝不把媒体打进仓库（创意工坊内容版权归作者）
  //   · ⚠️ 这些主题**只在本机有效**，不可分享（面板上必须标注）
  const WE_THEME_KEY = "anonbuddySkinWeTheme";
  const WE_PAUSED_KEY = "anonbuddySkinWePaused";
  const WE_FALLBACK_COLORS = { accent: "#24c9d7", secondary: "#ef8fd3", surface: "#f7fbff", text: "#17344f" };
  // 1×1 透明 GIF：视频条目没有预览图时给 CSS 占位（视频会盖在上面）
  const WE_BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const weItems = Array.isArray(data.weItems) ? data.weItems : [];
  const weThemeId = (item) => "we-" + item.id;
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

  // 把视频挂进背景图层。非视频条目（静态预览）只需清掉旧视频 —— 图走 CSS 的 hero 槽位。
  const setBackgroundMedia = (item) => {
    releaseBgVideo();
    if (!bgLayer || !item || item.kind !== "video") return;
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
    syncWeButtons();
  };

  const applyWeTheme = async (item) => {
    const id = weThemeId(item);
    // hero 优先用 RePKG 解出来的原始贴图（通常 4K），没有才退回创意工坊缩略图（1K）
    const heroSource = item.heroUrl || item.previewUrl || null;
    const colors = await paletteFromUrl(heroSource);
    const hero = heroSource || WE_BLANK;
    skinOwned = true;
    style.textContent = buildCustomCss(hero, colors, id);
    document.documentElement.dataset.anonbuddySkin = id;
    applyMode(colors.surface);
    setBackgroundMedia(item);
    weActiveId = item.id;
    writeWeTheme(item.id);
    paint(id);
    writeLastTheme(id);
    syncWeList();
    syncWeButtons();
    syncWeUi();
  };


  // 离开 WE 主题（切到普通主题 / 选原生）时必须收掉视频与状态，否则视频会在后台一直解码
  const leaveWeTheme = () => {
    releaseBgVideo();
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
    const isVideoWe = weActiveId !== null && (weItems.find((x) => x.id === weActiveId)?.kind === "video");
    weToggleBtn.style.display = isVideoWe ? "block" : "none";
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

