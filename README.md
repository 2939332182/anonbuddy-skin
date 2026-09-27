<div align="center">

<img src="docs/images/icon.png" width="140" alt="AnonBuddy Skin">

# AnonBuddy Skin

**给 WorkBuddy 桌面端换一身会呼吸的衣服。**

<sub>换一张壁纸，换一种心情</sub>

<sub>WorkBuddy 换肤 / 主题切换 / Wallpaper Engine 壁纸 / 本机 CDP 注入 / 不改一行官方文件</sub>

<br>

<img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-e09c84?style=flat-square" alt="Platform">
<img src="https://img.shields.io/badge/license-MIT-e09c84?style=flat-square" alt="License">
<img src="https://img.shields.io/badge/%E4%B8%8D%E6%94%B9-app.asar-e09c84?style=flat-square" alt="No app.asar">

</div>

---

非腾讯官方产品。不碰 `WorkBuddy.app`、不碰 `app.asar`，也不动安装目录 —— 所有效果都发生在渲染进程里，关掉就还原，官方文件从头到尾没人碰过喵。

> **给 AI 助手看的**：用户把仓库地址发给你、说「用这个帮我换主题」的时候，请直接读根目录的 [`SKILL.md`](SKILL.md)。里面写了平台检测、跑哪个脚本、怎么验证、怎么还原。照做就行喵。

## 这是从哪儿来的

AnonBuddy Skin 的创作来源是 **WorkBuddy Skin Studio · WorkBuddy 换肤工作室** 项目。但是这个项目太过简洁，对我来说还不够满足。

WorkBuddy 是 Electron 写的，渲染进程跑在 `file://` 页面上，那只要用本机回环的 CDP 接上去，样式就能直接注进去 —— 不碰安装目录、不碰签名、不留任何持久化改动。这条路子足够干净，我直接接着走了。

然后往自己喜欢的方向推了几步：

- **接上了壁纸库**。以前只能传一张静态图；现在它会去翻你本机 Wallpaper Engine 的订阅，视频壁纸、场景壁纸都能拿来当背景
- **把自定义皮肤整条链路重做了一遍**。上传、取色、改名、删除、钉成开机默认，每一步都顺手了
- **内置主题全换成二次元向的选图**，五款，装上就有
- **修改了一些字体样式与动画**

走着走着它就有了自己的名字喵。

## 能做什么

**换肤**

- 五款内置主题，装上就有：爱素、春至双背景 · 昼、春至双背景 · 夜、Hatsune Miku · 海色、Summer Moon Hana 4K
- 应用后右上角会冒出一枚悬浮球，点开就是主题列表，点一下立刻换，不用重启
- 想还原就选「原生界面」，官方长相一秒回来

**壁纸**

- 自动找到你本机的 Wallpaper Engine 订阅库（多 Steam 库、跨盘都认）
- 视频壁纸直接当动态背景播，带声音开关和音量滑块
- 场景壁纸解开贴图当高清静帧用（内置 RePKG，不用装 .NET）
- 没装 Wallpaper Engine 也没关系，丢个文件夹进来就是壁纸库

**自定义**

- 传一张图就成一个主题，主色辅色面板色自动从画面里取
- 每次上传都是独立条目，不会把上一张覆盖掉
- 主题行右键：改名、删除、设为开机默认主题
- 侧边栏应用名、欢迎页主标题都能改成你喜欢的句子，主标题还能逐字打出来

## 国际版、国内版都认

WorkBuddy 有两条产品线：国际版走 `workbuddy.ai`，国内版走 `workbuddy.cn`。两边装出来的东西其实不一样 —— 国际版主程序叫 `WorkBuddyAI.exe`、数据目录是 `~/.workbuddy-ai`；国内版主程序叫 `WorkBuddy.exe`、数据目录是 `~/.workbuddy`。

**这个插件两边都认。** 你不用为了换肤去挑版本，也不用改任何配置：它找可执行文件时会把两个名字都试一遍，找 WorkBuddy 自带的那份 Node 时会把两个数据目录都试一遍，重启和还原走的也是同一条路。

两个版本还能同时装在一台机器上 —— 它们的单实例锁（`workbuddy-ai` / `workbuddy`）、任务栏分组和卸载项 GUID 各不相同，互不打架。皮肤是分别注入的，用 `--port` 分开就行：

```bash
node src/cli.mjs apply --port 9333   # 国际版
node src/cli.mjs apply --port 9334   # 国内版
```

### ⬇️ 下载哪个包？给 AI 的判断依据

Release 里**每个版本都有两个包**，插件代码完全相同，只是启动器预设了不同的主程序和端口。**先确定用户装的是哪个版本，再给对应的包**：

