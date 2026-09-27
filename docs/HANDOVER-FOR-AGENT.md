# 交接文档：AnonBuddy Skin 现状与待修补清单

> **用途**：交接给接手者/其他 agent，用于快速建立上下文并直接开展 bug 修补。
> **成文时间**：2026-09-21　**代码基线**：`af81ba5`（含大量**未提交**改动，见 §6.1）
> **本文件描述的是"工作区当前实际状态"**，不是某个提交的状态。接手前请先读 §6.1。

---

## 一、整体架构与模块功能定位

### 1.1 一句话定位

一个 **WorkBuddy 桌面端的换肤插件**：Node 脚本通过 **CDP 注入** CSS 与一个 🎨 悬浮菜单到渲染进程，
**不修改 `app.asar`**，随时可 `pause` 还原。

### 1.2 数据流

```
apply-now.mjs（桌面快捷方式/bat 调用的入口）
   └─> src/cli.mjs          apply / pause / status / we / we-extract
         └─> src/injector.mjs
               ├─ src/theme-schema.mjs + theme-store.mjs   读 themes/<id>/theme.json + hero.webp
               ├─ src/skin-css.mjs + css-loader.mjs        把 src/css/skin.css 的 {{占位符}} 填成真实 CSS
               ├─ src/we-library.mjs                       盘点本机 Wallpaper Engine 壁纸库
               ├─ src/we-extract.mjs                       用内置 RePKG 把 scene.pkg 解成贴图
               ├─ src/asar-path.mjs                        动态发现 WorkBuddy 安装路径（禁止写死）
               └─ src/skin-menu.mjs  buildSkinMenuScript() 生成**一整段待注入的 JS 字符串**
                     └─> src/cdp-client.mjs  ── CDP ──> renderer（注入 CSS + 建菜单/面板/图层）
```

### 1.3 模块功能定位

| 文件 | 行数 | 职责 | 备注 |
|---|---|---|---|
| `src/skin-menu.mjs` | **2254** | 注入到渲染进程的整段脚本（模板字符串）+ 设置面板 + 外观联动 + WE 集成 | ⚠️ **风险最高的文件**，见 §4.4 |
| `src/css/skin.css` | 677 | 皮肤样式正文，含 10 个 `{{占位符}}` | **改样式只改这个文件** |
| `src/cdp-client.mjs` | 542 | CDP 连接、evaluate、截图 | |
| `src/cli.mjs` | 221 | 命令分发 | 参数解析**只支持 `--key value`**，不支持位置参数 |
| `src/we-extract.mjs` | 211 | RePKG 解包 + 缓存 + 零依赖读图片头挑主图 | 本次新增 |
| `src/injector.mjs` | 197 | 组装 payload 并经 CDP 注入 | **所有注入路径的汇合点** |
| `src/we-library.mjs` | 185 | 只读盘点 WE 壁纸库（定位 Steam 库 → 解析 `project.json` → 分类） | 本次新增 |
| `src/asar-path.mjs` | 147 | 动态发现安装路径（可用环境变量覆盖） | 跨机器零配置的关键 |
| `src/theme-schema.mjs` | 135 | 主题 manifest 校验 | |
| `src/theme-store.mjs` | 83 | 主题目录读写 | |
| `src/skin-css.mjs` | 57 | 占位符取值与填充 | |
| `src/css-loader.mjs` | 51 | 读 CSS 文件 + 填占位符 | |
| `src/constants.mjs` | 29 | 常量 | |
| `tools/repkg/RePKG.exe` | 3.7MB | 内置的 WE 贴图解包器（MIT，NativeAOT） | 随仓库分发 |

### 1.4 三条设计基线（改代码前必须知道）

1. **注入是单向的**：renderer 无法回写 Node。所以**所有用户状态只能存 localStorage**。
2. **外观联动靠 `data-skin` 契约**：给 `<html>` 打 `data-skin` = 声明"皮肤接管"，
   原生 `ThemeManager` 会主动让位（它见到 `data-skin` 就提前 return）。代价是**原生的那批 DOM 输出
   必须由我们全部自己写**（详见 §3 已修 bug #1）。
