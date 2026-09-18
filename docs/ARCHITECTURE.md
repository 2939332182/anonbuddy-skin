# 架构与迭代手册

面向**维护者**（含 AI 助手）。README 讲怎么用，这里讲**怎么安全地改**。

---

## 一、整体结构

```
workbuddy-skin-studio/
├── src/
│   ├── cli.mjs            # 命令入口：help / list / create / apply / pause / status / doctor
│   ├── injector.mjs       # 编排：读主题 → 生成 CSS+脚本 → 通过 CDP 推给 renderer
│   ├── skin-css.mjs       # 生成皮肤 CSS（正文在 css/skin.css，这里只做占位符填充）
│   ├── css/
│   │   └── skin.css       # ★ 样式正文（真实 .css 文件，可高亮 / 可 lint）
│   ├── css-loader.mjs     # {{占位符}} 模板填充（带缓存 + 缺值报错）
│   ├── skin-menu.mjs      # 生成注入脚本（🎨 菜单 + 文案替换 + 逐字动画）
│   ├── cdp-client.mjs     # 极简 CDP 客户端（WebSocket + evaluate + 事件）
│   ├── theme-store.mjs    # 磁盘主题的发现与加载
│   ├── theme-schema.mjs   # theme.json 校验 + 取色
│   ├── asar-path.mjs      # 定位 app.asar（跨机器，不硬编码）
│   └── constants.mjs      # 端口、URL 特征等常量
├── scripts/
│   ├── run-tests.mjs      # ★ 统一测试入口（套件 = 改动 → 该跑什么 的映射表）
│   ├── _harness.mjs       # ★ 测试公共仪器（连接/断言/轮询/状态还原）
│   ├── lint-menu.mjs      # 生成物静态校验
│   ├── test-*.mjs         # 回归测试（见第五节）
│   ├── workbuddy-path.ps1 # 跨机器的 WorkBuddy 发现（PS 脚本共用）
│   └── archive/           # 已完成使命的一次性脚本
├── themes/<id>/           # 内置主题：theme.json + hero.webp
├── assets/menu-icon.*     # 插件图标素材（放进去再 apply 一次即生效）
└── docs/                  # 截图等
```

**数据流**：

```
theme.json ─┐
hero.webp  ─┼─> injector.applySkin
            │      ├─> buildSkinCss   ──> src/css/skin.css + {{占位符}}  → CSS 文本
            │      └─> buildSkinMenuScript ──> 注入脚本（IIFE 字符串）
            │
            └─> cdp-client: Runtime.evaluate(注入脚本) + Page.addStyleTag(CSS)
                     ↓
                renderer（file:// 页面，无 Node 权限）
```

**单向注入**：renderer 无法回写 Node。所有需要跨重启保留的状态只能放 `localStorage`：

| 键 | 内容 |
|---|---|
| `workbuddyCustomThemes` | 用户上传的自定义主题数组（含 dataURL） |
| `workbuddySkinLastTheme` | 上次选用的主题 id（`__native__` = 原生界面） |
| `workbuddySkinMenuPos` | 图标位置，**贴边锚点** `{ax,dx,y}` |
| `workbuddySkinAliases` | 显示名别名表（只改显示名，不动磁盘） |
| `workbuddySkinIconHidden` | 悬浮图标是否隐藏（`"1"`/`"0"`；设置面板里的开关） |
| `workbuddyCustomTheme` | **旧版遗留**，首次运行会迁移进 `workbuddyCustomThemes` 后删除 |

---

## 二、改动 → 该跑哪些测试（核心表）

**这是本仓库降低回归成本的关键**：绝大多数改动只需要跑对应的一小组，不必全量 e2e。