| 判断依据 | 下载 |
|:---|:---|
| 程序名是 `WorkBuddyAI.exe`；官网 `workbuddy.ai`；数据目录 `~/.workbuddy-ai`；界面语言默认英文 | **`chihayaanon-skin-<版本>-intl.zip`** |
| 程序名是 `WorkBuddy.exe`；官网 `workbuddy.cn`；数据目录 `~/.workbuddy`；界面默认中文 | **`chihayaanon-skin-<版本>-cn.zip`** |
| 不确定，或两个都装了 | 任意一个包都能用（自动发现两个版本）；两个都装了又想只给某一个换肤，用对应的包 |

Windows 上的快速判定：

```powershell
# 看进程名，一眼就知道
Get-Process | Where-Object { $_.ProcessName -like '*WorkBuddy*' } | Select-Object -Unique ProcessName
# WorkBuddyAI -> 国际版    WorkBuddy -> 国内版
```

包内已经写好了对应版本的主程序名和端口，用户双击 `一键换肤.bat` 就会去找对的那个，不需要额外配置。

<details>
<summary>双版本实测记录（点开看）</summary>

同一台机器上同时跑国际版 5.5.2 和国内版 5.6.2，两边装上的是同一份皮肤：

| 检查项 | 国际版 5.5.2 | 国内版 5.6.2 |
|:---|:---|:---|
| 主程序 | `WorkBuddyAI.exe` | `WorkBuddy.exe` |
| 数据目录 | `~/.workbuddy-ai` | `~/.workbuddy` |
| 渲染进程入口 | `app.asar/renderer/index.html` | `app.asar/renderer/index.html` |
| 页面挂载点 | `#root` | `#root` |
| 首屏骨架类名 | `sk-titlebar` / `sk-sidebar` / `sk-statusbar` … | 完全一致 |
| 注入后 `status` | `installed=true`、`menu=true` | `installed=true`、`menu=true` |
| `window.__anonbuddySkin` | 18 个 API | 同样 18 个 API |
| 换肤设置入口 | 「功能」组 | 「功能」组 |
| 壁纸区域采样色 | 基准 | 逐像素一致 |

两版的渲染进程共用同一套前端代码与挂载点，所以皮肤在两边表现一致。

</details>

### 版本差异导致的坑（都在代码里吸掉了）

5.6.x 相对 5.5.x 有三处结构变化，插件做了兼容，遇到同类问题可以对照排查：

- **设置改成了独立窗口**：5.5.x 的设置是主窗口内的弹层（`.settings-modal-overlay`），5.6.x 是一个**独立的 renderer 窗口**（`windowKind=settings`，根容器 `.settings-modal--window`）。因为注入是启动那一刻的快照，新窗口需要补注入 —— 启动器现在会拉起 `scripts/watch-targets.mjs` 盯着，窗口一出现就补上，不想常驻可以加 `-NoWatch`。
- **网格容器多了层实底**：5.6.x 给没有 `data-view-id` 的 `_gridView_*` 容器加了 78% 不透明的浅色底，会把壁纸下半部分洗白（看着像人物被放大、整屏发灰）。插件用 `[class*="_gridView_"]:not([class*="_gridViewItem_"])` 把它压透明，前缀匹配所以不受构建哈希（`_1ens7_` / `_7xbcw_`）变化影响。
- **子窗口少一个属性、多一段安全区**：独立设置窗口的 `body` 上**没有** `data-application-name`（主窗口有），而 `skin.css` 的配色规则全挂在这个属性上；同时它的窗口顶部有 62px 原生「安全区」（面板从 y=62 才开始），壁纸按 `inset:0` 铺满整窗时会在那里露出一条。插件的处理：给子窗口 `body` 补一个自己的标记 `data-wb-child-window="1"`（不动原生属性），配色规则多一个入口；子窗口干脆不铺壁纸层。

## 长这样

<div align="center">

**主界面**

<img src="docs/images/preview-main.png" width="720" alt="主界面">

**主题菜单**（点右上角那颗球）

<img src="docs/images/preview-menu.png" width="720" alt="主题菜单">

**设置面板 · 壁纸库**

<img src="docs/images/preview-panel.png" width="720" alt="设置面板">

</div>

## 装起来

先把 WorkBuddy 手头的东西存一下，因为它会被重启喵。

### 下载即用版（不想碰命令行就用这个）