3. **皮肤与自带外观是两套系统**，但写同一批 DOM 输出 → 必须联动，否则会互相打架。

---

## 二、已实现 / 未完成

### 2.1 已实现（均有回归测试）

| 功能 | 状态 | 回归测试 |
|---|---|---|
| 内置主题（3 个）+ 主题 CSS 注入 | ✅ | `test-home-skin` / `test-restore-last` |
| 自定义上传图片当主题（canvas 压成 webp + 取色） | ✅ | `test-custom-themes` |
| 🎨 悬浮菜单（可拖动、贴边锚点、右键菜单、重命名） | ✅ | `test-drag` / `test-menu-icon` / `test-rename` |
| 设置面板集成（往原生设置里插条目 + 自建面板） | ✅ | `test-settings-panel` |
| 皮肤列表 **3 列网格** | ✅ | `test-settings-panel` |
| 悬浮图标显隐开关 | ✅ | `test-settings-panel` |
| **外观联动 + 双向护栏**（深色皮肤锁浅色外观，反之亦然） | ✅ | `test-appearance-linkage` |
| **两个外观调节项**（侧边栏毛玻璃 / 背景图模糊，各 1–100） | ✅ | `test-tunables` |
| 文案替换（品牌名 + 欢迎页主标题逐字动画） | ✅ | `test-title-copy` / `test-roll-anim` |
| 幂等重注入 / pause 还原 | ✅ | `test-reapply-idempotent` / `test-pause-restore` |
| **WE 视频壁纸**（`file://` 直读、默认自动播放、两处暂停键） | ✅ | `test-we` |
| **WE scene 壁纸 → 解出 4K 静态贴图**（内置 RePKG + 后台预热 + 缓存） | ✅ | `test-we` |

**测试规模**：`npm run test:all` = **20 个 e2e / 390 项断言**；`npm run test:static` = 4 项（含 lint）。

### 2.2 未完成 / 明确不做

| 项 | 现状 | 说明 |
|---|---|---|
| **WE scene 壁纸的动效** | ❌ 拿不到 | 动效来自着色器 + WE 引擎逐帧求值，RePKG 只解贴图。**唯一路子是录屏**（`wallpaper64.exe` 渲染 + 录成 mp4 → 走现有 video 管线），工程量大，未开工 |
| WE `web` 类型壁纸 | ❌ 未支持 | 本机没有该类型；网页壁纸要 iframe 且会抢焦点 |
| macOS | ⚠️ 未实机验证 | 代码里有 `MENUBAR_HEIGHT = 0` 分支，但从未在 mac 上跑过 |
| 主题包导出 / 分享 | ❌ 未做 | ⚠️ **WE 来源的主题天然不可导出**（引用本机绝对路径） |
| 缓存清理入口 | ❌ 未做 | 没有 `we-clean` 命令；只能手删缓存目录 |
| 播放/暂停全局快捷键 | ❌ 未做 | 目前只有面板与悬浮键两个按钮 |
| `we-extract` 的进度反馈 | ⚠️ 简陋 | 只在结束时输出 JSON；后台预热时用户看不到进度 |

---

## 三、已知 bug

### 3.1 已修复（**请勿回退**，每条都记了根因与回归测试）

> 这些是本轮工作修掉的，**修复点都带注释**，回归测试也都在。若接手后测试变红，优先怀疑这里被改回去了。