| 你改了什么 | 跑什么 | 耗时 |
|---|---|---|
| 只改 `src/css/skin.css` 的样式值 | `npm run test:static` → 再抽跑相关一项 e2e | 秒级 |
| 改 `skin.css` 的布局规则（sticky / offset / 玻璃） | `npm run test:static` + `--suite ui` | ~30s |
| 改 `skin-menu.mjs` 的文案或动画 | `npm run lint` + `--suite core` | ~40s |
| 改 `injector.mjs` / `removeSkin` / 收尾逻辑 | `--suite core`（**必须**，含幂等回归） | ~40s |
| 改菜单交互（重命名/删除/上传/拖动） | `--suite menu` | ~30s |
| 改**设置面板集成**（插件条目 / 面板皮肤列表 / 悬浮图标开关） | `--suite ui`（含 `test-settings-panel`） | ~35s |
| 改 `applyMode` / 深浅色类切换 / 设置界面配色 | `--suite ui`（含 `test-theme-switch-perf`） | ~45s |
| 改**浮层底色或文字色**（个人中心菜单 / 下拉 / 右键菜单） | `--suite ui`（含 `test-popover-contrast`，**必须**） | ~60s |
| 改**外观联动**（`applyMode` / `data-skin` 契约 / 浅色禁用深色 / 交还控制权） | `--suite ui`（含 `test-appearance-linkage`，**必须**） | ~50s |
| 改 `scripts/*.ps1` | `npm run test:static` | 秒级 |
| 改 `package.json` / 新增脚本 | `npm run test:static` | 秒级 |
| 发版前 / 大重构 | `npm run test:all` | ~2min |

```bash
npm test              # static + core（日常改动跑这个就够）
npm run test:static   # 不连 renderer，随时可跑
npm run test:core     # 注入 / 还原 / 幂等 / 标题 / 图标
npm run test:ui        # 布局与视觉
npm run test:menu      # 菜单交互
npm run test:all       # 全部
npm run test:list      # 看套件与用例（含"为什么这个用例存在"）
```

> e2e 依赖**真实运行中的 WorkBuddy**。没在跑时该套件会整段 `SKIP`（不算失败），
> 端口用 `WORKBUDDY_SKIN_PORT` 覆盖。

---

## 三、两条硬性规矩

### 1. `.ps1` 必须纯 ASCII

PowerShell 5.1 读**无 BOM 的 UTF-8** 时按 GBK 解析，中文注释会破坏语法（踩过）。
`npm run test:static` 会逐个字节检查，非 ASCII 直接 FAIL。注释一律写英文。

> `${env:ProgramFiles(x86)}` 必须加花括号（否则 PS 把 `(x86)` 当语法）。
> `ForEach-Object` 里的 `return` 只结束**当前迭代**，不是"找到就返回"。

### 2. 注入脚本仍是模板字符串 —— 两类写法会把它弄坏

`buildSkinMenuScript` 返回**一整坨模板字符串**。模板字面量会做转义处理，所以有**两个**雷区：

**(a) 注释里出现反引号** —— 字符串被静默截断，产物只剩前半段，报错信息很难懂（踩过 3 次）。

**(b) 正则里的反斜杠被吃掉一层** —— 模板字面量会先把 `\s` 解析成 `s`、`\(` 解析成 `(`，
于是生成的正则语法错误（`Invalid regular expression: ... Unterminated group`）。踩过一次。
在模板内写正则要用**双反斜杠**，或干脆用 `[0-9]` 这类字符类绕开。同文件里已有的正确写法：

```js
// 模板内：\\. 会生成 \.  ✓
file.name.replace(/\\.[a-z0-9]+$/i, "")
// 模板内：[0-9] 不需要转义，最稳  ✓
const m = /rgba?\\(([0-9]+), ([0-9]+), ([0-9]+)/.exec(bg)
```

**CSS 已经不再有这个问题**（正文移到了 `src/css/skin.css`）。
但注入脚本还在，所以改完 `skin-menu.mjs` **务必先跑**：

```bash
npm run lint     # 语法解析 + 花括号配平 + 关键实现存在性 + 占位符登记
```

