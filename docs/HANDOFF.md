# 交接总结 · ChihayaAnon 插件（AnonBuddy Skin）

> 面向「新开窗口继续开发」的自包含交接文档。
> 生成时间：2026-09-20　最后提交：`af81ba5`（**另有未提交改动**：外观护栏极性化 + 皮肤列表三列网格）
>
> **新窗口开工前请按顺序读三处**（本文只做总览，细节不重复）：
> 1. 本文 —— 已完成什么、现在在哪、接下来做什么
> 2. `docs/ARCHITECTURE.md` —— 架构全貌、改动→测试映射表、别改坏的不变量、写测试的规矩
> 3. `.workbuddy-ai/memory/MEMORY.md` + 最近 2~3 天日志 —— 长期约定与踩坑记录
>
> 把任务交给新窗口时，用 `docs/HANDOFF-PROMPT.md` 里的模板填空。

---

## 一、项目定位与当前状态

**一句话**：一个给 WorkBuddy 桌面端换肤的插件 —— 通过本机回环 CDP 往 renderer 注入 CSS + 一个 🎨 悬浮菜单，
**不改 `app.asar`**，随时可 `pause` 完整还原。

| 项 | 值 |
|---|---|
| 工作区 | `D:\anonbuddy-skin` |
| 版本 | `1.0.0` |
| 依赖 | **零运行时依赖**（只用 Node 内置模块），需要 Node 22 |
| 代码规模 | `src/` 13 个文件 / ~4400 行；`tools/repkg/` 内置 RePKG（MIT，3.7MB）；`scripts/` 55 个 `.mjs` + 7 个 `.ps1`（顶层；另有 `scripts/archive/` 归档） |
| 内置主题 | 3 个（`wuthering-echo` 深、`genshin-dawn` 浅、`aisu` 浅） |
| 测试 | **20 个 e2e（390 项断言）+ 4 个静态检查**（其中 3 个共 36 项断言，`lint-menu` 只报 OK） |
| 当前测试结果 | `npm run test:all` = **20/20 PASS**；`npm run test:static` = 4/4 PASS |
| 提交数 | 21 个；**本地领先 `origin/main` 13 个提交（未推送）** |
| 远程 | `https://github.com/cdredfox/anonbuddy-skin.git` |

> ⚠️ 远程当前访问返回 **502**，`gh` CLI **未安装** —— 推送前先确认网络与凭据。

---

## 二、已实现的功能点

### 1. 核心换肤
- **CDP 注入**：连接 WorkBuddy renderer（端口 **9333**，9223 曾被僵尸 socket 占用），
  注入 `<style>` + 悬浮 🎨 菜单；不改 `app.asar`，不重启进程。
- **`pause` 完整还原**：卸掉样式、菜单、文案替换、拆字动画，界面回到原生。
- **幂等**：`apply` 可反复执行（启动 / 换主题 / 测试都调它）。重复注入不会残留
  旧实例的 `MutationObserver` / `setInterval`。
- **主题恢复**：`apply --theme last` 恢复用户上次选的主题（**含自定义上传的主题**）。

### 2. 主题系统
- **主题格式极简**：`themes/<id>/theme.json`（`schemaVersion/id/name/hero/colors{accent,secondary,surface,text}`）
  + 一张 `hero.webp`。
- **自定义主题（上传图片）**：本地选图 → canvas 压缩 → 取色（饱和度加权主色 + 对比色）
  → 生成 CSS → 存 `localStorage`（**支持多张，互不覆盖**）。
- **右键重命名**：只改显示名不动磁盘；别名表独立存储。
- **右键删除**自定义主题。
- **旧数据迁移**：`workbuddyCustomTheme`（单主题）→ `workbuddyCustomThemes`（数组）。

### 3. 界面文案与特效
- **替换 i18n 文案**：侧边栏应用名 → `ChihayaAnon AI`；欢迎页主标题 → `探索未至之境`。
  （DOM 层改文本节点，React 重渲染会写回，所以用 `MutationObserver` 守着补。）