| # | 症状 | 根因 | 回归测试 |
|---|---|---|---|
| 1 | 切主题后自带外观深浅不刷新，**点一下个人中心才正常** | `applyMode` 漏写 `<html data-theme>`；而原生写它的入口（`ThemeManager.applyTheme`）见到 `data-skin` 会**提前 return** → 接管期间没人写它 | `test-appearance-linkage` + `test-settings-panel` |
| 2 | 面板开着时切主题，面板配色停在打开那一刻 | `--wb-pane-*` 只在 `openPluginPane()` 里算一次 | `test-settings-panel` 6b 节 |
| 3 | **背景图整个看不见**；拖模糊滑块几乎无视觉变化（整屏 PNG 只差 34/160000 字节） | hero 在负 z-index 图层里，而 `html` 有原生不透明白底 → `body` 背景不再"上交给画布"，作为普通元素背景在绘制**第 3 步**绘制，晚于负 z-index 图层的**第 2 步** → 把图层整个盖住 | `test-tunables` 像素级断言 |
| 4 | 拖滑块卡顿（~33fps） | 两个值写在 **html 的自定义属性**上 → 在 html 上 `setProperty` 写任何自定义属性（哪怕没人用）都会触发**全文档重算**（2269 元素 ≈ 23ms/次） | `test-tunables` 性能断言 |
| 5 | 拖动中改数字标签导致布局重算（29ms/次） | 设置弹窗打开时改**任意文本**都会让整篇布局变脏 | 同上（已改为松手才刷新数字） |
| 6 | WE 条目**翻倍**（38 → 76） | Windows 路径大小写不敏感，`D:\Steam` 与 `D:\steam` 是同一目录，候选列表不去重 | `test-we` |
| 7 | RePKG 跑完**产物为空**且不报错 | `-e png` 匹配不到任何条目 —— pkg 里贴图的原扩展名是 **`.tex`**，RePKG 是"提取 tex 时顺手转 png" | 手工验证；见 `docs/WE-INTEGRATION.md` |
| 8 | 缓存目录膨胀到 **2.2GB** | 解包中间产物 `raw/` 没清干净（进程被杀时走不到清理行） | `test-we` 的 `sweepStrayRaw` 断言 |
| 9 | 页面里 WE 条目数变成 **0**（静默） | `injector.mjs` 用了 `dirname` 但**没导入** → 异常被 `catch` 吞掉 → `resolvedWe = []` | `test-we` |
| 10 | 测试断言"payload 没传 heroUrl"（误判） | `we.items()` API **裁剪了字段**，`heroUrl`/`canExtract` 没暴露 | `test-we` |
| 11 | 测试全绿但**画面完全没变化** | **空跑断言**：只断言 `getComputedStyle(...).filter`，测不出"被别的层盖住" | 已补**像素级**断言 |
| 12 | 改一条排除选择器就把无关测试打红 | `test-overlay-opacity` 用**逐字子串**匹配整段选择器 | 已改为"只断言必须被排除的那几类都在" |

### 3.2 未修复（**接手后的主要工作面**）

#### BUG-A ★ `Page.captureScreenshot` 在背景层有 `<video>` 时会卡住

- **复现**：应用任意 WE 视频壁纸（面板 WE 分组里标 `▶ 动效` 的条目），然后调用 `Page.captureScreenshot`。
  实测**超时**（`fromSurface:false` 能返回但只有 11KB，采不到视频层）。
- **影响范围**：**只影响测试/工具链**，不影响最终用户体验。
  但后果严重：任何用截图做断言的测试（如 `test-tunables`）在视频壁纸生效时会挂。
- **现有绕过**：`test-we` 收尾强制切回普通主题；需要截图时先把视频 `visibility:hidden`。
- **建议方向**：排查是硬件解码面读回的问题，还是 CDP 参数问题；或统一在测试基座里
  加一个"截图前隐藏视频"的兜底。

#### BUG-B ★ `ensureModalSurface` 存在 apply/remove 振荡隐患

- **位置**：`src/skin-menu.mjs` 的 `ensureModalSurface()`。
- **根因**：它用 `getComputedStyle(content).backgroundColor` 判断"原生有没有实底"，
  但**这个值可能是我们自己之前写的内联值** → 读到不透明 → 走"撤掉覆盖"分支 →
  下次再读到透明 → 又铺上 → **来回抖动**。
- **复现条件**：当原生 `.settings-modal__content` 的底色是**透明**时才会触发；
  当前这台机器上原生有实底（`rgb(20,20,20)` / `rgb(247,247,247)`），所以**暂时没暴露**。
- **影响范围**：中。一旦触发，弹窗底色会闪，且 `data-wb-pane-surface` 状态与 DOM 不一致。
- **建议方向**：判断时排除我们自己的内联值（例如先读 `content.style.backgroundColor` 再决定），
  或改成用 class/属性标记"我们已铺底"而不是靠颜色反推。

#### BUG-C 视频壁纸的性能未实测

