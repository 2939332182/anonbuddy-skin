<div align="center">

<img src="docs/images/icon.png" width="140" alt="AnonBuddy Skin">

# AnonBuddy Skin

**让 WorkBuddy 变成你的样子。**

<sub>WorkBuddy 换肤 · 五款内置主题 · Wallpaper Engine 壁纸库 · 传一张图就能捏皮肤</sub>
<br>
<sub>Theme &amp; skin injector for the WorkBuddy desktop app · Windows · no app.asar patching</sub>

<br>

<img src="https://img.shields.io/badge/platform-Windows-e09c84?style=flat-square" alt="Platform">
<img src="https://img.shields.io/badge/license-MIT-e09c84?style=flat-square" alt="License">
<img src="https://img.shields.io/badge/%E4%B8%8D%E6%94%B9-app.asar-e09c84?style=flat-square" alt="No app.asar">

</div>

---

AnonBuddy Skin 是给 WorkBuddy 桌面端换肤的注入式插件：内置五款主题，可以改界面配色、铺 Wallpaper Engine 动态壁纸、替换侧边栏文案。全部发生在渲染进程里，不改、不替、不接管 `app.asar` 和安装目录，关掉就还原。非腾讯官方产品。

只发 Windows 包。macOS 那套启动器长期没有实机验证过，这个版本把它移除了。

## 安装