- **逐字打字动画**：主标题按字拆成 `<i>`，从左到右逐字出现（不是整行翻滚）；
  渐变跨字对齐（每字独立盒子会导致"每字重来"）。

### 4. 设置面板集成（插件名 **ChihayaAnon 插件**）
- 在 WorkBuddy 设置面板左侧「功能」分组下插入入口
  `button#anonbuddy-skin-menu-settings-entry`；
- 右侧内容区盖一层自己的面板 `div#anonbuddy-skin-menu-settings-pane`；
- 三区块：**皮肤列表** / **上传新皮肤** / **悬浮图标显隐开关**，外加 **外观调节**（两个 1–100 滑块：
  侧边栏毛玻璃强度、背景图模糊程度）。滑块只改 CSS 变量、不重建 `<style>`；
  为支持"背景图模糊"，hero 已从 `body` 的 background 挪进 `body::before` 图层。
- 皮肤列表是 **3 列网格**（2026-09-20 由单列改紧凑网格）：每格独立圆角卡片 +
  `gap:6px`，9 个主题正好 3×3，列表高度约减半。选中态 = 底色 + ✓ + 强调色描边。

### 5. 与 WorkBuddy 自带「外观（浅色/深色）」联动
- 切浅色系主题 → 外观自动浅色；切深色系 → 外观自动深色；
- **皮肤与外观必须同深浅：护栏锁住"与皮肤相反的那一侧"**（2026-09-20 由单向改为极性化）：
  - 浅色系主题生效期间**禁止切深色**；
  - 深色系主题生效期间**禁止切浅色**（深底皮肤配浅色外观会露出原生浅色底，显示异常）；
  - 三层护栏：视觉禁用 + 捕获拦截 + 轮询兜底；锁定侧记在 `<html data-wb-appearance-lock>`。
- 选「原生」时**完整交还控制权**（撤 `data-skin`、解护栏、恢复用户偏好）。

### 6. 工程化
- **跨机器零配置**：动态发现 WorkBuddy 安装路径（常见位置 → 注册表 → 开始菜单 → 运行中进程反推），
  可用 `WORKBUDDY_EXE` / `WORKBUDDY_ASAR` / `WORKBUDDY_SKIN_PORT` 覆盖；**代码里无硬编码绝对路径**。
- **Windows + macOS** 双平台（`MENUBAR_HEIGHT` 差异已处理）。
- **统一测试入口**：`npm test -- --suite <static|core|ui|menu|all>`。
- **AI 一键安装**：`SKILL.md` 描述让 AI 自动完成安装的流程。
- **主题可换图**：把正方形素材放进 `assets/menu-icon.*` 再 apply 一次即可换插件图标。

---

## 三、修改涉及的文件与模块

### 核心源码 `src/`

| 文件 | 行数 | 职责 |
|---|---|---|
| **`skin-menu.mjs`** | 1675 | ★ **注入脚本本体**（模板字符串）。菜单 UI、设置面板、外观联动、文案替换、拆字动画、自定义主题管理全在这。**改动必跑 `npm run lint`** |
| **`css/skin.css`** | 610 | ★ **皮肤 CSS 正文**（真实 `.css` 文件），10 个 `{{占位符}}` 由 `css-loader.mjs` 填充。**改样式只改这个文件** |
| `cdp-client.mjs` | 542 | CDP 连接封装（`CdpSession` / `fetchRendererTargets`） |
| `cli.mjs` | 150 | CLI 入口：`list / create / apply / pause / status / doctor` |
| `asar-path.mjs` | 147 | 跨机器动态发现 WorkBuddy 安装路径 |
| `theme-schema.mjs` | 135 | 主题校验（`theme.json` 的 schema） |
| `injector.mjs` | 132 | 组装 payload、读取图标素材、调用注入 |
| `theme-store.mjs` | 83 | 主题扫描与加载 |
| `skin-css.mjs` | 57 | 皮肤 CSS 生成（占位符填充） |
| `css-loader.mjs` | 51 | `.css` 文件 → 模板化 |
| `constants.mjs` | 29 | 默认主题 id 等常量 |