- **现状**：视频背景 = 持续 GPU 解码 + 每帧 `backdrop-filter` 重算，**两者叠加**。
  本机素材里有 **4K / 495MB** 的视频（`3244903082` 天津罪 494.8MB），**从未实测过帧率与功耗**。
- **已知设计缺口**：`docs/ARCHITECTURE.md` 里提过"建议给视频主题自动降低侧边栏模糊"，
  **但代码里没有实现**。
- **影响范围**：中高（直接影响用户体验，尤其 4K 素材）。
- **建议方向**：实测 4K 视频 + 最大侧边栏模糊的帧率；若掉帧，实现"视频主题自动降模糊"。

#### BUG-D 缓存无清理入口 + 体积会持续增长

- **现状**：缓存 32 条 = **141MB**（平均 4.4MB/条目，4K PNG 无损）。全部 34 条约 150MB。
- **缺口**：没有 `we-clean` / `we-cache` 命令；用户无法在插件内管理。
  且 `hero.png` 是**无损 4K PNG**，没有做降采样或转 JPEG（RePKG 无输出格式选项，Node 无内置图像编码）。
- **影响范围**：中（磁盘占用，长期使用会累积）。
- **建议方向**：加一个清理命令；或引入"缓存上限 + LRU 淘汰"。

#### BUG-E `.gitignore` 可能存在混合换行

- **现状**：本轮修改时发现该文件是 CRLF，而我最初用 `\n` 追加导致过不匹配，
  后来统一按 CRLF 重写。**未逐行核对是否引入了混合换行**。
- **影响范围**：低（只影响 diff 可读性）。

#### BUG-F 工作区有**非本轮**的未提交改动

- **发现**：`scripts/patch-lnk.mjs` 有 **+138/-37** 行改动，**不是本轮工作产生的**（本轮从未碰过它）。
  另有 `apply-ai.cmd` 为未跟踪文件。
- **影响范围**：**交接风险**——接手者会分不清哪些改动属于谁、是否可丢弃。
- **建议**：先确认这两项的历史来源再决定提交或丢弃（见 §6.1）。

---

## 四、潜在风险与待确认问题

### 4.1 架构级风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| **依赖"渲染进程是 `file://`"** | WE 集成（`<video src="file:///…">`、CSS `url(file:///…)`）**整体建立在"WorkBuddy 渲染进程是 file:// 页面"之上**。这是实测事实，但**不是我们能控制的契约** | 若 WorkBuddy 改成自定义协议，需回退到"Node 读字节"或"常驻本地 HTTP 服务"（方案 D，见 `docs/WE-INTEGRATION.md`）。**目前没有任何自动降级** |
| **内置 3.7MB 二进制进 git** | `tools/repkg/RePKG.exe` 随仓库分发 | 已随附 `THIRD-PARTY-NOTICES.txt`（MIT 合规）。若将来仓库体积敏感，可改回"按需下载" |
| **localStorage 是唯一持久化** | 配额约 8M 字符（实测 7.97M）。自定义图片每张约 128K | 已有配额超限的降级提示；WE 主题**只存路径不存字节**，不吃配额 |
| **`src/skin-menu.mjs` 单文件 2254 行** | 它是**模板字符串**，三类写法会静默弄坏（见 §4.4） | 拆文件收益大但风险也大；建议先补测试再拆 |

### 4.2 待确认问题（需要产品决策，不是纯技术）

1. **WE 来源主题的分享边界**：目前面板已标「仅本机、不可分享」，但**没有技术手段阻止**用户导出。
   若将来做"主题包导出"，必须显式排除 WE 来源。
2. **scene 动效要不要做**：唯一路子是录屏（需 WE 本体 + 接管桌面 + 离线生成）。
   投入产出比未评估。
3. **视频壁纸默认播放 vs 省电**：当前**默认自动播放**（已确认的产品决策）。
   若用户反馈耗电，可能需要加"插电才播放"之类的策略。
4. **缓存策略**：是否需要"仅保留最近 N 个"，还是无限增长。

### 4.3 环境依赖（接手前请确认）