`lint-menu.mjs` 同时校验：
- 注入脚本能被 `new Function()` 解析（会明确提示上面两类写法）
- `skin.css` 源文件花括号配平 / 无残留 `${}` / 占位符都已登记
- 产物里关键能力（右键菜单、重命名、拆字、渐变对齐、设置面板、`dispose`/`stopped`）没被误删
- **标题绝不声明 `font-size`**（必须跟随用户的字号设置）

---

## 三·五、设置面板集成（ChihayaAnon 插件）

插件在 WorkBuddy 设置面板里有一个自己的页面。入口与内容都由注入脚本创建，
**不修改 `app.asar`**，卸载皮肤时一并移除。

### 结构（都是原生锚点，不是哈希类名）

| 元素 | 选择器 / id | 说明 |
|---|---|---|
| 设置弹窗根 | `.settings-modal-overlay` | 打开才存在 |
| 左侧导航 | `.settings-navigation` | React 每次打开都会重建 |
| 分组 | `.settings-navigation__group` + `__group-title` | 我们插进「功能」分组 |
| 我们的条目 | `#workbuddy-skin-menu-settings-entry` | `button.settings-navigation__item` |
| 右侧内容区 | `.settings-modal__content` | 原生面板与其同级 |
| 原生面板 | `.settings-modal__header` / `.settings-modal__panel` | 我们**只隐藏不删除**（React 要管） |
| 我们的面板 | `#workbuddy-skin-menu-settings-pane` | `data-wb-plugin-pane="1"` 作孤儿标记 |

### 三条必须知道的约束

1. **导航栏是 React 渲染的，会被重建**。我们插的条目每次打开设置都会被回收，
   所以用 `MutationObserver` + 1.2s `setInterval` 守着补（`ensureSettingsEntry` 幂等）。
2. **不能"接管"右侧面板**（那需要 React 路由）。做法是原生面板留在 DOM 里、只 `display:none`，
   我们的面板盖上去；用户点别的导航项时（导航栏 `click` 捕获阶段监听）自动收起。
3. **面板配色跟随"弹窗自身底色"，不是跟随皮肤主题**。设置弹窗是原生白色/深色实底，
   皮肤并不给它染色。踩过的坑：按皮肤主题取色 → 选中深色皮肤时把文字设成浅色 →
   白弹窗上白字白底 → **整个面板看起来是空的**。
   现在 `paneSurface()` 直接读 `.settings-modal__content` 的 `computedStyle.backgroundColor` 判断深浅。

### 悬浮图标开关

`localStorage["workbuddySkinIconHidden"]`（`"1"`/`"0"`）。隐藏后 `button.style.display = "none"`，
菜单面板与皮肤照常工作 —— 入口改从设置面板进。**关闭悬浮图标不会关闭皮肤。**

### 去重（踩过的坑）

`ensureSettingsEntry` 里有一段**按 id 全量扫描并删除孤儿节点**的防御代码。
原因：`dispose()` 只能清掉"当前实例变量里记着的那两个节点"，
旧版本脚本 / 异常中断留下的节点不在任何变量里，会在导航栏叠成两个同名条目、
内容区叠成两层列表（实测出现过 3 份）。新增注入物时记得同步加进这段扫描。

### ⚠️ 切主题的性能红线：applyMode 不许空刷 class（2026-09-19 实测）

**症状**：切到深色主题（如「鸣潮」）时明显卡顿、掉帧，严重时**整个渲染器主线程卡死**
（连 CDP `Runtime.enable` 都超时，只能 `Page.reload` 救回来）。

**根因**：`applyMode` 旧实现对 6 个深浅色类无条件 `classList.toggle(cls, force)`，
**同时刷 `body` 和 `html` 两个节点**。而 WorkBuddy 里有大量"祖先类 + 后代"规则：

    body.vscode-light .icon-xxx   ← 496 条
    body.cb-light     .icon-xxx   ← 474 条
    body.light        .icon-xxx   ← 487 条
    （深色三件套同类，合计约 2600 条）