### 测试与工具 `scripts/`

| 文件 | 职责 |
|---|---|
| `run-tests.mjs` | 测试统一入口，套件定义（= 「改动→测试」映射表的代码形态） |
| **`_harness.mjs`** | ★ **测试公共仪器**：`createHarness()` 提供 `check/sleep/waitFor/evaluate/send/gotoHome/applyLast/loadMenuThemes/clearBlockingOverlays/currentThemeId/finish`。**新测试一律用它** |
| `lint-menu.mjs` | ★ 静态检查：模板字符串两类坑 + **作用域泄漏体检**（见第五节） |
| `asar-find.mjs` | 翻 `app.asar` 查原生实现（`file://` 页面 `styleSheets.cssRules` 跨源不可读） |
| `find-rule.mjs` / `sel-of.mjs` / `snapshot-chain.mjs` | 诊断三件套：查规则 / 查变量使用者 / 抓祖先链快照做差分 |
| `workbuddy-path.ps1` 等 7 个 `.ps1` | 路径发现、应用、暂停、自动换肤。**必须纯 ASCII** |

### 文档

| 文件 | 用途 |
|---|---|
| `docs/ARCHITECTURE.md` | ★ 面向维护者：架构、映射表、不变量、写测试规矩、已知问题 |
| `docs/HANDOFF.md` | 本文（交接总结） |
| `docs/HANDOFF-BRIEF.html` | 本文的**结构化速览页**（单文件 HTML，深色主题，可直接浏览/打印） |
| `docs/WE-INTEGRATION.md` | **Wallpaper Engine 集成**：可行性分析 + 实现说明（内置 RePKG） |
| `docs/HANDOVER-FOR-AGENT.md` | **交给其他 agent 的交接文档**：架构定位 / 已完成未完成 / 已知 bug（含复现条件与影响范围）/ 风险与待确认 / 修补优先级 / 接手须知 |
| `docs/HANDOFF-PROMPT.md` | 交给新窗口的**填空模板** |
| `README.md` | 面向使用者 |
| `SKILL.md` | 面向 AI 的自动安装流程 |
| `.workbuddy-ai/memory/` | 长期约定 `MEMORY.md` + 每日日志（**不进仓库**） |

---

## 四、关键代码结构与配置说明

### 4.1 数据流（单向，这是最重要的约束）

```
Node 端 (apply-now.mjs → src/cli.mjs apply)
   │  读取 themes/<id>/theme.json + hero.webp
   │  填充 src/css/skin.css 的 10 个 {{占位符}}
   │  组装 payload（主题列表 / 菜单 id / 插件名 / 图标 dataURL / 默认色 …）
   ▼
buildSkinMenuScript(payload) → 一整段模板字符串
   │  经 CDP Runtime.evaluate 在 renderer 里 eval
   ▼
renderer 端（注入脚本执行）
   · 写 <style>（皮肤 CSS）
   · 建 🎨 悬浮菜单 + 右键菜单
   · 建设置面板入口与面板
   · 守 i18n 文案、拆标题做打字动画
   · applyMode() 决定深浅 + 同步外观联动
   ▼
localStorage（**唯一**的持久化通道）
```

> ⚠️ **注入是单向的：renderer 无法回写 Node。** 任何需要持久化的状态只能进 `localStorage`。

### 4.2 `localStorage` 键（插件的全部状态）

| 键 | 内容 |
|---|---|
| `anonbuddySkinLastTheme` | 上次用的主题 id（`__native__` = 原生） |
| `workbuddyCustomThemes` | 自定义主题数组 `[{id,name,dataUrl,colors}]` |
| `anonbuddySkinAliases` | 显示名别名表 `{id: 别名}` |
| `anonbuddySkinMenuPos` | 🎨 图标位置，**贴边锚点格式** `{ax:"left"\|"right", dx, y}` |
| `anonbuddySkinIconHidden` | 悬浮图标显隐 `"1"` / `"0"` |
| `workbuddyCustomTheme` | **旧版遗留**，首次运行迁移后删除，勿再用 |

