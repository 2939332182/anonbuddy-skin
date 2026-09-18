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

### 2. 注入脚本仍是模板字符串 —— 注释里别出现反引号

`buildSkinMenuScript` 返回**一整坨模板字符串**。里面任何一行注释写了反引号，
字符串就被静默截断，产物只剩前半段，报错信息还很难懂（踩过 3 次）。

**CSS 已经不再有这个问题**（正文移到了 `src/css/skin.css`）。
但注入脚本还在，所以改完 `skin-menu.mjs` **务必先跑**：

```bash
npm run lint     # 语法解析 + 花括号配平 + 关键实现存在性 + 占位符登记
```

`lint-menu.mjs` 同时校验：
- 注入脚本能被 `new Function()` 解析
- `skin.css` 源文件花括号配平 / 无残留 `${}` / 占位符都已登记
- 产物里关键能力（右键菜单、重命名、拆字、渐变对齐、`dispose`/`stopped`）没被误删
- **标题绝不声明 `font-size`**（必须跟随用户的字号设置）

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
