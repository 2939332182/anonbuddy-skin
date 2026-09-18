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