外观联动还会读写 WorkBuddy **原生**的键（不是我们的，但必须理解）：
`workbuddy.appearance.mode::<accountType>::<eid>::<uid>`（账号维度偏好）、`agent-ui-theme`（旧版全局）。

### 4.3 `applyMode()` —— 所有主题切换的唯一汇合点

```
菜单点主题 / 设置面板点行 / 上传自定义图 / 清空皮肤
        └──────────────┬──────────────┘
                       ▼
            applyMode(surface)          ← 由主题底色判定深浅
              ├─ 写 body/html 的 light|cb-light|vscode-light（或 dark 三件套）
              ├─ 写 body[data-vscode-theme-kind] / [data-vscode-theme-name]
              ├─ 写 html[data-theme] / html.style.colorScheme
              └─ syncAppearance(dark)   ← 外观联动（仅 skinOwned 时）
                    ├─ 打 <html data-skin="wb-skin-studio">（声明接管，原生让位）
                    ├─ 写账号维度 mode key（持久化）
                    ├─ 调原生 overrideThemeForSkin(mode)（让 useTheme 跟随）
                    └─ enforceLightGuard(!dark)（浅色时锁住深色）
```

**两个必须记住的点**：
1. **`data-skin` 是原生给的现成契约** —— 打上它，原生 `ThemeManager` 就停止自写深浅。
   这实现了"覆盖在原生外观逻辑之上"，**不需要猴子补丁任何原生函数**。
2. **类名仍由 `applyMode()` 自己写**，不能交给原生 —— `skin.css` 里原生深色规则的选择器
   都带 `body.vscode-light` / `body.cb-light`，交给原生写深色会让皮肤自己的 `.vscode-dark` 反过来命中。

### 4.4 设置面板的三条约束（踩过坑）
1. 导航栏是 React 渲染的会被重建 → 必须 `MutationObserver` + interval 守着补；
2. 不能"接管"右侧面板（要 React 路由）→ 只能把原生面板 `display:none` 后盖上去，
   点别的导航项（捕获阶段 click）自动收起；
3. **面板配色必须读弹窗自身底色，不能跟皮肤主题走**
   （深色皮肤 → 浅色文字 → 白弹窗上白字白底 → 面板看起来是空的）。

### 4.5 主题格式

```json
{
  "schemaVersion": 1,
  "id": "wuthering-echo",
  "name": "鸣潮 · 共鸣",
  "hero": "hero.webp",
  "colors": { "accent": "#56e0d8", "secondary": "#a98fe8", "surface": "#16121f", "text": "#e4def2" }
}
```

### 4.6 常用命令

```bash
npm run apply              # 应用皮肤（默认主题）
npm run apply:theme -- <id>  # 指定主题
npm run pause              # 完整还原
npm run status             # 查看状态
npm run lint               # ★ 改了 skin-menu.mjs 必跑
npm test                   # static + core（日常改动跑这个）
npm run test:all           # 全量 e2e（发版前）
npm run test:list          # 看套件与用例（含"为什么这个用例存在"）
```

---

## 五、当前存在的问题 / 待办事项

### 5.1 已修复但值得记住的两类坑