每增删一个类，引擎都要把这些规则对整棵 DOM（~3200 个元素）重新匹配一遍。
致命的是：`classList.toggle(cls, false)` 在**类本来就不存在**时什么都没改，
浏览器却照样把它当一次 mutation 去失效样式 —— 纯属白付钱。

**实测量化**（同一页面、同一条件下对照）：

| 操作 | 耗时 |
|---|---|
| 移除 `light` 三件套（body） | **46.5ms** |
| 再加回来（已存在，真 no-op） | 0.1ms |
| 单个 `light` / `vscode-light` / `cb-light` 各刷一次 | ~50ms each |
| 一次完整 `setTheme`（修复前） | **55~65ms** |
| 一次完整 `setTheme`（修复后） | **~18ms** |
| 连续切 30 次（修复前） | 可把主线程卡死 |
| 连续切 30 次（修复后） | 最坏 31.5ms、均值 20ms，渲染器始终响应 |

> 注：`~43ms` 是 **WorkBuddy 自身的固有开销**（把皮肤整个卸掉再测，移除那三个类仍要 43ms），
> 皮肤只额外放大约 5ms。所以这块不可能完全消除，只能避免"不必要的触发"。

**修法**（`src/skin-menu.mjs`）：合并成 `MODE_CLASSES` + `syncModeClasses(el, dark)`，
**先判断 `classList.contains(cls) === want`，命中就直接 `continue`，完全不碰 DOM**；
`body` 与 `html` 分别判断（两个节点各付一遍，原来合计占一半开销）；
`dataset` / `colorScheme` 同样先比对再写。
效果：状态已经正确时**零 DOM mutation**，往返切换的中位耗时从 22ms 降到 0ms。

**回归测试**：`scripts/test-theme-switch-perf.mjs`
（单次同步耗时中位 < 40ms、同主题重复应用接近零开销、连切 30 次最坏 < 90ms、
压力后渲染器仍响应、深色下设置界面文字对比度 ≥ 4.5:1）。

### 设置界面的可读性兜底

原生 `.settings-modal-overlay` 的 `background` 是**透明的**、`.settings-navigation`
**也没有底色** —— 弹窗整体直接压在深色皮肤的主界面（背景图 + 深色底）上。
浅色模式下 `.settings-modal__content` 自带 `rgb(247,247,247)` 实底所以看不出问题，
一旦内容区底色变透明，左侧导航与正文就会和背景图叠在一起 → 浅字压深底/花底，糊成一团。

`ensureModalSurface()` 做**条件性**兜底：只在检测到内容区 `background-color`
的 alpha < 0.9 时，才铺一层与内容区一致的实底（并给导航栏补底色），
同时打 `data-wb-pane-surface="1"` 标记避免覆盖原生内联样式。
**原生自己有实底时一律不插手**，免得画蛇添足。

### ⚠️ 浮层的"底色换了、文字色没换"（2026-09-19，只在深黑主题暴露）

**症状**：深黑主题下点左下角「个人中心」，弹出的菜单文字几乎看不见，看着像没渲染出来。

**根因**：皮肤给 `.user-menu-popover` 换了底色

    background: color-mix(in srgb, var(--wb-glass) 42%, var(--wb-surface)) !important;

深色主题下这算出 `#1a1e2a`（很暗）。但**浮层里的文字色从来没被改过** ——
原生把它写死在 `.user-menu-item-label` / `-value` 等具体类上是 `rgb(0,0,0)`。
黑字压暗底 → 对比度 **1.26:1**（几乎纯黑压纯黑）。

**为什么只在深色主题暴露**：浅色主题下 `--wb-surface` 是浅色，
黑字压浅底反而是 17~18:1，完全正常。**"只在深黑主题复现"就是这个原因** ——
同一个规则，底色方向变了，写死的文字色就翻车了。

**实测量化**（修复前）：