| 依赖 | 本机状态 | 说明 |
|---|---|---|
| WorkBuddy 安装路径 | `D:\Apps\WorkBuddyAI\WorkBuddyAI.exe` | ⚠️ 旧的 `E:\workbuudy\...` 已卸载，但 `backup-desktop-scripts/` 下的 bat/lnk **仍写死旧路径，已失效** |
| CDP 端口 | 统一 **9333** | 9223 曾被僵尸 socket 占用 |
| Wallpaper Engine 库 | `D:\Steam\steamapps\workshop\content\431960` | 51 条目 = 34 scene + 4 video + 13 preset |
| .NET | 有 6/8/10（**但 RePKG 不需要**，它是 NativeAOT） | |
| ffmpeg / RePKG（外部） | **都没有** | RePKG 已内置；ffmpeg 仅"录屏取动效"方案需要 |

### 4.4 ⚠️ `src/skin-menu.mjs` 是模板字符串，三类写法会**静默**弄坏

改这个文件前**必须**跑 `npm run lint`，并记住：

1. **注释里出现反引号** → 模板字符串提前截断（本轮踩过一次，报错指向模板开头，完全看不出是注释惹的）
2. **正则反斜杠被吃一层** → 写双反斜杠或用 `[0-9]`
3. **引用 Node 端作用域的东西** → renderer 运行时 `ReferenceError`，**语法检查抓不到**，
   常被 click 处理器吞掉 = 「点了没反应」。**要传值就加进 `buildSkinMenuScript` 的 payload，用 `data.xxx` 读**

---

## 五、后续修补优先级建议

### P0 — 开工前必做（否则无法判断自己改坏了什么）

1. **先跑通测试基线**：`npm run test:static` → `npm run test:core`，确认 20/20 全绿。
   ⚠️ 需要 WorkBuddy 正在运行且已开 CDP 9333，否则 e2e 会连不上。
2. **处理工作区的 32 项未提交改动**（见 §6.1）。**在这之前不要开始改代码** ——
   否则你分不清"测试红了"是自己改的还是原本就红。

### P1 — 真实缺陷，建议优先修

3. **BUG-B `ensureModalSurface` 振荡隐患**：这是**确定的逻辑缺陷**，只是当前环境没触发。
   属于"换台机器/换版本就可能炸"的类型，且修起来范围可控。
4. **BUG-C 视频壁纸性能未实测**：先测量（4K 视频 + 最大模糊的帧率），再决定是否需要自动降模糊。
   这是**唯一可能严重影响用户体验**的未修项。
5. **BUG-F 工作区来源不明的改动**：先弄清 `scripts/patch-lnk.mjs` 的 +138 行是什么再动。

### P2 — 体验与可维护性

6. **BUG-D 缓存管理**：加 `we-clean` 命令；考虑缓存上限。
7. **BUG-A 截图卡住**：只影响测试工具链，但会**持续干扰后续所有截图类测试**，
   建议在测试基座里统一加兜底（截图前隐藏视频）。
8. **BUG-E `.gitignore` 换行**：顺手核对。

### P3 — 新功能（非修补）

9. `we-extract` 的进度反馈（后台预热时用户看不到进度）
10. 视频播放的全局快捷键
11. macOS 实机验证
12. scene 录屏取动效（工程量大，需先评估投入产出）
13. 缓存降采样（4K PNG → 更小体积，需引入图像编码方案）

---

## 六、接手须知

### 6.1 ⚠️ 当前工作区状态（**重要**）

- **基线提交**：`af81ba5`（`docs: 新增交接总结 HANDOFF.md，并修正 README 一处主题深浅标注错误`）
- **工作区有 32 项未提交改动**，其中：
  - **本轮工作**（功能性改动）：`src/cli.mjs` / `src/css/skin.css` / `src/injector.mjs` /
    `src/skin-menu.mjs` / `package.json` / `scripts/run-tests.mjs` / 3 个测试脚本 /
    `docs/ARCHITECTURE.md` / `docs/HANDOFF.md` / `.gitignore`
  - **本轮新增**：`src/we-library.mjs` / `src/we-extract.mjs` / `scripts/test-tunables.mjs` /
    `scripts/test-we.mjs` / `docs/WE-INTEGRATION.md` / `tools/repkg/`（含 3.7MB 二进制）
  - **诊断脚本**（可留在 `scripts/archive/`）：`diag-theme-switch-stale{,2}.mjs` /
    `diag-bg-blur-visual.mjs` / `probe-file-scheme.mjs` / `probe-we-library.py` /
    `verify-tunables.mjs` / `verify-we-hd.mjs` / `shot-*.mjs`
  - ⚠️ **非本轮、来源不明**：`scripts/patch-lnk.mjs`（+138/−37）、`apply-ai.cmd`（未跟踪）

