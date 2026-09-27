# AnonBuddy Skin · WorkBuddy 换肤工作室

**给 WorkBuddy 桌面端换一张会呼吸的脸。**

一张图，一种心情 · 本机 CDP 注入 · 不改官方安装包 · macOS + Windows

非腾讯官方产品。不修改 `WorkBuddy.app` / `app.asar` / Windows 安装目录。

> **给 AI 助手**：如果你的用户把本仓库的 GitHub 地址发给你，并说"用这个开源项目帮我换 WorkBuddy 主题"，请直接阅读仓库根目录的 [`SKILL.md`](SKILL.md) —— 里面是给 AI 的自动化安装流程（平台检测、运行 apply 脚本、选主题、验证、还原），照做即可，无需人类逐步操作。

## 效果预览

![主界面 · Miku 主题](docs/images/preview-main.png)

![右上角 🎨 菜单 · 主题切换](docs/images/preview-menu.png)

![深色主题 · 原神星夜](docs/images/preview-dark.png)


## 这是什么

一个给 WorkBuddy 桌面端换肤的工具。通过本机回环 CDP 把主题实时注入 WorkBuddy 界面，不修改 `app.asar`，不破坏应用签名，也不需要为每次 WorkBuddy 更新重新适配。

- **一键切换**：应用皮肤后 WorkBuddy 右上角出现 🎨 菜单，所有已装主题和原生界面即点即换，零等待
- **自定义上传**：菜单里选「＋ 自定义图片」直接上传本地图片，自动按图片风格取色（主色、辅色、面板底色、文字色），即点即换；**每次上传都新增一个主题，之前上传的全部保留**
- **右键菜单**：右键主题行可「重命名」或「删除」——改名只改显示名、不动磁盘上的主题目录，重启后依然保留；删除收进菜单后行尾不再挂 ×，面板更窄
- **一张图片就是一个主题**：任意 PNG、JPG、JPEG、WebP 直接生成皮肤（配色 + 背景底图）
- **5 个内置主题**：爱素、春至双背景 · 昼、春至双背景 · 夜、Hatsune Miku · 海色、Summer Moon Hana 4K —— 全部随仓库分发，任何人 clone 后开箱即用
- **记住上次主题**：WorkBuddy 重启后自动恢复你上次在菜单里选的主题，**自定义上传的图片也能恢复**；选了「原生界面」也会记住
- **开机默认主题**：在主题行上右键选「设为开机默认主题」，以后每次启动都以它开局（优先级高于“上次选的主题”，可随时取消）
- **深浅色自动适配**：根据主题配色的 surface 明度自动切换 WorkBuddy 的 `data-vscode-theme-kind`，让 VS Code 原生控件（输入框、按钮等）跟着深浅色变
- **双平台**：macOS（`.command`）+ Windows（`.ps1`）
- **随时还原**：暂停皮肤或切回原生界面，官方安装包始终原封不动

## 快速开始

需要已安装 WorkBuddy 桌面端。下载本仓库后：

### 用 AI 一键安装（推荐）

不想自己敲命令？把本仓库的 GitHub 地址发给任意 AI 助手（CodeBuddy / Claude / Cursor 等），再加上一句：

> 用这个开源项目帮我更换 WorkBuddy 的主题

AI 会克隆仓库、读取根目录的 [`SKILL.md`](SKILL.md)，自动完成**平台检测 → 运行对应 apply 脚本 → 注入主题 → 验证状态**，你只需在弹窗里保存好 WorkBuddy 当前任务即可。换肤后日常切换仍在右上角 🎨 菜单里进行。

> 想指定主题也可直接说，例如「用深色原神主题」或「帮我换成海色」。

### macOS

```bash
# 双击 scripts/apply.command，或命令行：
./scripts/apply.command

# 或指定主题
node src/cli.mjs apply --theme chunzhi-night
```

### Windows

```powershell
# PowerShell 运行
.\scripts\apply.ps1

# 或指定主题
.\scripts\apply.ps1 -Theme chunzhi-night

# 若找不到 WorkBuddy.exe，先跑排查脚本：
.\scripts\find-workbuddy.ps1

# 装在非标准路径（不在 Program Files / LocalAppData）时，设一次用户级环境变量即可一劳永逸：
[Environment]::SetEnvironmentVariable('WORKBUDDY_EXE', 'D:\path\to\WorkBuddyAI.exe', 'User')
```

