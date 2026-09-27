  // ---- 自定义图片：本地选图 -> 压缩 -> 取色 -> 生成 CSS -> 持久化 ----
  // 多主题：每个上传的图片都是独立条目，存成一个数组，互不覆盖。
  const buildCustomCss = (dataUrl, colors, id) => data.cssTemplate
    .split(data.sentinels.hero).join(dataUrl)
    .split(data.sentinels.accent).join(colors.accent)
    .split(data.sentinels.secondary).join(colors.secondary)
    .split(data.sentinels.surface).join(colors.surface)
    .split(data.sentinels.text).join(colors.text)
    .split(data.sentinels.id).join(id);

  const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  const extractPalette = (canvas) => {
    const ctx = canvas.getContext("2d");
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map();
    let lumSum = 0, count = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum; count += 1;
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.18 || lum < 24 || lum > 245) continue;   // 灰、过暗、过曝不参与取主色
      const d = max - min || 1;
      let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const bucket = Math.round(h) % 6 * 2 + (sat > 0.55 ? 1 : 0);
      const entry = buckets.get(bucket) ?? { w: 0, r: 0, g: 0, b: 0, h: h * 60 };
      const weight = sat * sat;
      entry.w += weight; entry.r += r * weight; entry.g += g * weight; entry.b += b * weight;
      buckets.set(bucket, entry);
    }
    const avgLum = count ? lumSum / count : 128;
    const ranked = [...buckets.values()].sort((a, b2) => b2.w - a.w)
      .map((e) => ({ rgb: [e.r / e.w, e.g / e.w, e.b / e.w], h: e.h, w: e.w }));
    const accent = ranked[0]?.rgb ?? [36, 201, 215];
    const second = ranked.find((e) => Math.abs(e.h - (ranked[0]?.h ?? 0)) > 50)?.rgb
      ?? mix(accent, [255, 255, 255], 0.35);
    const light = avgLum > 128;
    const surface = light ? mix(accent, [252, 252, 255], 0.92) : mix(accent, [12, 12, 18], 0.86);
    const text = light ? mix(accent, [16, 24, 40], 0.82) : mix(accent, [244, 246, 252], 0.85);
    return {
      accent: hex(...accent),
      secondary: hex(...second),
      surface: hex(...surface),
      text: hex(...text),
    };
  };

  // 每个上传的图片是一条独立记录：{ id, name, dataUrl, colors }，存成数组，互不覆盖。
  const customThemes = [];
  const customRows = new Map();

  const newCustomId = () => "custom-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const normalizeCustom = (raw, fallbackId) => {
    if (!raw || typeof raw.dataUrl !== "string" || !raw.colors) return null;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : (fallbackId ?? newCustomId()),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "\u6211\u7684\u56fe\u7247",
      dataUrl: raw.dataUrl,
      colors: raw.colors,
    };
  };

  const writeCustomThemes = () => {
    try { localStorage.setItem(data.customListKey, JSON.stringify(customThemes)); return true; }
    catch (error) {
      console.warn("WorkBuddy Skin：自定义主题已占满 localStorage 配额，本次生效但重启后不保留；可在右键菜单里删掉几张旧图", error);
      return false;
    }
  };

  // 读取历史自定义主题；旧版只存了单个（键 workbuddyCustomTheme），首次运行自动迁移进数组
  const readCustomThemes = () => {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(data.customListKey) ?? "null"); } catch {}
    if (Array.isArray(stored)) return stored.map((raw) => normalizeCustom(raw)).filter(Boolean);
    try {
      const legacy = JSON.parse(localStorage.getItem(data.storageKey) ?? "null");
      const migrated = normalizeCustom(legacy ? { ...legacy, id: data.customId } : null);
      if (migrated) {
        try {
          localStorage.setItem(data.customListKey, JSON.stringify([migrated]));
          localStorage.removeItem(data.storageKey);
        } catch {}
        return [migrated];
      }
    } catch {}
    return [];
  };

  const applyCustomTheme = (theme) => {
    onLeaveWeTheme();
    skinOwned = true;
    style.textContent = buildCustomCss(theme.dataUrl, theme.colors, theme.id);
    document.documentElement.dataset.anonbuddySkin = theme.id;
    applyMode(theme.colors.surface);
    paint(theme.id);
    writeLastTheme(theme.id);
  };

  const renderCustomRow = (theme) => {
    const item = row(displayName(theme.id, theme.name), theme.colors.accent, () => { applyCustomTheme(theme); panel.style.display = "none"; }, {
      before: uploadRow,
      id: theme.id,
      renamable: true,
      defaultLabel: theme.name,
      menuHint: "\uff08\u53f3\u952e\uff1a\u91cd\u547d\u540d / \u5220\u9664\uff09",
    });
    customRows.set(theme.id, item);
    rows.set(theme.id, item);
    return item;
  };

  const deleteCustomTheme = (id) => {
    const index = customThemes.findIndex((candidate) => candidate.id === id);
    if (index === -1) return false;
    customThemes.splice(index, 1);
    writeCustomThemes();
    customRows.get(id)?.remove();
    customRows.delete(id);
    rows.delete(id);
    const key = aliasKeyOf(id);
    if (key in aliases) { delete aliases[key]; writeAliases(); }
    if (document.documentElement.dataset.anonbuddySkin === id) clearTheme();
    return true;
  };

  const importFromDataUrl = (dataUrl, name) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.width);
      const full = document.createElement("canvas");
      full.width = Math.round(img.width * scale);
      full.height = Math.round(img.height * scale);
      full.getContext("2d").drawImage(img, 0, 0, full.width, full.height);
      const sample = document.createElement("canvas");
      sample.width = 48; sample.height = Math.max(1, Math.round(48 * img.height / img.width));
      sample.getContext("2d").drawImage(img, 0, 0, sample.width, sample.height);
      const theme = {
        id: newCustomId(),
        name: name || "\u6211\u7684\u56fe\u7247",
        dataUrl: full.toDataURL("image/webp", 0.8),
        colors: extractPalette(sample),
      };
      customThemes.push(theme);
      writeCustomThemes();
      renderCustomRow(theme);
      applyCustomTheme(theme);
      resolve(theme.colors);
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = dataUrl;
  });

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/png,image/jpeg,image/webp";
  picker.style.display = "none";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importFromDataUrl(reader.result, file.name.replace(/\.[a-z0-9]+$/i, ""));
    reader.readAsDataURL(file);
    picker.value = "";
    panel.style.display = "none";
  });

  const uploadRow = row("\uff0b \u81ea\u5b9a\u4e49\u56fe\u7247", "rgba(36,201,215,.9)", () => picker.click());
  uploadRow.style.borderTop = "1px solid rgba(0,0,0,.08)";