**建议**：先按逻辑分组提交（或先 stash 来源不明的改动），再开始修 bug。

### 6.2 常用命令

```bash
npm run lint                      # 改 skin-menu.mjs 后必跑
npm run test:static               # 秒级：lint + ps1 编码 + CSS 解析 + 脚本登记
npm run test:core                 # 核心 e2e
npm run test:ui                   # 布局/视觉 e2e（改 CSS 或面板时跑）
npm run test:all                  # 全量 20 个 e2e
node apply-now.mjs                # 注入皮肤（默认恢复上次主题）
node apply-now.mjs aisu    # 指定主题
node src/cli.mjs status           # 查看注入状态
node src/cli.mjs we               # 盘点 WE 壁纸库
npm run we:extract                # 用内置 RePKG 解出 4K 贴图（缓存）
node scripts/test-we.mjs 9333     # 单跑某个测试
```

### 6.3 三条硬红线（**违反必出隐蔽 bug**）

1. **重复 apply 必须幂等**：`applySkin` 每次把整段脚本重新 eval。新加的 `MutationObserver` /
   `setInterval` / 全局监听器 / DOM 节点必须在 `dispose()` 里收掉。
   **症状：第一次 `pause` 能还原，之后全失效。** 回归 `test-reapply-idempotent`。
2. **`applyMode` 绝不空刷深浅色 class**：`classList.toggle(cls, false)` 在类不存在时也会触发
   全量样式重匹配（~2600 规则 × ~3200 元素，实测白付 46.5ms）。先 `contains(cls) === want` 再写。
   回归 `test-theme-switch-perf`。
3. **`#root` 必须有 30px 顶栏偏移**（Windows），**macOS 必须排除**（`MENUBAR_HEIGHT = 0`）。

### 6.4 编码约定

- **`.ps1` 必须纯 ASCII**（PS 5.1 把无 BOM UTF-8 按 GBK 读，中文乱码破坏语法）
- **禁止写死绝对路径**（`test-scripts-registry` 会拦截）；用 `asar-path.mjs` 动态发现
- **不要用 renderer 的 canvas 处理图像**：CDP 超时后挂起的 `img.decode()` 会堵死解码队列，
  连带 `Page.captureScreenshot` 卡住。图像走 Python + Pillow
- **一次性脚本放 `scripts/archive/`**
- **修 bug 必须配"会变红"的反证**：先把修复改回去，确认测试真的红了，再恢复

### 6.5 详细资料的索引

| 想了解 | 看 |
|---|---|
| 架构与「改动 → 该跑哪个测试」映射 | `docs/ARCHITECTURE.md` |
| 已完成工作 / 发布规划 / 坑表 | `docs/HANDOFF.md`（另有 `HANDOFF-BRIEF.html` 速览页） |
| WE 集成的完整可行性分析 | `docs/WE-INTEGRATION.md` |
| 项目长期约定与踩坑结论（**改代码前建议通读**） | `.workbuddy-ai/memory/MEMORY.md` |
| 上述结论的详细展开 | `.workbuddy-ai/memory/reference.md` |
| 逐日工作日志 | `.workbuddy-ai/memory/2026-09-*.md` |

---

## 附：本机遗留的清理项

- **测试用缓存目录未删**：`D:\_we_cache_test`、`D:\_we_cache_test2`（合计约 2.3GB）。
  这是本轮验证时创建的临时缓存，**与插件无关，可直接删除**。
  （当时删除操作被沙箱安全策略拦截，未执行。）
- 真正的插件缓存在 `%LOCALAPPDATA%\anonbuddy-skin\we-cache`（32 条 / 141MB），
  这是**正常产物**，删掉只会导致下次重新解包。