| 主题 | 浮层底色 | 文字色 | 对比度 |
|---|---|---|---|
| miku-488137（浅） | `#e8f3fb` | `rgb(0,0,0)` | 18.68 ✅ |
| genshin-dawn（浅） | `#e9eaf9` | `rgb(0,0,0)` | 17.64 ✅ |
| wuthering-echo（深） | `#1a1e2a` | `rgb(0,0,0)` | **1.26 ❌** |
| （顺带发现）次级文字 `rgba(0,0,0,.5)` | 浅底 | — | **3.87 ❌ 本来就不达标** |

**修法**：让浮层及其子树消费 `--wb-text`（每个主题都自带正确的 `text` 色，
`wuthering-echo` 是 `#e4def2`），用 `:where()` 把优先级压到 0 避免压过组件自己的状态色；
次级信息用 `color-mix(in srgb, var(--wb-text) 82%, transparent)` 保留层级感。

> ⚠️ 两个反直觉点，都是实测出来的：
> ① **不能往 `--wb-surface` 混** —— 那把前景拉向背景，对比度反而更差
> （genshin-dawn 从 4.37 掉到 3.13）。只能往 `transparent` 混。
> ② `color-mix(..., transparent)` 输出 `color(srgb r g b / a)`，**alpha 会参与合成**，
> 实际观感比预期更淡，比例要给得比直觉高。82% 是按最不利主题算出来的
> （78% 恰好 5.07 勉强过线，82% 留到 5.63）。

**修复后**：三个内置主题 + 5 个自定义主题，各 14 处文字全部 ≥ 4.5:1
（最差 genshin-dawn 5.64，wuthering-echo 从 1.26 → **8.90**）。

**回归测试**：`scripts/test-popover-contrast.mjs`
—— **遍历全部主题**（内置 + 自定义），每个主题逐元素算 WCAG 对比度。
以后上传任何深黑色主题都会被自动覆盖。
已用"注入样式复现原 bug"的方式验证过这个测试**真的会变红**（不是空跑）。

### ⚠️ 与 WorkBuddy 自带「外观（浅色/深色）」联动（2026-09-19）

**需求**：切浅色系皮肤 → 外观自动浅色；切深色系皮肤 → 外观自动深色；
浅色系皮肤生效期间**禁止**把外观切成深色。

**为什么必须联动**：皮肤与自带外观是两套独立系统，但**写同一批 DOM 输出**：

| 输出 | 谁在写 |
|---|---|
| `body` / `html` 的 `light`·`cb-light`·`vscode-light`（或 dark 三件套） | 原生 ThemeManager + 皮肤的 `applyMode()` |
| `body[data-vscode-theme-kind]` / `[data-vscode-theme-name]` | 同上（**注意 dataset 与 getAttribute 是同一个属性**） |
| `html[data-theme]` / `html.style.colorScheme` | 同上 |

同时生效就会打架：皮肤是浅色而原生是深色时，foundation 的 `.dark` 选择器
把深色 token 叠上来，**皮肤 CSS 明明加载了界面却发暗**。

**根因与现成接口（从 asar 反编译得到）**：WorkBuddy 自己也有一套「个性皮肤」，
而且已经定义了**皮肤优先于外观**的契约：

- `SkinManager.applyTheme()` → 写 `<html data-skin="<resourceKey>">` + `clearThemeClasses()`
- `ThemeManager.applyTheme({ skipWhenSkinActive: true })` → 见 `data-skin` 直接 return
- `ThemeManager` 的 `MutationObserver`（`syncThemeClassesFromAttribute`）→ 开头
  `if (document.documentElement.hasAttribute("data-skin")) return;`
- 还有公开方法 `overrideThemeForSkin(mode)`，通知 React 侧 `useTheme()` 跟随

**实测验证**（这是设计的地基，别凭猜测改）：

| 场景 | 原生观察器的行为 |
|---|---|
| **无** `data-skin`，手改 `body[data-vscode-theme-kind]` | **自动把类名同步过去**（自我修复看门狗） |
| **有** `data-skin`，同样的写入 | **被忽略**（提前 return，让位给皮肤） |
| **有** `data-skin`，只手改类名 | 我们的写入**不被回滚**（`applyMode` 安全） |