去 [Releases](https://github.com/2939332182/anonbuddy-skin/releases/latest) 按上面那张表挑对应的包下载（`chihayaanon-skin-1.0.1-cn.zip` 或 `chihayaanon-skin-1.0.1-intl.zip`），解压到哪儿都行，然后双击：

- Windows：`一键换肤.bat`
- macOS：`一键换肤.command`

它会自己找 Node 运行时（优先用 WorkBuddy 自带的那份，所以你不用单独装），
重启 WorkBuddy，把皮肤注进去。不想要了就双击 `一键还原.bat`，
然后把文件夹直接删掉就行。

> 包里也带了份 `使用说明.txt`，没耐心看文档的人看那个就够了。

### 让 AI 帮你装（最省事）

把仓库地址丢给你常用的 AI，附一句话：

> 用这个开源项目帮我更换 WorkBuddy 的主题

它会自己克隆、读 `SKILL.md`、检测平台、跑脚本、验证结果。你只需要在弹窗里点保存。

### macOS

```bash
# 双击 scripts/apply.command 也行
./scripts/apply.command

# 想指定主题
node src/cli.mjs apply --theme chunzhi-night
```

### Windows

```powershell
.\scripts\apply.ps1

# 想指定主题
.\scripts\apply.ps1 -Theme chunzhi-night

# 找不到 WorkBuddy.exe 时先跑这个
.\scripts\find-workbuddy.ps1
```

装在奇怪地方（既不在 Program Files 也不在 LocalAppData）的话，设一次环境变量就一劳永逸：

```powershell
[Environment]::SetEnvironmentVariable('WORKBUDDY_EXE', 'D:\path\to\WorkBuddyAI.exe', 'User')
```

## 让它开机就带着皮肤

皮肤是注入进渲染进程的，所以**启动方式**决定了它有没有。桌面双击、开始菜单、开机自启——默认这些入口都是裸启动，没有调试端口，注入器无处可接，于是「换完皮肤，重启就没了」。

`scripts/setup-autoskin.ps1` 把这件事一次解决：它翻出所有指向 WorkBuddy 的启动入口（桌面快捷方式、开始菜单、任务栏固定项、开机自启的注册表项），改成走一个静默启动器 `autoskin-launch.vbs` —— 带端口启动、等渲染进程、注入、退出。看不到黑框，也不会常驻内存。

```powershell
# 先看看会改哪些入口，什么都不改
.\scripts\setup-autoskin.ps1 -ListOnly

# 绑定国内版
.\scripts\setup-autoskin.ps1 -WorkBuddyExe "D:\Downloads\WorkBuddy-CN\portable\WorkBuddy.exe" -Port 9334

# 绑定国际版
.\scripts\setup-autoskin.ps1 -WorkBuddyExe "D:\Apps\WorkBuddyAI\WorkBuddyAI.exe" -Port 9333

# 后悔了，一键还原
.\scripts\setup-autoskin.ps1 -Undo
```

它只认**目标可执行文件完全相同**的入口，所以两个版本同时装在一台机器上也不会互相干扰，各自走各自的端口。改动前会先备份，`-Undo` 从备份还原。

> **有一个前提**：如果 WorkBuddy 此刻正开着、而且是裸启动的，第一次得你手动退出一下 —— 右键点托盘图标选「退出」。之后一律用快捷方式启动，就再也不会落进那个状态了。
>
> 为什么不能自动帮你关：WorkBuddy 的进程带保护（内置的图灵盾），`Stop-Process`、`taskkill /F` 全都会被拒，连读它的进程所有者都不行。点窗口右上角的 × 也只是缩到托盘，进程照样活着。

## 五款内置主题

| 主题 | id | 强调色 | 明暗 |
|:---|:---|:---|:---|
| 爱素 | `aisu` | `#e09c84` | 浅色 |
| 春至双背景 · 昼 | `chunzhi-day` | `#dd9fa6` | 浅色 |
| 春至双背景 · 夜 | `chunzhi-night` | `#5d81da` | 浅色 |
| Hatsune Miku · 海色 | `miku-sea` | `#0d9cfa` | 浅色 |
| Summer Moon Hana 4K | `summer-moon` | `#8284f3` | 浅色 |

明暗是按 `theme.json` 里的 `colors.surface` 判的，判完会和 WorkBuddy 自带的外观联动 —— 切浅色主题，它跟着变浅色。

想自己加一款：把 `theme.json` 和 `hero.webp` 塞进 `themes/你的id/`，再 apply 一次就出现了喵。id 只能用小写字母、数字和连字符。

## 壁纸库

这部分是花心思最多的地方。

### 它怎么找到壁纸的

没有任何写死的路径。启动之后它会：

1. 从几个常见的 Steam 安装位置开始摸（`C:\Program Files (x86)\Steam`、`D:\Steam` 之类）
2. 读 `libraryfolders.vdf`，把**所有** Steam 库都认下来（多盘多库很常见）
3. 在库里找 `steamapps/workshop/content/431960/`（431960 就是 Wallpaper Engine 的 id）
4. 一条条读 `project.json` 认类型，列成清单

所以换台电脑、换个盘符，都不用改任何配置，它读的永远是你自己那台机器的库喵。

### 三种素材，三种活法

| 类型 | 素材在哪 | 怎么用 |
|:---|:---|:---|
| 视频壁纸 | 工程根目录的 `.mp4` / `.webm` | 直接 `<video>` 播放，有声音开关和音量滑块 |
| 场景壁纸 | 打包在 `scene.pkg` 里 | 内置 RePKG 当场解包，挑最大的贴图当静帧（一般是 4K） |
| 网页壁纸 | `files/index.html` | 当不了背景，退化成创意工坊那张预览图 |

### 面板里能拧什么

- **壁纸声音 / 音量** —— 视频壁纸专属。默认静音起播（不这样的话浏览器不给自动播），开了开关就有声
- **手动目录** —— 没有 Wallpaper Engine？随便挑个文件夹，里面的视频和项目都能用
- **评级筛选** —— 全部 / G / PG-13 / R18，评级是从 `project.json` 的 `contentrating` 读的
- **翻页** —— 每页九张，带页码和跳转
- **每张卡片** —— 类型标签、评级角标、一个「应用」按钮

> 这些壁纸指向的是**你本机**的路径，换台电脑就失效了。创意工坊的内容版权归原作者，别打包分发喵。

## 自己捏皮肤

菜单里点「＋ 自定义图片」，挑一张你电脑里的图就行。它会：

1. 把图压到合适大小（免得撑爆 localStorage）
2. 从画面里挑四个颜色：主色、辅色、面板底色、文字色
3. 立刻生效，并且作为一个独立主题留在菜单里

传多少次都行，之前的都在，不会互相盖掉。

### 钉成开机默认

主题行右键，选「设为开机默认主题」。以后每次开 WorkBuddy 都从它开始，比「上次用的那个」优先级高。再点一次取消。

Wallpaper Engine 的壁纸条目没有这个入口 —— 它们的 id 指向本机绝对路径，换台电脑就是死链，钉成默认只会得到一个打不开的开局喵。两套机制互不干扰。

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

## 出问题了

**换完皮肤没反应？**
跑一下 `node src/cli.mjs status`。`installed` 是 `false` 就重跑一次 apply。

**重启 WorkBuddy 后皮肤没了？**
这是故意的。注入的生命周期跟着渲染进程走，进程换了就没了。重跑 apply 就行喵。

**找不到 WorkBuddy？**
`.\scripts\find-workbuddy.ps1` 会告诉你它到底装哪儿了。

**壁纸列表是空的？**
先确认 Wallpaper Engine 里有订阅。实在没有，用面板上的「手动目录」挑个文件夹也能用喵。

## 想改代码

```bash
npm run test:static   # 静态检查，不连应用，几秒钟
npm run test:core     # 注入 / 还原 / 幂等
npm run test:ui       # 布局和视觉
npm run test:all      # 全跑一遍
```

`node scripts/run-tests.mjs --list` 能看到每个套件管什么。

仓库里还有个 `scripts/make-skin-from-we.mjs`，能从任意 Wallpaper Engine 条目一键搓出主题 —— 解码、抽帧、取色全在渲染进程里做，不依赖 ffmpeg，也不依赖 sharp。

## 几条底线

- **不碰官方文件**。不改、不替、不接管 `WorkBuddy.app`、`app.asar`，也不动安装目录的归属
- **只绑回环**。CDP 监听 `127.0.0.1`，不对外。但皮肤开着的时候，同一个用户下的别的程序也能连上这个端口 —— 所以挂皮肤时别乱跑来源不明的东西喵
- **注入跟着进程走**。手动重启后皮肤消失是设计如此，不是 bug
- **素材版权**。壁纸内容归原作者，本工具只读本机路径，从不复制、也不再分发

## 它是怎么工作的

WorkBuddy 的渲染进程本身是个 `file://` 页面。我们用 `--remote-debugging-port=9333` 把它重启起来，通过 CDP 接上 renderer，然后做两件事：

1. 注入一份 CSS —— 覆盖 WorkBuddy 自己的 `--cb-*` 设计变量、铺背景图层、调透明度与模糊
2. 注入一段脚本 —— 渲染主题菜单、接管文案替换、驱动逐字动画、管壁纸的生老病死

没有构建步骤，没有原生依赖，注入的就是一段普普通通的 JavaScript。

## 谢谢你

- **WorkBuddy Skin Studio · WorkBuddy 换肤工作室** —— 一切的起点。CDP 注入这套骨架、`--cb-*` 的用法、菜单和设置面板的结构，都是从那儿来的。这个 fork 只是站在它铺好的路上继续往前走喵
- **RePKG**（MIT） 解场景壁纸用的，随仓库带着，不需要 .NET 运行时

## 许可

代码走 MIT。

内置主题的背景图取自 Wallpaper Engine 创意工坊，版权归各自作者，这里只作展示随仓库分发。如果你是作者并且希望移除，开个 issue 就好喵。