| 坑 | 症状 | 根因 | 守卫 |
|---|---|---|---|
| **作用域泄漏**（`8f244e7`） | 切「原生」后点设置面板的插件条目**毫无反应** | `syncPaneThemeVars()` 的强调色兜底链最后一级直接引用了 Node 侧常量 `DEFAULT_ACCENT`，renderer 里不存在 → 运行时 `ReferenceError`，被 click 处理器吞掉 | `lint-menu.mjs` 新增**作用域泄漏体检**（把模板外的模块作用域声明名逐个扫产物） |
| **空刷 class 卡顿**（`b008c10`） | 切深色主题卡 55~65ms，严重时主线程卡死 | `classList.toggle(cls, false)` 在类不存在时什么都不改却照样触发全量样式重匹配（~2600 条规则 × ~3200 元素） | `syncModeClasses()` 先 `contains(cls) === want` 就 `continue`；回归 `test-theme-switch-perf` |
| **空跑断言**（2026-09-20） | 「点击被拦」这类断言即使把拦截代码删掉也照样 PASS | 皮肤接管期间原生本来就被 `data-skin` 挡住，外观**不会变** → 只断言"外观没变"测不出有没有拦截 | 测试里装**冒泡阶段探针**：捕获阶段 `stopImmediatePropagation` 会掐断整条链 → 计数 0；放行 ≥ 1。⚠️ 探针必须盯 `pointerdown`，`click` 恒为 0（浮层在 pointerdown 上就自己关了） |
| **切主题后自带外观不刷新**（2026-09-20） | 在插件设置里切主题，自带外观深浅不对，**点一下左下角个人中心才变正常** | `applyMode` **漏写 `html[data-theme]`** —— 原生写它的入口 `ThemeManager.applyTheme` 见到 `data-skin` 会提前 return，于是皮肤接管期间没人写它，它停在接管前的旧值，靠它取色的自带 UI 要等 React 重渲染才更新 | `applyMode` 把四项输出**写全**（类名 / `data-vscode-theme-kind` / `-name` / `data-theme` / `colorScheme`）；回归 `test-appearance-linkage` + `test-settings-panel` 6b 节 |
| **RePKG 解包残留吃掉 2GB**（2026-09-20） | 缓存目录膨胀到 2.2GB | 解包中间产物 `raw/`（tex 原件 + 其余贴图）没清干净：进程被杀时走不到清理那一行 | `try/finally` 收尾 + `sweepStrayRaw()` 启动时扫残留。⚠️ 只留 `hero.png` 时 27 个条目才 125MB |
| **`-e png` 一张都解不出来**（2026-09-20） | RePKG 跑完但产物为空 | pkg 里贴图的**原扩展名是 `.tex`**，`-e png` 匹配不到任何条目；RePKG 是"提取 tex 时顺手转 png" | 必须写 `-e tex` |
| **WE 条目翻倍**（2026-09-20） | 盘点出 76 条，实际只有 38 条 | Windows 路径大小写不敏感，`D://Steam` 与 `D://steam` 是同一目录，候选列表里两种写法都命中 | 路径比较统一走 `pathKey()`（win32 下转小写） |
| **有 `<video>` 时截图卡死**（2026-09-20） | `Page.captureScreenshot` 超时，连带用截图做断言的测试挂掉 | 背景层挂着 `<video>`（硬件解码面）时 CDP 截图读回会卡；`fromSurface:false` 能返回但采不到视频层 | 截图类测试必须在"无视频"状态下跑 —— `test-we` 收尾强制切回普通主题；需要截图时先 `visibility:hidden` 视频 |
| **面板变量白算**（2026-09-20） | 「重复应用同一主题」从 ~0ms 涨到 53.8ms | `applyMode` 末尾新增的 `refreshPaneChrome()` 无条件往面板写 7 个自定义属性 → 面板子树（弹窗 2700+ 元素）样式失效 | **始终重算、只在值变了才写**。⚠️ 不能改成"面板没显示就跳过"——那样面板关闭期间切主题强调色会停在旧值 |
| **背景图整个看不见**（2026-09-20） | 计算样式全对，但背景图完全不可见；拖"背景图模糊"也几乎无视觉变化（整屏 PNG 只差 34/160000 字节） | hero 放在负 z-index 图层里，而 `html` 有原生不透明白底 → `body` 的背景不再"上交给画布"，作为普通元素背景在绘制第 3 步绘制，**晚于**负 z-index 图层的第 2 步 → 把图层整个盖住 | `body` 改 `transparent`，底色挪进图层自身。回归 `test-tunables` 的**像素级**断言（显示/隐藏比值 > 1.5） |
| **拖滑块卡顿 ~33fps**（2026-09-20） | 拖动两个调节项明显掉帧 | 值写在 html 的自定义属性上 —— 在 html 上 `setProperty` 写**任何**自定义属性（哪怕没人用）都会触发全文档重算（2269 元素 ≈ 23ms/次） | 改成写真实元素的内联样式（`filter`/`inset`/`backdrop-filter`）→ 0ms。⚠️ 顺带发现：弹窗打开时改**任意文本**要 29ms，所以数字读数改成松手才刷新 |
| **面板配色停在打开那一刻**（2026-09-20） | 面板开着时切主题，面板自身配色不跟着变（深色弹窗配浅色变量 → 浅字压白底，像空的） | 面板的 `--wb-pane-*` 是按「弹窗自身底色」算的，而它只在 `openPluginPane()` 里算一次 | `applyMode()` 末尾调 `refreshPaneChrome()` 重算。⚠️ 钩子要**前置声明成空函数**，否则撞 `const` 的 TDZ（`applyMode` 初始化阶段就会跑） |