也就是说：**打下 `data-skin` 等于向原生声明"界面配色由皮肤接管"**，原生主动让位 ——
这就是"覆盖在原生外观逻辑之上"，而且**不需要猴子补丁任何原生函数**。

> ⚠️ 但类名**不能**交给原生去写深色：`skin.css` 里所有原生深色规则的选择器
> 都带 `body.vscode-light` / `body.cb-light`，原生写深色会让**皮肤自己的**
> `.vscode-dark` 规则反过来命中。
> 所以分工是：`data-skin` 只负责"关掉原生自动同步"，**真正的类名由 `applyMode()` 自写**。

**持久化**：原生把偏好存在账号维度 key
`workbuddy.appearance.mode::<accountType>::<eid>::<uid>`（本机实测值
`...::personal::personal::<uuid>`），旧版全局 key 是 `agent-ui-theme`。
**实测：直接写这个 key 不会驱动原生 UI**（key 变了、DOM 没动）——
它只是"下次冷启动读到什么"的持久化，**不是触发通道**。触发只能靠写 DOM/类名。

**实现落点**（都在 `src/skin-menu.mjs`）：

1. `syncAppearance(dark)` —— 在 `applyMode()` 末尾调用（`applyMode` 是**所有**主题切换路径的
   唯一汇合点：`setTheme` / `applyCustomTheme` / `clearTheme`）。依次做四件事：
   ① 打 `data-skin="wb-skin-studio"`；② 写账号维度 key；③ 调原生 `overrideThemeForSkin(mode)`；
   ④ 同步浅色护栏。
2. **浅色护栏**（`enforceLightGuard`）三层，缺一不可：
   - **视觉**：「深色」按钮加 `data-wb-light-lock="1"` + `opacity:.4` + `cursor:not-allowed` + `aria-disabled`
   - **行为**：捕获阶段监听 `pointerdown`/`click`，`stopImmediatePropagation` 吞掉
     ⚠️ **不能用 `pointer-events:none` 挡** —— 那样连捕获监听器也收不到事件，就没法区分
     "被禁用"和"点了没反应"；要的是"收得到但吞掉"
     （原生这两个按钮是纯 `<button>`，**没有 disabled 概念**，只能我们拦）
   - **兜底**：600ms 轮询，若 `data-vscode-theme-kind` 变成 `vscode-dark` 就 `applyMode` 按回去
     （只在浅色皮肤生效期间；否则会误伤用户自己在原生模式下的选择）
3. **交还控制权**（`releaseAppearanceOwnership`）—— 用户选「原生」时 `clearTheme()` 调用：
   撤 `data-skin`、解护栏、把 DOM 恢复成账号维度 key 里的深浅。
   ⚠️ **顺序必须反着来**：先解除接管再让原生写，否则会被我们的类名盖住。
   **这是联动最危险的副作用**：漏了它就再也切不动原生外观了。
4. 浮层按钮是 React portal，**每次打开都是新节点**：除了 600ms 轮询，
   还挂了一个只 `observe(document.body, {childList:true})`（**不 observe subtree**）
   的观察器，浮层一出现立刻刷按钮态，避免"刚打开就操作"的窗口期闪一下未同步状态。

**回归测试**：`scripts/test-appearance-linkage.mjs`（34 项断言）
覆盖：深色/浅色主题 → 外观跟随、类名无残留、持久化、护栏生效、点击被拦、
切深色后解禁、外部强改后自动纠回、`data-skin` 契约仍在、**选「原生」后交还控制权**。
已用"注释掉 `syncAppearance` 调用"的方式验证过它会**真变红**（5 项失败）。