> 环境变量对**新开的**终端才生效（已开着的窗口需要重开，或注销重登一次）。

> Windows 首次运行若报执行策略错误，执行：
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

应用皮肤时 WorkBuddy 会被正常退出并以本机调试模式重新打开，**当前任务请先保存**。

之后的日常切换都在 WorkBuddy 右上角 🎨 菜单里完成。暂停皮肤、回到原生外观：

```bash
# macOS
./scripts/pause.command

# Windows
.\scripts\pause.ps1
```

> 注意：WorkBuddy 手动重启后注入会消失（CDP 方案的天性），重跑一次 apply 即可回来。

## 主题切换菜单

应用皮肤后，WorkBuddy 右上角（titlebar 下方）会出现 🎨 按钮：

- 点击展开主题列表，点击任意主题即时切换
- **右键主题行弹出菜单**：「重命名」/「删除」（删除只对上传的自定义主题开放，需点两次确认）
- 重命名：回车保存 / Esc 取消 / 清空后回车恢复默认名；只改显示名，不动磁盘上的主题目录
- 「＋ 自定义图片」上传本地图片生成主题（canvas 自动取色 + 压缩成 webp）
- **上传过的图片全部保留**：每张图都是独立主题、互不覆盖；主题多了面板自动出现滚动条
- 「原生界面」恢复官方外观

## 设置面板里的「ChihayaAnon 插件」

除了悬浮的 🎨 按钮，插件还把自己集成进了 WorkBuddy 的**设置面板**：

> 左下角个人中心 → **设置** → 左侧「功能」分组 → **ChihayaAnon 插件**

这个页面提供三块功能：

| 区块 | 能做什么 |
|---|---|
| **皮肤** | 列出全部可用皮肤（原生界面 + 内置主题 + 你上传的每一张），点击即时切换，当前皮肤带 ✓ |
| **添加** | 「上传图片作为新皮肤」—— 选一张本地图片，自动取色、压缩、加入列表并立即生效 |
| **悬浮图标** | 一个开关，控制右上角那个悬浮小图标的显示 / 隐藏 |

说明几点：

- **皮肤列表和悬浮菜单是同一份数据**。在这里切换，悬浮菜单的选中态会同步；反之亦然。
- **关掉悬浮图标不会关掉皮肤**。图标只是入口之一，设置面板这个入口始终可用，
  所以你可以把界面收拾干净而不失去控制。
- 开关状态存在本地，重启后保持。
- 皮肤列表里同样**右键可重命名 / 删除**（删除只对上传的自定义皮肤开放，需点两次确认）。

## 自定义主题

用任意图片创建主题：

```bash
node src/cli.mjs create --image "/path/to/hero.webp" --name "My Skin"
node src/cli.mjs apply --theme my-skin
```

或直接在 🎨 菜单里选「＋ 自定义图片」上传，自动取色并持久化（localStorage）。
每次上传都会新增一条主题，不会覆盖之前上传的；旧版本（只存一张）会在首次运行时自动迁移。

## 自定义插件图标

左上角那个 🎨 按钮可以换成自己的图片（比如二次元头像）。把素材放进仓库根的 `assets/` 目录：

```
assets/menu-icon.png      # 也支持 icon.png，扩展名 png / jpg / webp / gif / svg 都行
```

再重新 `apply` 一次即可，**不用改代码**。找不到素材就自动退回默认的 🎨 emoji。

素材建议：

- **正方形**（按钮是 38×38 的圆形，图片按 `cover` 裁切，非正方形会被裁掉边缘）
- **主体居中**，四周留一点余量，避免被圆形切到脸
- 尺寸 **76×76 或更大**（2 倍图，高分屏更清晰）
- 想要「贴纸」效果就用**透明背景的 PNG**，按钮本身的白色底会衬在下面

素材不是正方形、或者想裁到脸，可以用附带的小工具（需要 Pillow）：

```bash
# 裁成正方形并对准脸（--cx/--cy 是裁剪中心，--side 是裁剪边长）
python scripts/crop-icon.py 原图.jpg assets/menu-icon.png \
  --cx 663 --cy 580 --side 620 --saturate 1.8 --contrast 1.28

# 预览圆形裁切后的实际效果（38 / 76 / 114 px）
python scripts/icon-preview.py assets/menu-icon.png
```

