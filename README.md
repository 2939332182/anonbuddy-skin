<div align="center">

<img src="docs/images/icon.png" width="140" alt="AnonBuddy Skin">

# AnonBuddy Skin

**给 WorkBuddy 桌面端换个样子。**

<sub>五款内置主题 · Wallpaper Engine 壁纸库 · 传张图就能捏皮肤</sub>

<br>

<img src="https://img.shields.io/badge/platform-Windows-e09c84?style=flat-square" alt="Platform">
<img src="https://img.shields.io/badge/license-MIT-e09c84?style=flat-square" alt="License">
<img src="https://img.shields.io/badge/%E4%B8%8D%E6%94%B9-app.asar-e09c84?style=flat-square" alt="No app.asar">

</div>

---

非腾讯官方产品。不改、不替、不接管 `WorkBuddy.app` 和 `app.asar`，也不动安装目录。所有效果都发生在渲染进程里，关掉就还原。

目前只发 Windows 包。macOS 的那套启动器长期没有实机验证过，为了不误导人，这个版本直接把它移除了。

## 装

去 [Releases](https://github.com/2939332182/anonbuddy-skin/releases/latest) 下载 **对应版本**的包，解压到哪儿都行，然后双击 `一键换肤.bat`。

| 你装的是 | 下载 | 主程序 | 端口 |
|:---|:---|:---|:---|
| 国际版（`workbuddy.ai`） | `chihayaanon-skin-<版本>-intl.zip` | `WorkBuddyAI.exe` | 9333 |
| 国内版（`workbuddy.cn`） | `chihayaanon-skin-<版本>-cn.zip` | `WorkBuddy.exe` | 9334 |

分不清就查一下进程名：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*WorkBuddy*' } | Select-Object -Unique ProcessName
# WorkBuddyAI -> 国际版    WorkBuddy -> 国内版
```

两个包里的插件代码完全相同，只是启动器优先匹配各自的主程序名、预设了不同端口。下错包也没关系 —— 找不到预设的那个会自动回退到另一个。包会自己找 Node 运行时（用 WorkBuddy 自带的那份，不用单独装），重启 WorkBuddy 后把皮肤注进去。两个版本同时装在一台机器上也不会打架，单实例锁、任务栏分组、卸载项 GUID 各不相同，各走各的端口。

> 双击前先把 WorkBuddy 里没保存的东西存一下，它会被重启。

不想要了：双击 `一键还原.bat`，或者把文件夹直接删掉。

### 给 AI 助手

用户把仓库丢给你、说「用这个帮我换 WorkBuddy 主题」时，按这个做。完整流程在 [`SKILL.md`](SKILL.md)。

先判断版本：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*WorkBuddy*' } | Select-Object -Unique ProcessName
```

- 输出 `WorkBuddyAI` → 国际版 → 下 `-intl` 包
- 输出 `WorkBuddy` → 国内版 → 下 `-cn` 包
- 两个都在 → 问用户想换哪个
- 一个都没有 → WorkBuddy 还没装，别继续

然后：下载对应 zip → 解压 → 双击 `一键换肤.bat` → 跑 `node src/cli.mjs status`，看到 `installed: true` 就算成功 → 告诉用户右上角那颗 🎨 可以换主题，手动重启 WorkBuddy 之后要重跑一次。

两句提醒：apply 会重启 WorkBuddy，动手前让用户存盘；不要碰 `app.asar`，这个项目只往运行中的渲染进程里注入。

## 长这样

<div align="center">

<img src="docs/images/preview-main.png" width="700" alt="主界面">

<img src="docs/images/preview-menu.png" width="700" alt="主题菜单">

<img src="docs/images/preview-panel.png" width="700" alt="设置面板 · 壁纸库">

</div>

## 能做什么

| | 功能 | 说明 |
|:--:|:---|:---|
| 🎨 | 五款内置主题 | 装上就有，右上角悬浮球点开即换，不用重启。选「原生界面」一秒还原 |
| 🖼️ | Wallpaper Engine 壁纸 | 自动翻本机订阅库，多 Steam 库、跨盘都认；视频壁纸当动态背景播，场景壁纸解包当 4K 静帧 |
| 📁 | 没有 WE 也能用 | 面板里挑个文件夹，里面的视频和项目都能当壁纸库 |
| ✏️ | 自己捏皮肤 | 传一张图就成一个主题，主色辅色自动从画面里取；右键可改名、删除、设为开机默认 |
| ⌨️ | 文案替换 | 侧边栏应用名、欢迎页主标题都能改成你喜欢的句子，主标题还能逐字打出来 |
| 🚀 | 开机带着皮肤 | `scripts/setup-autoskin.ps1` 把桌面/开始菜单/自启入口改成走静默启动器，开机即注入 |

## 五款内置主题

| 主题 | id | 强调色 |
|:---|:---|:---|
| 爱素 | `aisu` | `#e09c84` |
| 春至双背景 · 昼 | `chunzhi-day` | `#dd9fa6` |
| 春至双背景 · 夜 | `chunzhi-night` | `#5d81da` |
| Hatsune Miku · 海色 | `miku-sea` | `#0d9cfa` |
| Summer Moon Hana 4K | `summer-moon` | `#8284f3` |

明暗按 `theme.json` 的 `colors.surface` 判定，判完和 WorkBuddy 自带外观联动 —— 切浅色主题，它跟着变浅色。

自己加一款：把 `theme.json` 和 `hero.webp` 丢进 `themes/你的id/`，再 apply 一次就有了。id 只能用小写字母、数字和连字符。

## 壁纸库

这部分是花心思最多的地方。

没有任何写死的路径。启动后它会从几个常见的 Steam 位置摸起，读 `libraryfolders.vdf` 把所有库都认下来，在 `steamapps/workshop/content/431960/` 里读 `project.json` 列出清单。换台电脑、换个盘符都不用改配置。

| 类型 | 素材在哪 | 怎么用 |
|:---|:---|:---|
| 视频壁纸 | 工程根目录的 `.mp4` / `.webm` | 直接 `<video>` 播放，声音开关 + 音量滑块 |
| 场景壁纸 | 打包在 `scene.pkg` 里 | 内置 RePKG 当场解包，挑最大的贴图当静帧（一般 4K） |
| 网页壁纸 | `files/index.html` | 当不了背景，退化成创意工坊那张预览图 |

面板里能拧的东西：壁纸声音与音量、手动目录、评级筛选（全部 / G / PG-13 / R18）、每页九张的翻页、每张卡片上的「应用」。

视频壁纸的音量和暂停是联动的 —— 暂停自动静音，把音量拖到非 0 自动解除静音并续播。拖音量本身就是在说「我想听」，不用再去点那个开关。

场景壁纸里通常打包着几十张贴图，插件解包后按「16:9 优先、面积次之」挑一张当静帧。只按文件体积挑的话，32 个样本里只有 13 个选对了比例，其余会挑中竖版立绘或 256×256 的缩略图。这不是多图层合成，只是挑对一张 —— 对「背景层就是完整画面」的场景，效果和合成一样。

> 这些壁纸指向的是**你本机**的路径，换台电脑就失效了。创意工坊内容版权归原作者，别打包分发喵。

## 命令行

```bash
node src/cli.mjs list                 # 列出所有主题
node src/cli.mjs apply                # 应用默认主题
node src/cli.mjs apply --theme last   # 恢复上次用的
node src/cli.mjs apply --theme aisu   # 指定一款
node src/cli.mjs pause                # 卸掉皮肤
node src/cli.mjs status               # 看看注入上了没
node src/cli.mjs doctor               # 环境自检
node src/cli.mjs create --image a.png --name "我的主题"
node src/cli.mjs we                   # 盘点本机壁纸库
node src/cli.mjs we-extract           # 解出场景壁纸的原始贴图
```

指定端口换另一个版本：`node src/cli.mjs apply --port 9334`。

从源码跑：

```powershell
node scripts\launch-and-skin.mjs              # 启动 + 注入，一步到位
node scripts\launch-and-skin.mjs --prefer cn  # 两个版本都装着时，挑国内版
node scripts\find-workbuddy.mjs               # 找不到 WorkBuddy 时先跑这个
```

`launch-and-skin.mjs` 只在应用**没带着调试端口**跑的时候才需要；已经带端口开着的话，直接注入就行：

```powershell
node src\cli.mjs apply
node src\cli.mjs apply --theme chunzhi-night
```

装在奇怪地方（既不在 Program Files 也不在 LocalAppData）就设一次环境变量，一劳永逸：

```powershell
[Environment]::SetEnvironmentVariable('WORKBUDDY_EXE', 'D:\path\to\WorkBuddyAI.exe', 'User')
```

## 开机就带着皮肤

皮肤是注入进渲染进程的，所以启动方式决定了它有没有 —— 桌面双击、开始菜单、开机自启这些默认入口都是裸启动，没有调试端口，注入器接不上，于是「换完皮肤，重启就没了」。

`scripts/setup-autoskin.ps1` 一次解决：它翻出所有指向 WorkBuddy 的启动入口（桌面快捷方式、开始菜单、任务栏固定项、自启注册表项），改成走静默启动器 `scripts/autoskin-launch.vbs` —— 带端口启动、等渲染进程、注入、退出。没有黑框，也不常驻内存。

```powershell
.\scripts\setup-autoskin.ps1 -ListOnly    # 先看会改哪些入口，什么都不改
.\scripts\setup-autoskin.ps1 -WorkBuddyExe "D:\Apps\WorkBuddyAI\WorkBuddyAI.exe" -Port 9333
.\scripts\setup-autoskin.ps1 -Undo        # 后悔了，从备份还原
```

它只认**目标可执行文件完全相同**的入口，所以两个版本同时装着也不会互相干扰。改动前会先备份。

> 有个前提：如果 WorkBuddy 此刻正开着而且是裸启动的，第一次得手动退出一下 —— 右键托盘图标选「退出」。之后一律用快捷方式启动，就再也不会落进那个状态。
>
> 为什么不能自动关：WorkBuddy 进程带保护（内置图灵盾），`Stop-Process`、`taskkill /F` 全被拒，连读它的进程所有者都不行。点窗口右上角 × 也只是缩到托盘，进程照样活着。

## 出问题了

**换完没反应** — 跑 `node src/cli.mjs status`，`installed` 是 `false` 就重跑一次 apply。

**重启后皮肤没了** — 故意的。注入的生命周期跟着渲染进程走，进程换了就没了，重跑 apply 就行。

**找不到 WorkBuddy** — `node scripts\find-workbuddy.mjs` 会列出它试过的所有候选路径和命中的那一个。它也会读注册表里的安装位置，所以换盘重装一般不用管。

**壁纸列表是空的** — 先确认 Wallpaper Engine 里有订阅。实在没有，用面板上的「手动目录」挑个文件夹也行。

**5.6 之后的设置窗口没皮肤** — 5.6 起设置变成了独立窗口，插件用 `scripts/watch-targets.mjs` 盯着补注入，启动器默认会拉起它。不想常驻就给 `launch-and-skin.ps1` 加 `-NoWatch`。跨窗口的主题和壁纸状态由 `storage` 事件双向同步。

## 想改代码

```bash
npm run test:static   # 静态检查，不连应用，几秒钟
npm run test:core     # 注入 / 还原 / 幂等
npm run test:ui       # 布局和视觉
npm run test:all      # 全跑一遍
```

`node scripts/run-tests.mjs --list` 能看到每个套件管什么。

打包：`node packaging/build-package.mjs`，默认出 cn 和 intl 两个包，`--edition cn` 只出一个。打包器自带反斜杠自检（1.0.0 那版就是栽在这上面），写完会读回中央目录核对一遍。

仓库里还有个 `scripts/make-skin-from-we.mjs`，能从任意 Wallpaper Engine 条目一键搓出主题 —— 解码、抽帧、取色全在渲染进程里做，不依赖 ffmpeg 也不依赖 sharp。

## 原理和底线

WorkBuddy 是 Electron 应用，渲染进程跑在 `file://` 页面上。用 `--remote-debugging-port` 把它重启起来，通过 CDP 接上 renderer，然后注入一份 CSS 和一段脚本：CSS 覆盖 WorkBuddy 自己的 `--cb-*` 设计变量、铺背景图层、调透明度与模糊；脚本负责主题菜单、文案替换、逐字动画和壁纸的生老病死。

没有构建步骤，没有原生依赖，注入的就是一段普普通通的 JavaScript。

- **不碰官方文件**。不改不替不接管，官方文件从头到尾没人碰过
- **只绑回环**。CDP 监听 `127.0.0.1`，不对外。但皮肤开着的时候，同一用户下的别的程序也能连上这个端口 —— 挂皮肤时别乱跑来源不明的东西
- **注入跟着进程走**。手动重启后皮肤消失是设计如此，不是 bug
- **素材版权**。壁纸内容归原作者，本工具只读本机路径，从不复制也不再分发

## 它是从哪儿来的

从 **WorkBuddy Skin Studio · WorkBuddy 换肤工作室** 长出来的。CDP 注入这套骨架、`--cb-*` 的用法、菜单和设置面板的结构都来自那里，这个 fork 只是接着往下走：接上了 Wallpaper Engine 壁纸库，重做了自定义皮肤链路，内置主题换成二次元向的选图，双版本包和 5.6 兼容也一并补上。

## 谢谢你

- **WorkBuddy Skin Studio · WorkBuddy 换肤工作室** —— 一切的起点
- **RePKG**（MIT）—— 解场景壁纸用的，随仓库带着，不需要 .NET 运行时

## 许可

代码走 MIT。

内置主题的背景图取自 Wallpaper Engine 创意工坊，版权归各自作者，这里只作展示随仓库分发。如果你是作者并且希望移除，开个 issue 就好喵。