去 [Releases](https://github.com/2939332182/anonbuddy-skin/releases/latest) 下载对应版本的包，解压到哪儿都行，双击 `一键换肤.bat`。

| 你装的是 | 下载 | 主程序 | 端口 |
|:---|:---|:---|:---|
| 国际版（`workbuddy.ai`） | `chihayaanon-skin-<版本>-intl.zip` | `WorkBuddyAI.exe` | 9333 |
| 国内版（`workbuddy.cn`） | `chihayaanon-skin-<版本>-cn.zip` | `WorkBuddy.exe` | 9334 |

分不清就查进程名：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*WorkBuddy*' } | Select-Object -Unique ProcessName
# WorkBuddyAI -> 国际版    WorkBuddy -> 国内版
```

不用找安装目录、不用自己开调试端口、不用装 Python 或任何运行时：包会扫 51 个常见路径再读注册表卸载项来定位 WorkBuddy，Node 优先用应用自带的那份。两个包里的插件代码完全相同，只有主程序名和预设端口不同，下错了会自动回退到另一个；两个版本装在同一台机器上也互不干扰，单实例锁、任务栏分组、卸载项 GUID 各不相同。

> [!WARNING]
> 双击前把 WorkBuddy 里没保存的东西存一下，它会被重启。

不想要了：双击 `一键还原.bat`，或者把文件夹删掉。

### 让 AI 帮你装

懒得自己动手，就把下面这段整块复制给任意 AI 助手——Claude Code、Cursor、WorkBuddy 自己都行。它会自己判断版本、下载、安装并验证，你不用管中间步骤。

```text
从 https://github.com/2939332182/anonbuddy-skin 给我装 AnonBuddy Skin，给 WorkBuddy 换肤。先读
仓库里的 SKILL.md，然后按它执行：用 Get-Process 确认是国际版（WorkBuddyAI）还是国内版
（WorkBuddy），下载对应的 release 包，解压后运行 一键换肤.bat，最后用 node src/cli.mjs status
确认 installed: true。apply 会重启 WorkBuddy，动手前提醒我存盘；不要修改 app.asar。
```

完整流程写在 [`SKILL.md`](SKILL.md) 里，AI 读完会知道每一步该做什么。

## 界面预览

<div align="center">

<img src="docs/images/preview-main.png" width="820" alt="主界面">

<table>
<tr>
<td><img src="docs/images/preview-menu.png" width="400" alt="主题菜单"></td>
<td><img src="docs/images/preview-panel.png" width="400" alt="设置面板 · 壁纸库"></td>
</tr>
</table>

</div>

## 功能

| 功能 | 说明 |
|:---|:---|
| 五款内置主题 | 装上就有，右上角悬浮球点开即换，不用重启。选「原生界面」一秒还原 |
| Wallpaper Engine 壁纸 | 自动翻本机订阅库，多 Steam 库、跨盘都认。视频壁纸当动态背景播，场景壁纸**本机实时渲染**（粒子、视差、交互、场景音都在），跑不动才退回 4K 静帧 |
| 没有 WE 也能用 | 面板里挑个文件夹，里面的视频和项目都能当壁纸库 |
| 自定义皮肤 | 传一张图就是一个主题，主色辅色自动从画面里取。右键可改名、删除、设为开机默认 |
| 文案替换 | 侧边栏应用名、欢迎页主标题都能改成你喜欢的句子，主标题还能逐字打出来 |
| 开机自带皮肤 | 双击 `一键换肤.bat` 时顺手接好桌面图标、开始菜单和开机自启，往后开机即注入 |

## 内置主题

| 主题 | id | 强调色 |
|:---|:---|:---|
| 爱素 | `aisu` | `#e09c84` |
| 春至双背景 · 昼 | `chunzhi-day` | `#dd9fa6` |
| 春至双背景 · 夜 | `chunzhi-night` | `#5d81da` |
| Hatsune Miku · 海色 | `miku-sea` | `#0d9cfa` |
| Summer Moon Hana 4K | `summer-moon` | `#8284f3` |

明暗按 `theme.json` 的 `colors.surface` 判定，和 WorkBuddy 自带外观联动。自己加一款：把 `theme.json` 和 `hero.webp` 丢进 `themes/你的id/` 再 apply 一次，id 只能用小写字母、数字和连字符。

## 壁纸库

没有任何写死的路径。启动后从几个常见的 Steam 位置摸起，读 `libraryfolders.vdf` 认下所有库，在 `steamapps/workshop/content/431960/` 里读 `project.json` 列清单。换台电脑、换个盘符都不用改配置。

| 类型 | 素材在哪 | 怎么用 |
|:---|:---|:---|
| 视频壁纸 | 工程根目录的 `.mp4` / `.webm` | 直接 `<video>` 播放，声音开关 + 音量滑块 |
| 场景壁纸 | 打包在 `scene.pkg` 里 | **本机实时渲染**（见下）；没就绪或跑不动时退回 RePKG 解出来的 4K 静帧 |
| 网页壁纸 | `files/index.html` | 当不了背景，退化成创意工坊那张预览图 |

面板里能拧：壁纸音量、手动目录、评级筛选（全部 / G / PG-13 / R18）、每页九张的翻页。视频壁纸的暂停和音量联动，暂停自动静音，音量拖到非 0 自动解除并续播。

场景壁纸里通常打包着几十张贴图，RePKG 解包后按「16:9 优先、面积次之」挑一张当静帧 —— 这是降级链的**第二档**：真渲染还没就绪、或这台机器跑不动时，它就是你看到的画面。只按体积挑的话，32 个样本里只有 13 个选对比例，其余会挑中竖版立绘或 256×256 缩略图。

### 场景壁纸是真渲染，不是截图

**1.0.5 起**，场景壁纸由随包分发的本机渲染引擎（WebWallGL，MIT，不联网）直接解释 `scene.pkg`：粒子、骨骼模型、鼠标视差、作者脚本、场景自带音频都在，而不只是一张截好的图。

慢的那部分被一张已经存在的图遮住，所以感觉不到背后有引擎：

| 步骤 | 发生什么 | 你看到什么 |
|:---|:---|:---|
| ① 立即 | 静态 4K 贴图铺上（几十毫秒） | 壁纸立刻换了 |
| ② 异步 | 后台加载引擎 → 解析 pkg → 等首帧 | 界面已经能用了 |
| ③ 首帧就绪 | 渲染层淡入（450ms），静帧被顶替 | 画面「更顺滑了」 |
| ④ 任何一步失败 | 静默留在静帧上 | 什么都没发生 |

降级链四档，**任何情况下都不会黑屏**：实时渲染 → 静态 4K 贴图 → 工坊预览图 → 主题取色渐变。

实测（RTX 3050，国际版与国内版各跑一遍，30fps 上限）：

| 场景 | 层数 | pkg | 帧率 |
|:---|---:|---:|---:|
| 蓝屏绫波丽 | 2 | 1.7MB | 30 ~ 35 |
| 初音未来 before light | 6 | 34MB | 28 ~ 30 |
| 熠烛 御剑驭龙 | 65 | 58MB | 3 ~ 4 |

重场景（65 层 + 4096×2296）会掉到个位数帧率 —— 卡的是画面流畅度，界面可用性不受影响，换个轻点的壁纸就回来。

暂停、恢复、音量都走渲染实例自己的 API（不重建实例，重建要重新解析整个包）；反复换壁纸不会叠加渲染循环，切走时引擎实例会被真正销毁。

> [!NOTE]
> 壁纸指向的是**你本机**的路径，换台电脑就失效。创意工坊内容版权归原作者，别打包分发。

## 常见问题

- **换完没反应**：跑 `node src/cli.mjs status`，`installed` 是 `false` 就重跑一次 apply
- **重启后皮肤没了**：故意的。注入的生命周期跟着渲染进程走，重跑 apply 就行
- **找不到 WorkBuddy**：`node scripts\find-workbuddy.mjs` 会列出试过的所有候选路径和命中的那一个
- **壁纸列表是空的**：先确认 Wallpaper Engine 里有订阅；没有就用面板上的「手动目录」挑个文件夹
- **5.6 之后的设置窗口没皮肤**：5.6 起设置变成独立窗口，启动器会拉起 `scripts/skin-guard.mjs` 接管新窗口，所以设置页第一帧就带皮肤。不想常驻加 `--no-watch`

## 原理与边界

WorkBuddy 是 Electron 应用，渲染进程跑在 `file://` 页面上。用 `--remote-debugging-port` 把它重启起来，通过 CDP 接上 renderer，注入一份 CSS 和一段脚本：CSS 覆盖 WorkBuddy 自己的 `--cb-*` 设计变量、铺背景图层、调透明度与模糊；脚本负责主题菜单、文案替换、逐字动画和壁纸的生老病死。

```
┌─────────────────────┐                          ┌─────────────────────┐
│      WorkBuddy      │   CDP · 127.0.0.1:9333   │    AnonBuddy Skin   │
│      (Electron)     │ ◄──────────────────────► │    launch-and-skin  │
│                     │        port 9334         │    skin-guard.mjs   │
│      renderer       │ ◄─── inject CSS + JS ─── │                     │
│      file:// page   │                          │    loopback only    │
└─────────────────────┘                          └─────────────────────┘
          │
          └─ app.asar / signature / install dir — untouched
```

没有构建步骤，没有原生依赖，注入的就是一段普普通通的 JavaScript。

- **不碰官方文件**：不改、不替、不接管，`app.asar`、应用签名和安装目录从头到尾没人碰过
- **只绑回环**：CDP 监听 `127.0.0.1`，不对外。但皮肤开着的时候，同一用户下的其他程序也能连上这个端口，挂皮肤时别乱跑来源不明的东西
- **注入跟着进程走**：手动重启后皮肤消失是设计如此，不是 bug
- **素材只读**：壁纸内容归原作者，本工具只读本机路径，从不复制也不再分发
- **引擎也在本机**：场景壁纸的渲染器随包分发（950KB，MIT），不从 CDN 取、运行期不联外网；它只读你本机的 `scene.pkg`，读不到就退回静帧，不会去别处找资源

> [!NOTE]
> 主题、壁纸与配置全部保存在本机，换肤过程不把你电脑上的任何内容传出去。

## 进阶用法

<details>
<summary>命令行</summary>

```bash
node src/cli.mjs list                 # 列出所有主题
node src/cli.mjs apply                # 应用默认主题
node src/cli.mjs apply --theme aisu   # 指定一款，last 恢复上次用的
node src/cli.mjs pause                # 卸掉皮肤
node src/cli.mjs status               # 看看注入上了没
node src/cli.mjs doctor               # 环境自检
node src/cli.mjs create --image a.png --name "我的主题"
node src/cli.mjs we                   # 盘点本机壁纸库
```

指定端口换另一个版本：`node src/cli.mjs apply --port 9334`。

从源码跑：`node scripts\launch-and-skin.mjs`（启动 + 注入一步到位，`--prefer cn` 指定版本）。它只在应用没带着调试端口跑的时候才需要；已经带端口开着的话直接 `node src/cli.mjs apply` 就行。找不到 WorkBuddy 先跑 `node scripts\find-workbuddy.mjs`。

装在非标准位置就设一次环境变量：

```powershell
[Environment]::SetEnvironmentVariable('WORKBUDDY_EXE', 'D:\path\to\WorkBuddyAI.exe', 'User')
```

</details>

<details>
<summary>皮肤为什么重启就没了，以及怎么让它开机就在</summary>

皮肤注入在渲染进程里，所以「怎么启动」决定了它还在不在。桌面双击、开始菜单、开机自启这些默认入口都是裸启动，没有调试端口，注入器接不上。

双击 `一键换肤.bat` 时会顺手把这件事办了：翻出所有指向 WorkBuddy 的启动入口（桌面快捷方式、开始菜单、任务栏固定项、自启注册表项），改成走静默启动器 `scripts/autoskin-launch.vbs`，带端口启动、等渲染进程、注入、退出。没有黑框，也不常驻内存。

改动前会先备份：

```powershell
.\scripts\setup-autoskin.ps1 -ListOnly    # 先看会改哪些入口，什么都不改
.\scripts\setup-autoskin.ps1 -Undo        # 从备份还原成原来的快捷方式
```

它只认**目标可执行文件完全相同**的入口，所以两个版本同时装着也不会互相干扰。

> [!IMPORTANT]
> 有个前提：WorkBuddy 此刻正开着而且是裸启动的话，第一次得手动退出（右键托盘图标选「退出」）。之后一律用快捷方式启动，就再也不会落进那个状态。
>
> 为什么不能自动关：WorkBuddy 进程带保护（内置图灵盾），`Stop-Process`、`taskkill /F` 全被拒，连读它的进程所有者都不行。点窗口右上角 × 也只是缩到托盘，进程照样活着。

</details>

<details>
<summary>开发与打包</summary>

```bash
npm run test:static   # 静态检查，不连应用，几秒钟
npm run test:core     # 注入 / 还原 / 幂等
npm run test:ui       # 布局和视觉
```

`node scripts/run-tests.mjs --list` 能看到每个套件管什么。打包：`node packaging/build-package.mjs`，默认出 cn 和 intl 两个包，`--edition cn` 只出一个。

仓库里还有个 `scripts/make-skin-from-we.mjs`，能从任意 Wallpaper Engine 条目一键搓出主题：解码、抽帧、取色全在渲染进程里做，不依赖 ffmpeg 也不依赖 sharp。

</details>

## 出处与许可

从 **WorkBuddy Skin Studio · WorkBuddy 换肤工作室** 长出来的。CDP 注入这套骨架、`--cb-*` 的用法、菜单和设置面板的结构都来自那里。这个 fork 接着往下走：接上 Wallpaper Engine 壁纸库，重做自定义皮肤链路，内置主题换成二次元向的选图，补上双版本包和 5.6 兼容。

- **WorkBuddy Skin Studio · WorkBuddy 换肤工作室**：一切的起点
- **RePKG**（MIT）：解场景壁纸用，随仓库带着，不需要 .NET 运行时
- **WebWallGL**（MIT，oneincase）：场景壁纸的实时渲染器，随包分发、不联网；它把 WE 引擎语义复刻得足够好，才有「真渲染而不是截图」这一档

代码走 MIT。商标与素材声明：

- 本项目面向本机运行的 WorkBuddy 桌面端做界面增强，**与腾讯及其官方产品无隶属关系**
- WorkBuddy、WorkBuddy AI 的名称与商标归其权利人所有，本项目未获得其官方授权或认可
- 内置主题的背景图取自 Wallpaper Engine 创意工坊，版权归各自作者，仅作展示随仓库分发。如果你是作者并且希望移除，开个 issue 就好