> 淡彩 / 水彩原图缩到 38px 容易糊成一片，`--saturate 1.6~1.9`、`--contrast 1.25` 左右会清楚很多。

## 替换界面文案（侧边栏应用名 / 欢迎页主标题）

侧边栏左上角的「WorkBuddy AI」和欢迎页主标题「WorkBuddy, 我帮你」都是 React 从
i18n 词条直接渲染的文本，**皮肤改样式改不到字**，所以由注入脚本在 DOM 层原地改写。

改文案只需要动 `src/skin-menu.mjs` 里的两个常量：

```js
const BRAND_TEXT = "ChihayaAnon AI";        // 侧边栏应用名
const HERO_TITLE_TEXT = "\u63a2\u7d22\u672a\u81f3\u4e4b\u5883";   // 欢迎页主标题（探索未至之境）
```

改完重新 `apply` 即可。几个要点：

- **只改文本节点，不重建节点**。欢迎页主标题内部是原生"翻滚槽"结构
  （`.wb-home-header__title-roll` / `__roll-cell`），重建节点会把动画赖以工作的
  裁剪槽拆掉。
- **用 `MutationObserver` 守着**。React 每次切页 / 切场景 / 启动都会把文案写回原文，
  观察器会在下一帧改回去（已做 rAF 节流）。
- **原文案是白名单匹配**（`BRAND_ORIGINALS` / `HERO_ORIGINALS`），只替换已知的原生
  文案，避免误伤用户输入的内容。多语言下的其它语种文案需要自己加进白名单。
- `pause` 卸载皮肤时会连带还原（`removeSkin` 里调 `__anonbuddySkin.copy.restore()`）。
- ⚠️ **重复 `apply` 必须幂等**。`apply` 每次都会把整段脚本重新 eval 一遍，所以脚本开头
  必须先停掉上一个实例（`copy.stop()` + `dispose()`），只删 `#anonbuddy-skin-menu`
  节点是不够的 —— 旧实例的 `MutationObserver` 和 1.5s `setInterval` 还活着，
  会持续把标题拆成逐字节点。踩过的表现：**第一次 `pause` 能还原，之后每次 `pause` 都失效**
  （因为旧实例把刚合并好的文本又拆回去了）。`scripts/test-reapply-idempotent.mjs` 守这条不变量。

## 欢迎页主标题特效（日系轻小说风）

`src/skin-css.mjs` 里 `.wb-home-header__title` 那一组规则实现了：

| 效果 | 做法 |
|---|---|
| 字距 | `letter-spacing: .1em`（+ `padding-right: 1em` 抵消末字间距，保持视觉居中）|
| 主题色渐变 | `background-image: linear-gradient(...)` + `-webkit-background-clip: text` + `-webkit-text-fill-color: transparent` |
| 日系轻小说描边 | `-webkit-text-stroke: 0.03em rgb(from <中和色> r g b / 0.5)` |
| 逐字打字入场 | 主标题按字拆成 `<i>`，每字 `@keyframes anonbuddy-skin-char-type-in`，`animation-delay` 按 `--wb-char-index` 递增（步长 `.075s`）|
| 浅色衬边 | `.wb-home-header__title-wrap::before` 径向渐变，把字从同色系背景里托出来 |

踩过的坑（改之前务必看）：

1. **绝不要在这条规则里声明 `font-size`**。字号由 `#cb-font-size-override` 的
   `.wb-home-header__title:not(.cb-font-size-fixed)` 以 `calc(30px + offset)`
   加 `!important` 给出（默认 offset = -1 → 实测 29px）。不声明就天然跟随用户设置。
   `scripts/lint-menu.mjs` 有一条硬性检查会拦截。
2. **描边不能用 `color-mix()`**，它会把 alpha 算进结果色值、描边变实色、糊掉笔画内部；
   要用 `rgb(from <color> r g b / 0.5)` 显式保留 alpha。
3. **`-webkit-background-clip: text` 不继承**，标题里的 `<span>` 和每个 `<i>` 都必须
   显式再声明一遍（含 `background-image: inherit`），否则会渲染成一块色板而不是"按字形裁切"。
4. **渐变 + `text-shadow` 冲突**，要体积感就用 `filter: drop-shadow(...)`。
5. **拆字后渐变会"每字重来"**。每个 `<i>` 都是独立盒子，`background-image` 在各自盒内
   从头绘制 —— 表现是"6 个一模一样的色块"而不是一条贯通全行的渐变。解法是给每个字设
   `background-size: <整行宽> 100%` + `background-position-x: -<该字左边距>`，
   由 `alignCharGradient()` 在拆字后 / 窗口 resize / 字体就绪时重算。