> ⚠️ **跨测试干扰（踩过）**：`setTheme` 会顺带改写 `workbuddySkinLastTheme`，
> 而 `test-theme-switch-perf` 之类用 `applyLast()` 还原 —— 读的正是这个键。
> 新测试必须**快照并还原** `workbuddySkinLastTheme` 与账号维度 key，否则会把下一个测试的
> "起始主题"改成自己最后切到的那个。
> （同一个坑也让 `test-theme-switch-perf` 自己的还原断言潜伏失效了很久：
> 它中途 `setTheme(deepTheme)` 后再 `applyLast()`，还原到的是**自己刚切的**主题。
> 基线恰好是 `wuthering-echo` 时才碰巧通过 —— 已改成按 `initialTheme` 显式还原。）

---

## 四、别改坏的几个不变量

改布局/视觉前先读这几条，每条都是踩过坑才写下的：

1. **`#root` 需要 30px 顶栏偏移**（Windows）。缺了整界面上顶，侧边栏标题压在菜单栏上。
   macOS 必须排除（走原生红绿灯）。
2. **侧边栏 sticky 行（分组标题 / 工作区行）必须有不透明实底**，否则滚动的列表项穿透出两层文字。
   ⚠️ **不能用 `backdrop-filter` 磨砂遮** —— 侧边栏自身已带 `backdrop-filter`，
   会给后代建立新 backdrop root，后代磨砂直接失效。
   ⚠️ **悬停/选中只能用 `background-image` 叠渐变**，改 `background-color` 会让实底又变透明。
3. **图标位置存"贴边锚点"不存绝对坐标**。存绝对 x 的话窗口一缩小就被夹到边缘并写回，放大后回不去。
4. **凡是给"某类元素加 `!important` 透明"的规则，先想会不会误伤 portal 浮层**。
   React portal（个人中心菜单 / popover / modal）挂在 `<body>` 下，
   `body > *` 这种宽规则会把它们一起弄透明，菜单文字就和背景糊在一起。
5. **重复 `apply` 必须幂等**。`applySkin` 每次都把整段脚本重新 eval 一遍；
   脚本开头必须 `copy.stop()` + `dispose()` + `delete window.__workbuddySkin`，
   且 `dispose()` 要置 `stopped = true`。否则旧实例的 `MutationObserver` + `setInterval` 继续运行，
   表现是"第一次 pause 有效，之后全部失效"。由 `test-reapply-idempotent` 守着。

---

## 五、写测试的规矩

- **用公共 harness**：`import { createHarness } from "./_harness.mjs"`。
  它提供 `check / sleep / waitFor / evaluate / gotoHome / applyLast / loadMenuThemes / finish`，
  并保证连接一定被关闭。**不要**再自己抄一份 CDP 连接或 `check()`。
- **收尾放 `try/finally`，保证状态中性**：跑完的界面必须和跑之前一样
  （主题、localStorage、图标位置、临时加的 class 全部还原）。
  `test-scripts-registry` 会检查这一点。
- **别死等固定时长**。`await sleep(800)` 在渲染器繁忙时会把中间状态读成最终状态 ——
  同一套件连着跑 FAIL、单独跑 PASS（实测 5 轮复现的真 flakiness）。
  用 `t.waitFor(fn, { waitMs: 6000 })`。
- **别依赖前置状态**。"localStorage 里已有锚点"这种断言会在用户点过重置后假报失败；
  没有就自己造，收尾还原。
- **测试之间不许互相踩**：一个测试可能启动在上一个测试留下的界面状态上。
  最大的干扰源是**覆盖全屏的浮层** —— 它拦截指针事件，会让"点/悬停侧边栏某行"的断言
  静默命不中目标。已知案例：设置弹窗（`.settings-modal-overlay`）没关，
  导致 `test-hover` + `test-settings-panel` 一起挂。对策是**两层**：
  ① `_harness.mjs` 的 `createHarness()` 启动时调 `clearBlockingOverlays()`
     兜底清掉残留浮层（先 Esc、不行再对遮罩派发 `pointerdown`）——
     这让"跑整套"和"单跑一个"的前置状态一致，测试不再依赖执行顺序；
  ② 制造浮层的测试自己收尾关掉它并断言已关（`test-settings-panel` 的「收尾：设置面板已关闭」）。
  新增会开浮层的测试时，记得把选择器加进 `BLOCKING_OVERLAYS`。
