  // ==================== 设置面板集成 ====================
  // 在 WorkBuddy 设置面板（.settings-modal-overlay）左侧「功能」分组里插一个
  // 「ChihayaAnon 插件」条目，点它时右侧内容区换成我们的面板。
  //
  // 为什么用 MutationObserver 而不是直接在导航栏上插：
  //   设置面板是 React 渲染的，每次打开 / 切换 tab 都会重建整个 .settings-navigation，
  //   我们插进去的按钮会被一起回收。只能守着导航栏，出现就补。
  //
  // 内容区不能真的"接管"右上角面板（那需要 React 路由），做法是：
  //   原生 .settings-modal__panel 保留，我们只在它上面盖一层自己的面板并切换显隐。
  //   切到别的 tab 时（原生面板内容变了）自动把自己收起来。

  const pluginEntryId = data.menuId + "-settings-entry";
  const pluginPaneId = data.menuId + "-settings-pane";
  let settingsPane = null;      // 右侧我们的面板
  let pluginEntry = null;       // 左侧导航条目
  let pluginEntryActive = false;

  // 面板配色必须跟着「设置弹窗自身的底色」走，而不是跟着皮肤主题走。
  // 踩过的坑：设置弹窗是 WorkBuddy 原生的白色/深色实底，皮肤并没有把它染色
  // （皮肤只覆盖主页视图，弹窗保持原生）。如果按皮肤主题取色，选中深色皮肤时
  // 会把文字设成浅色 —— 白色弹窗上就成了白字白底，整个面板"看起来是空的"。
  // 所以这里直接读内容区的实际计算背景色来判断深浅。
  // 注意：这段代码整体在模板字符串里，正则里的反斜杠会被模板字面量吃掉一层，
  // 所以字面量要写成双反斜杠（同文件 file.name.replace 那处的做法）。
  // 设置弹窗根容器解析：按候选列表逐个试，不依赖单一类名，也不依赖任何顺序。
  // 旧版（5.5.x）：设置是主窗口内的弹层，根是 .settings-modal-overlay。
  // 新版（5.6.x）：设置跑在独立 renderer 窗口里，没有 overlay 包装，根是 .settings-modal--window。
  // 两者内层结构一致，所以只需要在这里吸掉差异。
  const resolveSettingsRoot = () => {
    for (const selector of data.settingsRootSelectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  const paneSurface = () => {
    const root = resolveSettingsRoot();
    const content = root?.querySelector(".settings-modal__content") ?? root;
    const bg = content ? getComputedStyle(content).backgroundColor : "";
    const m = /rgba?\(([0-9]+), ([0-9]+), ([0-9]+)/.exec(bg || "");
    if (m) return "#" + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, "0")).join("");
    return "#f7f7f7";
  };

  const currentThemeId = () => document.documentElement.dataset.anonbuddySkin ?? null;

  // 面板行：和悬浮菜单的 row 同源（复用 row()），只是容器不同、点击后不关面板
  const paneRow = (label, dotColor, onPick, options = {}) => row(label, dotColor, onPick, options);

  const buildSettingsPane = () => {
    const pane = document.createElement("div");
    pane.id = pluginPaneId;
    pane.dataset.wbPluginPane = "1";
    pane.style.cssText = "display:none;flex-direction:column;height:100%;overflow:hidden;font:400 14px/1.5 system-ui;color:var(--wb-pane-text,#1a1a1a);";

    // 头部：和原生 settings-modal__header 对齐
    const header = document.createElement("div");
    header.textContent = data.pluginName;
    header.style.cssText = "flex:none;padding:16px 0 12px;font:600 16px/1.4 system-ui;";
    pane.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 2px 24px;";

    // ---- 分组 1：皮肤列表 ----
    // 行的主题 id 存在 data-wb-theme-id 上，null（原生界面）编码成 "native"：
    // dataset 会把 null 序列化成字符串 "null"，不能直接存原值。
    const encodeRowId = (id) => (id === null ? "native" : String(id));
    const decodeRowId = (raw) => (raw === "native" ? null : raw);
    const listGroup = document.createElement("div");
    listGroup.style.cssText = "margin-bottom:18px;";
    const listLabel = document.createElement("p");
    listLabel.textContent = "皮肤";
    listLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    // 皮肤列表：三列网格（2026-09-20 由单列改为网格）。
    // 原先每行占满整宽、右侧大片留白，主题一多列表就拉得很长；改成 3 列后
    // 9 个主题正好 3×3，列表高度约减半，横向空间也用满了。
    // ⚠️ 用「gap + 每格独立边框」而不是「1px gap 借容器底色当分隔线」：
    //    深色下 --wb-pane-card 是 rgba(255,255,255,.06) 半透明，
    //    容器底色会透上来，hairline 分隔线那套会直接失效。
    const listCard = document.createElement("div");
    listCard.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:6px;border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));background:var(--wb-pane-card,#fff);";
    listGroup.append(listLabel, listCard);

    // 原生界面行 + 全部内置主题 + 全部自定义主题
    const paneRows = new Map();
    const renderList = () => {
      listCard.textContent = "";
      paneRows.clear();
      const mk = (label, dotColor, onPick, options) => {
        const item = paneRow(label, dotColor, onPick, {
          ...options,
          container: listCard,
          hoverBg: "var(--wb-pane-hover,rgba(0,0,0,.04))",
          // 离开时重算整列选中态：网格里每格是独立卡片，不能靠 paint() 擦掉悬停底
          onLeave: () => syncPaneSelection(),
        });
        // 网格单元格：自带圆角与边框（不再是"整块卡片 + 行间分隔线"）
        item.style.padding = "8px 10px";
        item.style.borderRadius = "8px";
        item.style.border = "1px solid var(--wb-pane-border,rgba(0,0,0,.06))";
        // 名字在窄格子里要能吃满剩余宽度，否则截断得太早
        item.__text.style.maxWidth = "none";
        paneRows.set(options?.id ?? null, item);
        markRow(item, options?.id ?? null);
        return item;
      };
      mk(displayName(null, NATIVE_LABEL), "rgba(0,0,0,.24)", () => { clearTheme(); syncPaneSelection(); }, { id: null, renamable: true, defaultLabel: NATIVE_LABEL, menuHint: "\uff08\u53f3\u952e\u91cd\u547d\u540d\uff09" });
      for (const theme of data.themes) {
        mk(displayName(theme.id, theme.name), theme.accent, () => { setTheme(theme.id); syncPaneSelection(); }, { id: theme.id, renamable: true, defaultLabel: theme.name });
      }
      for (const theme of customThemes) {
        mk(displayName(theme.id, theme.name), theme.colors.accent, () => { applyCustomTheme(theme); syncPaneSelection(); }, { id: theme.id, renamable: true, defaultLabel: theme.name, menuHint: "\uff08\u53f3\u952e\uff1a\u91cd\u547d\u540d / \u5220\u9664\uff09" });
      }
      syncPaneSelection();
    };

    // 当前选中：底色 + 打勾
    let selectionMark = null;
    const markRow = (item, id) => {
      item.dataset.wbThemeId = encodeRowId(id);
      const check = document.createElement("span");
      check.textContent = "\u2713";
      check.style.cssText = "flex:none;width:16px;text-align:center;opacity:0;color:var(--wb-pane-accent,#24c9d7);font-weight:700;";
      item.appendChild(check);
      item.__check = check;
    };
    const syncPaneSelection = () => {
      const active = currentThemeId();
      for (const [id, item] of paneRows) {
        const on = id === active;
        if (item.__check) item.__check.style.opacity = on ? "1" : "0";
        item.style.background = on ? "var(--wb-pane-active,rgba(36,201,215,.12))" : "transparent";
        // 网格里每格是独立卡片，选中态再给一道强调色描边，比只靠一个 ✓ 更醒目
        item.style.borderColor = on
          ? "var(--wb-pane-accent,rgba(36,201,215,.6))"
          : "var(--wb-pane-border,rgba(0,0,0,.06))";
      }
      // 悬浮菜单的选中态也同步一下
      paint(active);
    };

    // ---- 分组 2：添加皮肤 ----
    const addGroup = document.createElement("div");
    addGroup.style.cssText = "margin-bottom:18px;";
    const addLabel = document.createElement("p");
    addLabel.textContent = "添加";
    addLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    const addCard = document.createElement("div");
    addCard.style.cssText = "border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));overflow:hidden;background:var(--wb-pane-card,#fff);";
    const addRow = document.createElement("div");
    addRow.setAttribute("role", "button");
    addRow.tabIndex = 0;
    addRow.style.cssText = "display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;";
    const addPlus = document.createElement("span");
    addPlus.textContent = "\uff0b";
    addPlus.style.cssText = "flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--wb-pane-active,rgba(36,201,215,.12));color:var(--wb-pane-accent,#0e8fa0);font-weight:700;";
    const addText = document.createElement("span");
    addText.textContent = "上传图片作为新皮肤";
    addText.style.cssText = "flex:1;min-width:0;";
    const addHint = document.createElement("span");
    addHint.textContent = "PNG / JPG / WebP";
    addHint.style.cssText = "flex:none;font-size:12px;opacity:.5;";
    addRow.append(addPlus, addText, addHint);
    addRow.addEventListener("mouseenter", () => { addRow.style.background = "var(--wb-pane-hover,rgba(0,0,0,.04))"; });
    addRow.addEventListener("mouseleave", () => { addRow.style.background = "transparent"; });
    addRow.addEventListener("click", () => picker.click());
    addCard.appendChild(addRow);
    addGroup.append(addLabel, addCard);

    // ---- 分组 3：悬浮图标开关 ----
    const toggleGroup = document.createElement("div");
    const toggleLabel = document.createElement("p");
    toggleLabel.textContent = "悬浮图标";
    toggleLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    const toggleCard = document.createElement("div");
    toggleCard.style.cssText = "border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));background:var(--wb-pane-card,#fff);";
    const toggleRow = document.createElement("div");
    toggleRow.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px 14px;";
    const toggleCopy = document.createElement("div");
    toggleCopy.style.cssText = "flex:1;min-width:0;";
    const toggleTitle = document.createElement("div");
    toggleTitle.textContent = "显示悬浮小图标";
    const toggleDesc = document.createElement("div");
    toggleDesc.textContent = "关闭后隐藏页面上的悬浮按钮，仍可从本页切换皮肤。";
    toggleDesc.style.cssText = "font-size:12px;opacity:.55;margin-top:2px;";
    toggleCopy.append(toggleTitle, toggleDesc);

    // 开关：仿原生 wb-switch 的两态按钮
    const switchEl = document.createElement("button");
    switchEl.type = "button";
    switchEl.setAttribute("role", "switch");
    switchEl.style.cssText = "flex:none;position:relative;width:38px;height:22px;border-radius:11px;border:none;padding:0;cursor:pointer;transition:background .18s;";
    const knob = document.createElement("span");
    knob.style.cssText = "position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.28);transition:transform .18s;";
    switchEl.appendChild(knob);
    const syncSwitch = () => {
      switchEl.setAttribute("aria-checked", iconHidden ? "false" : "true");
      switchEl.style.background = iconHidden ? "rgba(0,0,0,.18)" : "var(--wb-pane-accent,#24c9d7)";
      knob.style.transform = iconHidden ? "translateX(0)" : "translateX(16px)";
      toggleDesc.textContent = iconHidden
        ? "\u5f53\u524d\u5df2\u9690\u85cf\uff0c\u4ecd\u53ef\u4ece\u672c\u9875\u5207\u6362\u76ae\u80a4\u3002"
        : "\u5173\u95ed\u540e\u9690\u85cf\u9875\u9762\u4e0a\u7684\u60ac\u6d6e\u6309\u94ae\uff0c\u4ecd\u53ef\u4ece\u672c\u9875\u5207\u6362\u76ae\u80a4\u3002";
    };
    switchEl.addEventListener("click", () => {
      iconHidden = !iconHidden;
      writeIconHidden(iconHidden);
      applyIconVisibility();
      syncSwitch();
    });
    toggleRow.append(toggleCopy, switchEl);
    toggleCard.appendChild(toggleRow);
    toggleGroup.append(toggleLabel, toggleCard);
    // 开关状态可能被别处改（例如测试重置），每次打开面板都重读一次
    pane.__syncSwitch = syncSwitch;

    // ---- 分组 4：外观调节（两个 1..100 的滑块）----
    const tuneGroup = document.createElement("div");
    const tuneLabel = document.createElement("p");
    tuneLabel.textContent = "外观调节";
    tuneLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    const tuneCard = document.createElement("div");
    tuneCard.style.cssText = "border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));background:var(--wb-pane-card,#fff);";
    const tuneSyncers = [];
    const mkSlider = (spec) => {
      const rowEl = document.createElement("div");
      rowEl.style.cssText = "padding:12px 14px;";
      const head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px;";
      const name = document.createElement("span");
      name.textContent = spec.label;
      name.style.cssText = "flex:1;min-width:0;";
      const value = document.createElement("span");
      value.style.cssText = "flex:none;font:500 12px/1 ui-monospace,monospace;opacity:.75;min-width:28px;text-align:right;";
      head.append(name, value);

      const input = document.createElement("input");
      input.type = "range";
      input.min = "1";
      input.max = "100";
      input.step = "1";
      input.dataset.wbTunable = spec.key;
      // 根节点是 user-select:none，滑块必须显式开回交互（与重命名输入框同理）
      input.style.cssText = "width:100%;margin:0;accent-color:var(--wb-pane-accent,#24c9d7);cursor:pointer;user-select:none;";
      input.setAttribute("aria-label", spec.label);

      const sync = () => {
        input.value = String(tunables[spec.key]);
        value.textContent = String(tunables[spec.key]);
      };
      input.addEventListener("input", () => {
        tunables[spec.key] = clampTunable(spec, input.value);
        // ⚠️ 只跑渲染同步，**不更新数字标签**（见下面的性能说明）。
        applyTunables();
      });
      // 松手才落盘 + 才刷新数字：拖动过程中每次 input 都写 localStorage 是没必要的同步 IO。
      //
      // ⚠️ 数字为什么不在拖动中实时更新（2026-09-20 实测）：
      //    设置弹窗打开时，**任何**文本改动都会让文档布局变脏，而一次布局约 29ms
      //    （弹窗内有 2700+ 元素）→ 拖动只剩 ~33fps，明显卡顿。
      //    实测对照：改 textContent 后强制布局 = 29ms；同一元素只改 transform = 0ms；
      //    把读数挪到弹窗之外也一样是 29ms（代价来自"弹窗开着时整篇布局都很贵"，不是位置问题）。
      //    所以拖动路径刻意做成"零布局"：数字在松手时补上，拖动中的反馈交给
      //    滑块自身的位置 + 背景模糊的实时变化（那两项都是 0ms）。
      input.addEventListener("change", () => { writeTunables(); sync(); });
      // 别让拖动事件冒泡出去（设置弹窗有"点空白处关闭"之类的外部点击逻辑）
      ["click", "pointerdown", "mousedown"].forEach((type) => {
        input.addEventListener(type, (event) => event.stopPropagation());
      });

      rowEl.append(head, input);
      tuneSyncers.push(sync);
      sync();
      return rowEl;
    };
    TUNABLE_SPEC.forEach((spec, index) => {
      const el = mkSlider(spec);
      if (index > 0) el.style.borderTop = "1px solid var(--wb-pane-border,rgba(0,0,0,.06))";
      tuneCard.appendChild(el);
    });
    tuneGroup.append(tuneLabel, tuneCard);
    // 值可能被别处改（测试/重置），每次打开面板都重读一次
    pane.__syncTunables = () => {
      for (const spec of TUNABLE_SPEC) tunables[spec.key] = clampTunable(spec, readTunables()[spec.key]);
      applyTunables();
      tuneSyncers.forEach((fn) => fn());
    };

    // ---- 分组 5：Wallpaper Engine 壁纸（本机）----
    // 面板结构对齐 dsh 皮肤中心的壁纸库：声音/音量 -> 手动目录 -> 评级筛选 -> 分页 -> 卡片。
    const weGroup = document.createElement("div");
    const weLabel = document.createElement("p");
    weLabel.textContent = "Wallpaper Engine 壁纸";
    weLabel.style.cssText = "margin:0 0 8px;font:500 13px/1.4 system-ui;opacity:.6;";
    const weCard = document.createElement("div");
    weCard.style.cssText = "border-radius:12px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.08));background:var(--wb-pane-card,#fff);overflow:hidden;";

    // 「仅本机」标注：WE 主题引用的是本机绝对路径，换台机器就是死链；
    // 创意工坊内容版权归作者，不可再分发。
    const weNote = document.createElement("div");
    weNote.textContent = "\u26a0\ufe0f 仅本机可用、不可分享";
    weNote.title = "这些壁纸引用你电脑上的本地文件路径，换机器即失效；创意工坊内容版权归作者，请不要打包分发";
    weNote.style.cssText = "padding:9px 12px;font:500 11px/1.5 system-ui;color:#c2761a;" +
      "background:color-mix(in srgb, #f0a63a 14%, transparent);border-bottom:1px solid var(--wb-pane-border,rgba(0,0,0,.06));";

    const mkWeBtn = (text, primary) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.style.cssText = "border-radius:8px;cursor:pointer;font:500 12px/1 system-ui;padding:7px 11px;" +
        (primary
          ? "border:1px solid var(--wb-pane-accent,#24c9d7);background:var(--wb-pane-accent,#24c9d7);color:#fff;"
          : "border:1px solid var(--wb-pane-border,rgba(0,0,0,.14));background:transparent;color:inherit;");
      return btn;
    };
    const mkWeHeadRow = (labelText) => {
      const rowEl = document.createElement("div");
      rowEl.style.cssText = "display:flex;align-items:center;gap:10px;";
      const labelEl = document.createElement("span");
      labelEl.textContent = labelText;
      labelEl.style.cssText = "flex:none;font:400 12px/1.4 system-ui;opacity:.8;";
      rowEl.appendChild(labelEl);
      return rowEl;
    };

    // ---------- 声音 / 音量（对齐 dsh 的 skin-wallpaper.sound / volume）----------
    const weHead = document.createElement("div");
    weHead.style.cssText = "padding:10px 12px;display:flex;flex-direction:column;gap:10px;" +
      "border-bottom:1px solid var(--wb-pane-border,rgba(0,0,0,.06));";

    const soundRow = mkWeHeadRow("壁纸声音");
    const soundToggle = document.createElement("button");
    soundToggle.type = "button";
    soundToggle.dataset.wbWeSound = "1";
    soundToggle.setAttribute("role", "switch");
    soundToggle.style.cssText = "flex:none;width:40px;height:22px;border-radius:11px;border:none;" +
      "cursor:pointer;padding:0;position:relative;transition:background .15s;";
    const soundKnob = document.createElement("span");
    soundKnob.style.cssText = "position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;" +
      "background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s;";
    soundToggle.appendChild(soundKnob);
    soundToggle.addEventListener("click", () => setWeSound(!weSound));
    // 面板里的暂停键：只在用视频壁纸时才有意义，文案与显隐由 syncWeButtons 同步
    wePaneToggle = mkWeBtn("暂停播放", false);
    wePaneToggle.dataset.wbWePaneToggle = "1";
    wePaneToggle.style.cssText += "margin-left:auto;padding:6px 10px;";
    wePaneToggle.addEventListener("click", () => setWePaused(!wePaused));
    soundRow.append(wePaneToggle, soundToggle);

    const volumeRow = mkWeHeadRow("壁纸音量");
    const volumeInput = document.createElement("input");
    volumeInput.type = "range";
    volumeInput.min = "0";
    volumeInput.max = "100";
    volumeInput.step = "1";
    volumeInput.dataset.wbWeVolume = "1";
    volumeInput.style.cssText = "flex:1;min-width:0;accent-color:var(--wb-pane-accent,#24c9d7);cursor:pointer;";
    const volumeText = document.createElement("span");
    volumeText.style.cssText = "flex:none;min-width:36px;text-align:right;font:400 12px/1.4 system-ui;opacity:.7;";
    volumeInput.addEventListener("input", () => setWeVolume(volumeInput.value));
    volumeRow.append(volumeInput, volumeText);
    weHead.append(soundRow, volumeRow);

    // ---------- 手动目录 ----------
    // renderer 拿不到本地绝对路径，所以这一行用 <input webkitdirectory> 直接选目录：
    // 选中的媒体文件立即灌进面板（视频走 Blob / file URL），不经过 Node 侧二次扫描。
    const weDirWrap = document.createElement("div");
    weDirWrap.style.cssText = "padding:10px 12px;display:flex;flex-direction:column;gap:8px;" +
      "border-bottom:1px solid var(--wb-pane-border,rgba(0,0,0,.06));";
    const dirRow = document.createElement("div");
    dirRow.style.cssText = "display:flex;align-items:center;gap:8px;";
    const dirLabel = document.createElement("span");
    dirLabel.textContent = "手动目录";
    dirLabel.style.cssText = "flex:none;font:400 12px/1.4 system-ui;opacity:.8;";
    const dirInput = document.createElement("input");
    dirInput.type = "text";
    dirInput.readOnly = true;
    dirInput.dataset.wbWeDirInput = "1";
    dirInput.placeholder = "/path/to/wallpapers 或 ~/";
    dirInput.style.cssText = "flex:1;min-width:0;border-radius:8px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.14));" +
      "background:transparent;color:inherit;font:400 12px/1.4 system-ui;padding:6px 9px;";
    const dirAddBtn = mkWeBtn("添加", true);
    const dirBrowseBtn = mkWeBtn("浏览", false);
    dirRow.append(dirLabel, dirInput, dirAddBtn, dirBrowseBtn);

    const dirHint = document.createElement("div");
    dirHint.dataset.wbWeDirHint = "1";
    dirHint.style.cssText = "font:400 11px/1.5 system-ui;opacity:.6;";

    const dirPicker = document.createElement("input");
    dirPicker.type = "file";
    dirPicker.webkitdirectory = true;
    dirPicker.multiple = true;
    dirPicker.style.display = "none";
    const openDirPicker = () => dirPicker.click();
    dirAddBtn.addEventListener("click", openDirPicker);
    dirBrowseBtn.addEventListener("click", openDirPicker);
    weDirWrap.append(dirRow, dirHint, dirPicker);

    // ---------- 状态 ----------
    const WE_FILTER_KEY = "anonbuddySkinWeFilter";
    const WE_PIN_KEY = "anonbuddySkinWePinned";
    const WE_PAGE_SIZE = 9;
    let weFilter = (() => { try { const raw = localStorage.getItem(WE_FILTER_KEY); return ["all", "g", "pg13", "r18"].indexOf(raw) >= 0 ? raw : "all"; } catch (error) { return "all"; } })();
    let wePage = 1;
    let weLocalItems = [];
    const readPins = () => { try { const raw = JSON.parse(localStorage.getItem(WE_PIN_KEY) || "[]"); return Array.isArray(raw) ? raw : []; } catch (error) { return []; } };
    const writePins = (pins) => { try { localStorage.setItem(WE_PIN_KEY, JSON.stringify(pins)); } catch (error) {} };
    let wePins = readPins();

    // ---------- 评级筛选 + 页码 ----------
    const weToolbar = document.createElement("div");
    weToolbar.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 12px;flex-wrap:wrap;" +
      "border-bottom:1px solid var(--wb-pane-border,rgba(0,0,0,.06));";
    const RATING_TABS = [
      { id: "all", label: "全部" },
      { id: "g", label: "G" },
      { id: "pg13", label: "PG-13" },
      { id: "r18", label: "R18" },
    ];
    const ratingPills = new Map();
    for (const tab of RATING_TABS) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.textContent = tab.label;
      pill.dataset.wbWeRating = tab.id;
      pill.style.cssText = "border-radius:999px;cursor:pointer;font:500 12px/1 system-ui;padding:6px 12px;";
      pill.addEventListener("click", () => {
        weFilter = tab.id;
        wePage = 1;
        try { localStorage.setItem(WE_FILTER_KEY, weFilter); } catch (error) {}
        renderWeGrid();
        syncWeUi();
      });
      ratingPills.set(tab.id, pill);
      weToolbar.appendChild(pill);
    }
    const pageText = document.createElement("span");
    pageText.dataset.wbWePageText = "1";
    pageText.style.cssText = "margin-left:auto;font:400 12px/1.4 system-ui;opacity:.7;";
    weToolbar.appendChild(pageText);

    // ---------- 卡片网格 ----------
    const weGrid = document.createElement("div");
    weGrid.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:10px 12px;";
    const weEmpty = document.createElement("div");
    weEmpty.dataset.wbWeEmpty = "1";
    weEmpty.style.cssText = "grid-column:1/-1;padding:22px 14px;text-align:center;font:400 12px/1.6 system-ui;opacity:.6;";

    // ---------- 分页 ----------
    const wePager = document.createElement("div");
    wePager.style.cssText = "display:flex;align-items:center;gap:8px;padding:0 12px 12px;";
    const prevBtn = mkWeBtn("上一页", false);
    const nextBtn = mkWeBtn("下一页", false);
    const jumpInput = document.createElement("input");
    jumpInput.type = "number";
    jumpInput.min = "1";
    jumpInput.dataset.wbWeJump = "1";
    jumpInput.style.cssText = "width:58px;border-radius:8px;border:1px solid var(--wb-pane-border,rgba(0,0,0,.14));" +
      "background:transparent;color:inherit;font:400 12px/1.4 system-ui;padding:6px 8px;";
    const jumpBtn = mkWeBtn("跳转", false);
    wePager.append(prevBtn, nextBtn, jumpInput, jumpBtn);

    // ---------- 数据 ----------
    const ratingOf = (value) => (value === "pg13" || value === "r18" ? value : "g");
    const allLocal = () => weLocalItems.concat(wePins);
    const sourceItems = () => weItems.concat(allLocal());
    const visibleItems = () => {
      const list = sourceItems();
      return weFilter === "all" ? list : list.filter((x) => ratingOf(x.rating) === weFilter);
    };
    const pageCount = () => Math.max(1, Math.ceil(visibleItems().length / WE_PAGE_SIZE));
    const typeLabel = (item) => {
      if (item.kind === "video") return "视频";
      if (item.rawType === "scene") return "场景(静态)";
      if (item.rawType === "web") return "网页";
      return "静态图片";
    };
    const ratingLabel = (rating) => (rating === "r18" ? "R18" : rating === "pg13" ? "PG-13" : "G");
    const ratingColor = (rating) => (rating === "r18" ? "#d14343" : rating === "pg13" ? "#d18b2b" : "#3f9e5a");

    // ---------- 渲染 ----------
    syncWeList = () => {
      for (const cell of weGrid.querySelectorAll("[data-wb-we-item]")) {
        const on = cell.dataset.wbWeItem === weActiveId;
        cell.style.borderColor = on ? "var(--wb-pane-accent,rgba(36,201,215,.6))" : "var(--wb-pane-border,rgba(0,0,0,.06))";
        cell.style.background = on ? "var(--wb-pane-active,rgba(36,201,215,.12))" : "transparent";
        const applyBtn = cell.querySelector("[data-wb-we-apply]");
        if (applyBtn) {
          applyBtn.textContent = on ? "当前激活" : "应用";
          applyBtn.disabled = on;
          applyBtn.style.opacity = on ? ".6" : "1";
          applyBtn.style.cursor = on ? "default" : "pointer";
        }
      }
    };

    const renderWeGrid = () => {
      weGrid.textContent = "";
      const list = visibleItems();
      const total = pageCount();
      if (wePage > total) wePage = total;
      if (wePage < 1) wePage = 1;
      const slice = list.slice((wePage - 1) * WE_PAGE_SIZE, (wePage - 1) * WE_PAGE_SIZE + WE_PAGE_SIZE);

      for (const item of slice) {
        const cell = document.createElement("div");
        cell.dataset.wbWeItem = item.id;
        cell.style.cssText = "display:flex;flex-direction:column;border-radius:10px;overflow:hidden;" +
          "border:1px solid var(--wb-pane-border,rgba(0,0,0,.06));background:transparent;";

        const thumbWrap = document.createElement("div");
        thumbWrap.style.cssText = "position:relative;aspect-ratio:16/9;background:rgba(0,0,0,.08);overflow:hidden;";
        if (item.previewUrl) {
          const thumb = document.createElement("img");
          thumb.src = item.previewUrl;
          thumb.loading = "lazy";
          thumb.alt = "";
          thumb.style.cssText = "display:block;width:100%;height:100%;object-fit:cover;";
          thumbWrap.appendChild(thumb);
        }
        const typeTag = document.createElement("span");
        typeTag.textContent = typeLabel(item);
        typeTag.style.cssText = "position:absolute;top:6px;left:6px;border-radius:6px;padding:2px 6px;" +
          "background:rgba(0,0,0,.55);color:#fff;font:500 10px/1.4 system-ui;";
        thumbWrap.appendChild(typeTag);
        const rating = ratingOf(item.rating);
        const rateTag = document.createElement("span");
        rateTag.textContent = ratingLabel(rating);
        rateTag.style.cssText = "position:absolute;top:6px;right:6px;border-radius:6px;padding:2px 6px;" +
          "color:#fff;font:600 10px/1.4 system-ui;background:" + ratingColor(rating) + ";";
        thumbWrap.appendChild(rateTag);
        cell.appendChild(thumbWrap);

        const cardBody = document.createElement("div");
        cardBody.style.cssText = "padding:7px 8px 8px;display:flex;flex-direction:column;gap:7px;flex:1;";
        const nameEl = document.createElement("div");
        nameEl.textContent = item.title;
        nameEl.title = item.title + (item.sizeMB ? "（" + item.sizeMB + " MB）" : "");
        nameEl.style.cssText = "font:400 11px/1.35 system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;gap:6px;margin-top:auto;";
        const applyBtn = mkWeBtn("应用", true);
        applyBtn.dataset.wbWeApply = "1";
        applyBtn.style.cssText += "flex:1;padding:6px 8px;";
        applyBtn.addEventListener("click", () => { applyWeTheme(item); });
        btnRow.appendChild(applyBtn);

        if (item.manual || item.pinned) {
          const sideBtn = mkWeBtn(item.pinned ? "移除" : "导入", false);
          sideBtn.style.cssText += "flex:none;padding:6px 8px;";
          sideBtn.addEventListener("click", () => {
            if (item.pinned) {
              wePins = wePins.filter((x) => x.id !== item.id);
              writePins(wePins);
            } else {
              // 「导入」= 把这条手动条目固定下来：写进 localStorage，重新 apply 后仍然显示。
              // 只有拿到真实 file:// 路径的条目才固定得住（Blob URL 出不了这次会话）。
              if (!/^file:/i.test(item.fileUrl || "")) {
                sideBtn.textContent = "本会话有效";
                setTimeout(() => { sideBtn.textContent = "导入"; }, 1400);
                return;
              }
              const pin = {
                id: item.id, title: item.title, kind: item.kind, rawType: item.rawType,
                fileUrl: item.fileUrl, previewUrl: item.previewUrl, sizeMB: item.sizeMB,
                rating: item.rating, manual: true, pinned: true,
              };
              wePins = wePins.filter((x) => x.id !== item.id).concat(pin);
              writePins(wePins);
              weLocalItems = weLocalItems.filter((x) => x.id !== item.id);
            }
            renderWeGrid();
            syncWeUi();
          });
          btnRow.appendChild(sideBtn);
        }

        cardBody.append(nameEl, btnRow);
        cell.appendChild(cardBody);
        weGrid.appendChild(cell);
      }

      if (!slice.length) {
        weEmpty.textContent = sourceItems().length === 0
          ? "未发现壁纸。可先在 Wallpaper Engine 创意工坊订阅，或在上面的手动目录里添加文件夹。"
          : "该评级下没有壁纸，换个筛选看看。";
        weGrid.appendChild(weEmpty);
      }
      syncWeList();
    };

    syncWeUi = () => {
      soundToggle.style.background = weSound ? "var(--wb-pane-accent,#24c9d7)" : "rgba(120,120,120,.35)";
      soundKnob.style.transform = weSound ? "translateX(18px)" : "translateX(0)";
      soundToggle.setAttribute("aria-checked", weSound ? "true" : "false");
      if (volumeInput.value !== String(weVolume)) volumeInput.value = String(weVolume);
      // 静音时标明状态：声音开关是独立的一行，只拖音量滑块不会解除静音
      //（浏览器不允许非静音自动播放，所以默认是静音起播）。
      // 不提示的话很容易误判成"音量功能坏了"。
      volumeText.textContent = weSound ? weVolume + "%" : weVolume + "% 静音";

      for (const [id, pill] of ratingPills) {
        const on = id === weFilter;
        pill.style.background = on ? "var(--wb-pane-accent,#24c9d7)" : "transparent";
        pill.style.color = on ? "#fff" : "inherit";
        pill.style.border = on ? "1px solid transparent" : "1px solid var(--wb-pane-border,rgba(0,0,0,.14))";
      }

      const total = pageCount();
      pageText.textContent = "第 " + wePage + " / " + total + " 页";
      jumpInput.max = String(total);
      prevBtn.disabled = wePage <= 1;
      nextBtn.disabled = wePage >= total;
      prevBtn.style.opacity = wePage <= 1 ? ".45" : "1";
      nextBtn.style.opacity = wePage >= total ? ".45" : "1";

      const localCount = weLocalItems.length + wePins.length;
      dirInput.value = localCount ? localCount + " 个条目" : "";
      dirHint.textContent = localCount
        ? "已加入 " + localCount + " 个条目（仅本机）。点卡片上的「导入」可把带真实路径的条目固定下来。"
        : "还没有手动目录。没有 Wallpaper Engine（或想用零散素材）？把任意 .mp4/.webm 视频或项目文件夹加进来，就是你的壁纸库。";
    };

    prevBtn.addEventListener("click", () => { if (wePage > 1) { wePage -= 1; renderWeGrid(); syncWeUi(); } });
    nextBtn.addEventListener("click", () => { if (wePage < pageCount()) { wePage += 1; renderWeGrid(); syncWeUi(); } });
    jumpBtn.addEventListener("click", () => {
      const want = Math.round(Number(jumpInput.value));
      if (!Number.isFinite(want)) return;
      wePage = Math.min(pageCount(), Math.max(1, want));
      renderWeGrid();
      syncWeUi();
    });

    const ratingFromTitle = (title) => {
      if (/(^|[^\w])(r-?18|nsfw|18\+)([^\w]|$)/i.test(title)) return "r18";
      if (/(^|[^\w])(pg-?13|r-?16)([^\w]|$)/i.test(title)) return "pg13";
      return "g";
    };
    const toFileUrlLocal = (rawPath) => {
      const norm = String(rawPath).replace(/\\/g, "/").replace(/^\/+/, "");
      const parts = norm.split("/");
      return "file:///" + parts.map((seg, index) => (index === 0 ? seg : encodeURIComponent(seg))).join("/");
    };
    // Electron 能给出真实绝对路径时优先用它（可持久），拿不到才退回 Blob URL（仅本次会话有效）
    const localUrlOf = (file) => {
      try {
        const wu = window.webUtils;
        if (wu && typeof wu.getPathForFile === "function") {
          const real = wu.getPathForFile(file);
          if (real) return toFileUrlLocal(real);
        }
      } catch (error) {}
      try {
        if (typeof file.path === "string" && file.path) return toFileUrlLocal(file.path);
      } catch (error) {}
      try { return URL.createObjectURL(file); } catch (error) { return null; }
    };

    dirPicker.addEventListener("change", () => {
      const files = Array.from(dirPicker.files || []);
      dirPicker.value = "";
      if (!files.length) return;
      const picked = [];
      for (const file of files) {
        const name = file.name;
        const dot = name.lastIndexOf(".");
        if (dot <= 0) continue;
        const ext = name.slice(dot).toLowerCase();
        const isVideo = ext === ".mp4" || ext === ".webm";
        const isImage = ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp";
        if (!isVideo && !isImage) continue;
        const url = localUrlOf(file);
        if (!url) continue;
        const title = name.slice(0, dot);
        picked.push({
          id: "local-" + (file.webkitRelativePath || name),
          title,
          kind: isVideo ? "video" : "preview",
          rawType: isVideo ? "video" : "image",
          fileUrl: url,
          previewUrl: isVideo ? null : url,
          sizeMB: Math.round((file.size / 1048576) * 10) / 10,
          rating: ratingFromTitle(title),
          manual: true,
        });
      }
      if (!picked.length) return;
      const known = new Set(weLocalItems.map((x) => x.id));
      for (const item of picked) if (!known.has(item.id)) { known.add(item.id); weLocalItems.push(item); }
      wePage = 1;
      renderWeGrid();
      syncWeUi();
    });

    weCard.append(weNote, weHead, weDirWrap, weToolbar, weGrid, wePager);
    weGroup.append(weLabel, weCard);
    renderWeGrid();
    syncWeUi();
    syncWeButtons();

    body.append(listGroup, addGroup, toggleGroup, tuneGroup, weGroup);
    pane.append(body);
    pane.__renderList = renderList;
    pane.__syncSelection = syncPaneSelection;
    return pane;
  };

  // 主题变量：让面板颜色跟随「设置弹窗自己的底色」（不是皮肤主题，见 paneSurface 注释）
  const syncPaneThemeVars = () => {
    if (!settingsPane || !settingsPane.isConnected) return;
    // ⚠️ 这里**始终重算、但只在值真的变了才写**（2026-09-20 踩过两次）：
    // applyMode 每次切主题都会走到这里，而往面板元素上写自定义属性会让它**整棵子树**样式失效
    // （设置弹窗 2700+ 元素）—— 无脑写会把「重复应用同一主题」从 ~0ms 抬到 53.8ms。
    // 但也不能"面板没显示就跳过"：那样面板关闭期间切主题，强调色会停在旧值（被
    // test-settings-panel 的「原生模式下强调色兜底」抓住）。所以是"算而不写"。
    const surface = paneSurface();
    const dark = !isLightSurface(surface);
    // 强调色可以沿用当前皮肤，它只是点缀，深浅背景下都够醒目。
    // 三个兜底依次是：自定义主题 → 内置主题 → 全局默认色。
    // ⚠️ 最后一个兜底正是「原生模式」会走到的分支（currentThemeId() 为 null 时前两个都落空），
    // 所以它必须是 payload 里的值，不能直接引用 Node 侧常量（会抛 ReferenceError）。
    const id = currentThemeId();
    const custom = customThemes.find((c) => c.id === id);
    const accent = custom?.colors.accent ?? data.themes.find((t) => t.id === id)?.accent ?? data.defaultAccent;
    // 每个值都先比对再写：值没变时 setProperty 照样会触发样式失效，纯属白付钱
    const setVar = (name, value) => {
      if (settingsPane.style.getPropertyValue(name) !== value) settingsPane.style.setProperty(name, value);
    };
    setVar("--wb-pane-accent", accent);
    setVar("--wb-pane-text", dark ? "#f0f2f6" : "#1a1a1a");
    setVar("--wb-pane-card", dark ? "rgba(255,255,255,.06)" : "#ffffff");
    setVar("--wb-pane-border", dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.08)");
    setVar("--wb-pane-active", dark ? "rgba(255,255,255,.10)" : "rgba(36,201,215,.12)");
    // 悬停底色：深色面板上不能再用 rgba(0,0,0,...) 那套（黑压黑等于没有反馈）
    setVar("--wb-pane-hover", dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.04)");
    setVar("--wb-pane-surface", surface);
    // 卡片底色由变量给，这里兜一个显式值，避免变量在极端情况下没生效就变透明
    const wantColor = dark ? "#f0f2f6" : "#1a1a1a";
    if (settingsPane.style.color !== wantColor) settingsPane.style.color = wantColor;
  };