6. **原生已经有一套翻滚系统，但它从不触发**：只在"标题内容真的变化"时才挂载
   （`isSameTitleContent` 判等后复用旧节点）。实测「日常办公」↔「代码开发」两个场景的
   `home.header.title` 完全相同，所以原生翻滚从不触发。原生 phase
   （`[data-wb-swap-phase]`）出现时，我们的动画会主动让位，避免两套 transform 打架。
7. **React 不会回退我们插入的孙节点**。实测在标题的 `<span>` 里插入 `<i>`，存活 3s 并经
   一次场景切换都不被 React 还原（React 只 diff 自己拥有的节点），所以拆字方案可行。
   `applyCopy` 里对已拆过的节点会跳过（`if (host.querySelector(":scope > i")) continue;`）。

### 打字动画的参数（想调节奏改这几个）

| 变量 | 位置 | 默认 | 作用 |
|---|---|---|---|
| `--wb-type-step` | `skin-css.mjs` | `.075s` | 相邻两字出现的间隔 |
| `--wb-type-life` | `skin-css.mjs` | `.34s` | 单个字的动画时长 |
| 字节点标签 | `skin-menu.mjs` 的 `CHAR_TAG` | `"i"` | 拆字用的标签名 |

实测时间线（6 个字）：`99 → 154 → 229 → 306 → 379 → 455 ms`，首末跨度约 356ms，
单字纵向位移仅 5.2px（确保是"打字出现"而不是"整行从下往上翻滚"）。

验证：

```bash
node scripts/lint-menu.mjs                      # 模板字符串完整性 + 关键规则存在性 + 字号不被改动
node scripts/test-title-copy.mjs 9333           # 文案替换 + 样式 + 渐变不外溢 + 逐字拆分
node scripts/test-roll-anim.mjs 9333            # 打字动画逐帧采样（顺序/位移/淡入/时长）
node scripts/test-pause-restore.mjs 9333        # pause 后文案与逐字节点彻底还原
node scripts/test-reapply-idempotent.mjs 9333   # 反复 apply 不泄漏旧实例，pause 仍能还原
node scripts/shot-title.mjs outputs/x/shot      # 截图标题特写与侧边栏
```

## 极简主题格式

```json
{
  "schemaVersion": 1,
  "id": "my-skin",
  "name": "My Skin",
  "hero": "hero.webp",
  "colors": {
    "accent": "#24C9D7",
    "secondary": "#EF8FD3",
    "surface": "#F7FBFF",
    "text": "#17344F"
  }
}
```

只有 `schemaVersion`、`id`、`name` 和 `hero` 必填。图片必须位于主题目录内，颜色和文案（`copy`）都可省略。

- `surface` 的明度决定 light/dark 模式（亮度 > 140 为 light），自动切换 WorkBuddy 的 `data-vscode-theme-kind`
- `hero` 支持 PNG / JPG / JPEG / WebP

## 命令行

```bash
node src/cli.mjs list                              # 列出所有主题
node src/cli.mjs create --image PATH --name NAME   # 从图片创建主题
node src/cli.mjs apply [--theme ID|last] [--port 9333]  # 应用主题；last = 恢复上次选用的主题
node src/cli.mjs status                            # 查询注入状态
node src/cli.mjs pause                             # 恢复原生
node src/cli.mjs doctor                            # 检查环境（app 路径、端口、平台）
```

也可以用 npm 脚本：`npm run apply` / `npm run pause` / `npm run status` / `npm run list` / `npm run doctor`。

> **跨机器无需配置**：WorkBuddy 的安装路径（可执行文件、`app.asar`）是自动发现的
> （常见安装位置 → 注册表 → 开始菜单快捷方式 → 从运行中的进程反推）。
> 如果自动发现失败，用环境变量覆盖即可：`WORKBUDDY_EXE` / `WORKBUDDY_ASAR`。
> `node src/cli.mjs doctor` 会打印它找到的路径。

## 开发者：测试与迭代

改动前请先读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) —— 里面有**「改动 → 该跑哪些测试」映射表**，
以及几条"改坏就出 bug"的不变量（顶栏偏移、sticky 实底、贴边锚点、幂等注入）。