### 5.2 当前无失败测试，但有以下**已知非回归项**

这三个测试在**干净工作区**（`git stash` 后）同样会红，属本机数据/环境问题，**别重复排查**：

| 测试 | 现象 | 判断依据 |
|---|---|---|
| `test-window-layout` | 「当前贴边距离与存储的锚点一致」`59 vs dx=21` | `anonbuddySkinMenuPos` 里的锚点与实际渲染位置不一致（历史数据）。**当前已通过**（图标位置被调整过） |
| `test-menu-icon` / `test-drag` | `AFTER=null`、`saved=null` | `anonbuddySkinMenuPos` 为 `null` 时拖拽后查询图标元素返回空。**当前已通过** |

> 判定方法：`git stash` → `node apply-now.mjs` → 单跑该测试。干净树也红 = 环境问题。

### 5.3 待办 / 未做的事

- [ ] **推送到 GitHub**：本地领先 13 个提交未推送（远程当前 502，`gh` 未安装）。
- [ ] **仓库改名**：现名 `anonbuddy-skin`，用户希望项目名统一为 **ChihayaAnon 插件**
      （应用内显示名已经是「ChihayaAnon 插件」，但仓库名 / `package.json` 的 `name` 还是旧的）。
- [ ] **README 英文版**：目前只有中文版，公开前建议补。
- [ ] **主题包导入/导出**：现在自定义主题只能存在本机 `localStorage`，无法分享。
      有个隐患：单主题 base64 可能几百 KB，接近配额（已做了配额超限的降级提示）。
- [ ] **macOS 实机验证**：代码已处理 `MENUBAR_HEIGHT` 差异，但主要在 Windows 上验证。
- [ ] **`scripts/` 目录整理**：55 个 `.mjs` 里有一批一次性审计脚本（`audit-*.mjs`、`clean-*.mjs`、
      `_diag-*.mjs` 等）已挪到 `scripts/archive/`，但仍有可进一步收敛的空间。

---

## 六、面向长期维护与 GitHub 发布的规划建议

### 6.1 命名统一（用户要求：项目名 **ChihayaAnon 插件**）

当前三处名字不一致，建议一次对齐：

| 位置 | 现状 | 建议 |
|---|---|---|
| 应用内显示名 | ✅ `ChihayaAnon 插件` | 保持 |
| GitHub 仓库名 | `anonbuddy-skin` | 建议改为 `chihaya-anon-skin`（GitHub 仓库名不支持中文，用拼音/英文） |
| `package.json` 的 `name` | `anonbuddy-skin` | 同上改齐 |

> ⚠️ **改 GitHub 仓库名必须在 GitHub 网页端操作**（`Settings → Repository name`），
> 或装 `gh` 后 `gh repo rename`。改完要同步本地远程地址：
> `git remote set-url origin <新地址>`（GitHub 会自动重定向旧地址，但别长期依赖）。
> 这一步需要主人的账号权限，**AI 代做不了**。

### 6.2 发布前检查清单