- **别只还原"界面"，还要还原被你改过的 localStorage 键**。
  `setTheme` 会顺带写 `workbuddySkinLastTheme`，而不少测试用 `applyLast()` 还原 —— 读的正是这个键。
  漏了就变成"我最后切到哪，下一个测试就从哪开始"（实测：`test-theme-switch-perf` 报
  `主题已还原到测试开始时的值 -> wuthering-echo vs genshin-dawn`）。
  做法：测试开头快照相关键（`workbuddySkinLastTheme`、`workbuddy.appearance.mode::*`），
  收尾**先按已知主题显式还原、再把快照写回**（顺序不能反：还原动作本身会再次改写那个键）。
- **用户可拖拽/可改的值不要断言具体数值**，断言不变量
  （如"贴边距离跨窗口尺寸保持不变"）。
- **读带 `transition` 的属性要等过渡结束**，否则拿到动画中间值，看起来像"规则没生效"。
- **判断 alpha 要同时支持 `rgba()` 和 `color(srgb r g b / a)`**
  （`color-mix()` 输出后者），否则假阴性。

---

## 六、跨机器 / 发版检查

- **不出现硬编码本机路径**。`src/asar-path.mjs` + `scripts/workbuddy-path.ps1` 负责动态发现；
  `test-scripts-registry` 会拦截回归。
- `find` 不到时给**明确的排查提示**（列出已尝试的位置 + 怎么用环境变量覆盖），
  不要抛一句 `ENOENT` 了事。
- 覆盖用环境变量：`WORKBUDDY_EXE` / `WORKBUDDY_ASAR` / `WORKBUDDY_SKIN_PORT`。
- 大体积可再生内容（`outputs/`、截图）不进仓库，见 `.gitignore`。

---

## 七、诊断手法

**差分定位法**（判断"这是不是皮肤造成的"）：

```bash
node src/cli.mjs pause                      # 卸掉皮肤
node scripts/snapshot-chain.mjs before.json # 抓祖先链快照
node src/cli.mjs apply --theme last         # 装回
node scripts/snapshot-chain.mjs after.json  # 再抓
# 逐属性 diff
```

定位"是哪条规则改了这个属性"：

```bash
node scripts/find-rule.mjs ".wb-home-header__title" color
```

查 WorkBuddy 原生样式（`file://` 页面跨源，`styleSheets.cssRules` 读不到，只能翻 asar）：

```bash
node scripts/asar-find.mjs "关键词"      # 按字节搜 + 打印上下文
node scripts/sel-of.mjs "var(--wb-bg-content)"   # 谁用了这个变量
```

---

## 八、本机性能提醒

**不要用 renderer 的 canvas 做图像处理**。CDP `Runtime.evaluate` 超时后会在页面里
留下挂起的 `img.decode()` 把解码队列堵死（1×1 小图要 3.2 秒），连带 `Page.captureScreenshot` 卡住。
图像裁剪/预览一律走 Python + Pillow（`scripts/crop-icon.py` / `icon-preview.py`）。

---

## 九、已知问题（与本项目代码无关，别重复排查）

以下是 **2026-09-19 确认**的、在**干净工作区**（`git stash` 后）同样复现的失败，
属于本机环境 / 用户数据状态问题，不是回归：

| 测试 | 现象 | 判断 |
|---|---|---|
| `test-window-layout` | 「当前贴边距离与存储的锚点一致」`59 vs dx=21` | 用户 `workbuddySkinMenuPos` 里的锚点与实际渲染位置不一致（历史遗留数据）。**干净树同样失败** |
| `test-menu-icon` / `test-drag` | `AFTER=null`，`saved=null` | `workbuddySkinMenuPos` 为 `null` 时，拖拽后查询图标元素返回空。**干净树同样失败** |

排查方法：`git stash` → `node apply-now.mjs` → 单跑该测试。
若干净树也红，就是环境问题；否则才是自己的回归。