```bash
npm test              # 静态检查 + 核心 e2e（日常改动跑这个就够）
npm run test:static   # 不连 renderer，秒级，随时可跑
npm run test:core     # 注入 / 还原 / 幂等 / 标题 / 图标
npm run test:ui       # 布局与视觉
npm run test:menu     # 菜单交互
npm run test:all      # 全部 e2e（约 2 分钟）
npm run lint          # 只校验生成物（改 CSS / 注入脚本后必跑）
npm run test:list     # 列出套件与用例（含每个用例"为什么存在"）
```

e2e 依赖**真实运行中的 WorkBuddy**（它通过 CDP 连过去断言真实渲染结果）。
没在跑时该套件会整段跳过而不是报失败。端口用 `WORKBUDDY_SKIN_PORT` 覆盖。

> 交接给下一个 AI 助手继续开发？
> - 先看 [`docs/HANDOFF.md`](docs/HANDOFF.md) —— **已完成工作总览 + 待办 + GitHub 发布规划**
> - 再按 [`docs/HANDOFF-PROMPT.md`](docs/HANDOFF-PROMPT.md) 的模板把任务交给新窗口

## 内置主题

| 主题 id | 名称 | 强调色 | 深浅 |
|---|---|---|---|
| `aisu` | 爱素 | 夕橙 `#e09c84` | 浅色 |
| `chunzhi-day` | 春至双背景 · 昼 | 樱粉 `#dd9fa6` | 浅色 |
| `chunzhi-night` | 春至双背景 · 夜 | 夜蓝 `#5d81da` | 浅色 |
| `miku-sea` | Hatsune Miku · 海色 | 海蓝 `#0d9cfa` | 浅色 |
| `summer-moon` | Summer Moon Hana 4K | 蓝紫 `#8485f3` | 浅色 |

> 深浅由 `theme.json` 的 `colors.surface` 自动判定，并会**联动 WorkBuddy 自带的外观（浅色/深色）**：
> 切浅色系主题 → 外观变浅色，切深色系 → 外观变深色；浅色系主题生效期间禁止切深色。

自带主题全部随仓库分发，不存在“本机存档”一说。想自己加主题：把 `theme.json` + `hero.webp` 放进
`themes/<id>/`（id 需为小写字母、数字与连字符）再 apply 一次即可。

## 设计边界

- 这是一个轻量工具。皮肤跟随当前 renderer 存活，WorkBuddy 完整重载界面后重新运行一次 apply 即可
- CDP 只绑定本机回环地址 `127.0.0.1`，主题运行期间勿跑来路不明的本机程序
- 不修改官方安装目录与代码签名
- 深色主题已适配 `data-vscode-theme-kind` 自动切换；点「原生界面」恢复时默认回到 light（若你原生是 dark 需手动切回）
- 当前版本针对 WorkBuddy 的 `--cb-*` 设计变量系统和 `[data-view-id]` DOM 锚点适配，与 Codex 的 DOM 结构完全不同

## 技术原理

1. 以 `--remote-debugging-port=9333` 启动 WorkBuddy（Electron / Chrome 138）
2. 通过 `http://127.0.0.1:9333/json/list` 发现 renderer（过滤 `renderer/index.html`）
3. 用 CDP `Runtime.evaluate` 注入 CSS（`<style>`）+ 右上角菜单（DOM）
4. CSS override WorkBuddy 的 `--cb-*` 变量（`--cb-bg-primary` / `--cb-text-primary` / `--cb-vscode-editor-background` 等 60+ 个）实现全局换色
5. 给 `#root` 加背景图，`.teams-container` / `[data-view-id]` 等容器设透明让底图透出

## 致谢

本项目参考了两个优秀的 Codex 换肤项目：

- [HeiGeAi/heige-codex-skin-studio](https://github.com/HeiGeAi/heige-codex-skin-studio) — CDP 注入架构、主题 schema、菜单取色逻辑、`.command` 脚本
- [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) — Windows PowerShell 启动套路（`Test-CDP` / `Start-Process` / 路径探测）、light/dark 自动适配思路

## 许可与素材

代码使用 [MIT License](LICENSE)。预览与预设中的角色、名称和视觉素材权利属于各自权利人（初音未来、原神、鸣潮、火影忍者、恋与深空等），仅用于主题概念展示，不由本项目的软件许可证授权。