```bash
npm run test:all        # 18/18 全绿
npm run test:static     # 4/4 全绿
git status              # 干净
```

- [ ] **确认没把大文件带进仓库**：历史上出现过 `themes-removed/` 被跟踪、`outputs/` 19M 入库的问题。
      现在 `.gitignore` 已覆盖 `outputs/`、`cleanup-audit/`、`backup-desktop-scripts/`、`bat-src/`、
      `themes-removed/`、`.workbuddy-ai/`（含本机路径，不能公开）。**改 `.gitignore` 后务必 `git status` 复查。**
- [ ] **确认无硬编码本机路径**：`test-scripts-registry` 会拦截回归。
- [ ] **确认 `.ps1` 全是纯 ASCII**：`npm run test:static` 逐字节检查。
- [ ] **License 已在**（MIT）。
- [ ] **首次推送**：`git push -u origin main`（本地领先 13 个提交）。

### 6.3 建议的长期仓库结构

```
README.md              # 使用者入口（中文，可加 README.en.md）
SKILL.md               # AI 自动安装流程
LICENSE
docs/
  ARCHITECTURE.md      # 维护者入口（架构 + 映射表 + 不变量）
  HANDOFF.md           # 交接总结（本文）
  HANDOFF-PROMPT.md    # 新窗口交接模板
src/                   # 核心源码（含 css/skin.css）
themes/                # 内置主题
scripts/               # 工具与测试（archive/ 放一次性脚本）
assets/                # 插件图标素材
```

### 6.4 维护节奏建议

- **日常改动**：只跑 `npm test`（static + core），秒级~40s。不要无脑跑全量 e2e。
- **改 CSS / 布局**：加跑 `--suite ui`。
- **发版前**：`npm run test:all`。
- **每次修 bug 都先写回归测试**，并**反证它会变红**（把 bug 写回去看测试是否 FAIL）——
  本项目的每个关键测试都做过这个验证，这是防止"空跑测试"的唯一可靠手段。

---

## 七、后续继续修改时需要关注的重点

### 7.1 改之前必看的红线

1. **`src/skin-menu.mjs` 是模板字符串** —— 两类写法会静默弄坏它：
   - 注释里出现**反引号** → 模板提前截断；
   - **正则里的反斜杠被吃掉一层**（`\s`→`s`、`\(`→`(`）→ `Unterminated group`。
     模板内正则要写**双反斜杠**，或用 `[0-9]` 这类字符类绕开。
   - **改完必跑 `npm run lint`**（会明确指出行号）。
2. **不要直接引用 Node 端作用域的东西**（模块级常量、`import` 进来的东西）——
   注入脚本在 renderer 里 eval，读不到。**要传值就加进 `buildSkinMenuScript` 的 payload，用 `data.xxx` 读**。
   漏了会变成运行时 `ReferenceError`（语法检查抓不到），表现为"点了没反应"。
   `npm run lint` 已有守卫。
3. **重复 `apply` 必须幂等**：新加 `MutationObserver` / `setInterval` / 全局监听器时，
   一定要在 `dispose()` 里收掉，并让排队回调读 `stopped` 变空操作。
   否则旧实例会持续捣乱（表现：第一次 `pause` 有效、之后全失效）。
   回归 `test-reapply-idempotent`。
4. **`applyMode()` 不许空刷深浅色 class** —— 见 5.1。改它必跑 `test-theme-switch-perf`。
5. **`applyMode()` 必须把「原生会写、我们接管了」的输出全部写全**：类名三件套、`body[data-vscode-theme-kind]`、
   `body[data-vscode-theme-name]`、**`html[data-theme]`**、`html.style.colorScheme`。漏一个就会停在接管前的旧值
   （原生那条路径被 `data-skin` 提前 return 掉了）。**这是"切主题后界面不刷新"的典型根因** —— 见 5.1。
6. **`.ps1` 必须纯 ASCII**（PS 5.1 读无 BOM UTF-8 按 GBK 解析，中文乱码破坏语法）。
7. **不要用 renderer 的 canvas 做图像处理**：CDP 超时后挂起的 `img.decode()` 会堵死解码队列，
   连带 `Page.captureScreenshot` 卡住。图像一律走 Python + Pillow。

### 7.2 布局不变量（改 CSS 前读）

- `#root` 必须有 **30px 顶栏偏移**（Windows），**macOS 必须排除**。
- 侧边栏 sticky 行**必须有不透明实底**，且**不能用 `backdrop-filter` 磨砂遮**
  （侧边栏自身已带 `blur(24px)`，会给后代建立新 backdrop root，后代磨砂直接失效）；
  悬停/选中一律用 `background-image` 叠渐变，**绝不改 `background-color`**。
- 图标位置存**贴边锚点**不是绝对坐标（存绝对 x 的话窗口缩小会被夹到边缘并写回）。
- 凡是给某类元素加 `!important` 透明的规则，**先想会不会误伤 portal 浮层**
  （React portal 挂在 `<body>` 下，`body > *` 这种宽规则会把它们一起弄透明）。

### 7.3 测试相关

- **新写测试一律用 `scripts/_harness.mjs`**，不要抄 CDP 连接和 `check()`（`test-scripts-registry` 会拦截）。
- **测试之间不许互相踩**：造成全屏遮罩的测试收尾必须关掉并断言已关
  （新增遮罩选择器要加进 `BLOCKING_OVERLAYS`）。
- **除了界面，还要还原被你改过的 `localStorage` 键**：`setTheme` 会写 `anonbuddySkinLastTheme`，
  而很多测试用 `applyLast()` 还原，读的正是这个键。顺序：**先按已知主题显式还原、再把快照写回**。
- **`finish()` 会关闭 CDP 会话**，之后 `currentThemeId()` 返回 `null` → 断言要在 `finish()` 之前。
- **别死等固定时长**，用 `waitFor(fn, { waitMs, stepMs })` 条件轮询。
- 弹浮层要用真鼠标事件（`Input.dispatchMouseEvent`），DOM `.click()` 不可靠。
- **每次修 bug 都要反证测试会变红**。
- ⚠️ **当心"空跑断言"**：只断言"最终状态没变"往往测不出拦截逻辑有没有生效
  （皮肤接管期间原生本来就被 `data-skin` 挡住）。要断言**中间过程**——
  例：外观护栏测试在被观测页装冒泡阶段探针，数 `pointerdown` 有没有到达目标。

### 7.4 诊断手法速查

```bash
# 差分定位：判断"是不是皮肤造成的"
npm run pause && node scripts/snapshot-chain.mjs before.json
node apply-now.mjs && node scripts/snapshot-chain.mjs after.json
# 逐属性 diff

# 定位"哪条规则改了这个属性"
node scripts/find-rule.mjs ".wb-home-header__title" color

# 查 WorkBuddy 原生实现（file:// 页面跨源，只能翻 asar）
node scripts/asar-find.mjs "关键词"

# 查变量使用者
node scripts/sel-of.mjs "var(--wb-bg-content)"
```

---

## 八、新窗口开工指引

1. **先读**：本文 → `docs/ARCHITECTURE.md` → `.workbuddy-ai/memory/MEMORY.md` + 最近日志。
2. **确认环境**：WorkBuddy 是否在运行（e2e 依赖真实进程）；没在跑就先说一声。
3. **看改动→测试映射表**（`docs/ARCHITECTURE.md` 第二节），只跑相关的那一组。
4. **改 `skin-menu.mjs` 后必跑 `npm run lint`**。
5. **完成后**：更新 `docs/ARCHITECTURE.md` 对应章节 + `.workbuddy-ai/memory/` 日志，然后提交。

> 交接时用 `docs/HANDOFF-PROMPT.md` 的模板：写清「上一轮完成到哪 / 本次要做什么 / 验收标准 / 已知的坑」，
> **不要粘贴大段代码或日志** —— 写路径和现象，让下一个 AI 自己去读。
