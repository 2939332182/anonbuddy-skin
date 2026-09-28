# 项目记忆 · AnonBuddy Skin

> 给接手维护的人或 AI 看。截至 commit `d80b75e` / v1.0.3（2026-09-29）。
> 更早的历史文档在 `docs/HANDOFF.md`、`docs/HANDOVER-FOR-AGENT.md`、`docs/ARCHITECTURE.md` —— 那些描述的是重构前的形态，读的时候注意时效。

## 这是什么

给 WorkBuddy 桌面端（腾讯的 AI 办公客户端）换肤的工具。原理：用 `--remote-debugging-port` 把 WorkBuddy 拉起来，通过本机 CDP 连上它的渲染进程，注入一份 CSS 和一段脚本。**不改 `app.asar`、不改安装目录、不改签名**，效果只活在渲染进程里，进程一换就没了。

仓库：https://github.com/2939332182/anonbuddy-skin
当前版本：**1.0.2**，工作区在 `D:\workbuddy-skin-studio`

## 先记住这几条硬约束

1. **只支持 Windows。** macOS 那套曾经存在过，因为长期没有实机验证（`.command` 启动器的权限位、app 名、node 路径全有问题），在 commit `83e9547` 里整体移除了。不要再往跨平台方向走，除非有人能真的在 mac 上跑。

2. **不碰官方文件是底线。** 一切通过 CDP 注入到运行中的渲染进程，不改 `app.asar`、不改快捷方式指向的 exe、不做持久化落盘改动（除了用户自己的 localStorage）。

3. **注入脚本是一个字符串，不是模块。** `src/skin-menu.mjs` 的产出是一大段要在 renderer 里求值的 JS 文本。它的正文拆在 `src/inject/*.js` 里，那些文件**只能读、不能 import**，顺序即声明顺序。

4. **WorkBuddy 的进程有保护。** 内置 `native/turing-sdk`（腾讯图灵盾）。`Stop-Process`、`taskkill /F`、CIM `Terminate()` 全部被拒（Access is denied），连 `GetOwner()` 都不给。`CloseMainWindow()` 能调通，但应用把 WM_CLOSE 当"收进托盘"，进程照活。所以：**想让用户关掉它，只能请他从托盘图标选「退出」**。这也是 `launch-and-skin.mjs` 会停下来等用户的原因。

5. **两个产品线，两套名字。** 国际版走 `workbuddy.ai`，主程序 `WorkBuddyAI.exe`、数据目录 `~/.workbuddy-ai`、默认端口 9333；国内版走 `workbuddy.cn`，主程序 `WorkBuddy.exe`、数据目录 `~/.workbuddy`、默认端口 9334。两者单实例锁 / 任务栏分组 / 卸载项 GUID 都不同，**可以并存**。这些值来自各自构建的 `product.json`（`win32ExecutableName` / `dataFolderName` / `isOversea`）。

## 一次换肤要经过哪些文件

```
双击 一键换肤.bat                        ← 包内生成，调下一行（带 --setup）
  └─ node scripts/launch-and-skin.mjs    ← 启动 + 等待 + 注入 + 拉常驻守护 + 接好启动入口
       ├─ src/platform/workbuddy-path.mjs ← 找主程序（51 候选 + 注册表）、找 node、推端口
       ├─ node src/cli.mjs apply          ← 校验主题、组装 payload
       │    └─ src/injector.mjs           ← 连 CDP、找 renderer target、注入
       │         ├─ src/cdp-client.mjs    ← CDP 会话与 target 发现
       │         ├─ src/skin-menu.mjs     ← 拼注入脚本（正文读 src/inject/*.js）
       │         └─ src/skin-css.mjs      ← 拼皮肤 CSS（正文读 src/css/skin.css）
       └─ node scripts/skin-guard.mjs     ← 常驻守护：新渲染进程一出生就注入
            └─ src/skin-guard.mjs         ← browser 端点 + Target.setAutoAttach
                 ├─ src/active-state.mjs  ← 状态文档（state.json）原子读写
                 └─ src/cdp-client.mjs    ← CDP 会话（browser 级 + 事件订阅）
```

5.6.x 起设置是**独立 renderer 窗口**，在启动那一刻的注入之后才创建，所以需要一条常驻的补注入线路。现在默认走 `scripts/skin-guard.mjs`：连 browser 端点做 `Target.setAutoAttach({waitForDebuggerOnStart:true})`，新渲染进程**一出生就被暂停**，趁暂停期把脚本装到"文档创建点"上再放行 —— 首屏直接带皮肤、没有轮询延迟、不需要反复 spawn 子进程。老的 `scripts/watch-targets.mjs`（2 秒轮询 `/json/list`，发现新 target 就 spawn 一个 `cli apply`）**保留着当回退路径**，两条路职责相同实现不同；`launch-and-skin.mjs` 里 `--no-watch` 两条都不起。

## 目录速查

| 路径 | 是什么 |
|:---|:---|
| `src/` | 注入逻辑本体（Node 侧） |
| `src/inject/*.js` | 注入到 renderer 的脚本正文，11 个分片，**不是 ES 模块** |
| `src/skin-guard.mjs` | 常驻守护：browser 端点 + auto-attach，新渲染进程首屏注入 |
| `src/active-state.mjs` | 状态文档 `state.json` 的原子读写（临时文件 + rename） |
| `scripts/skin-guard.mjs` | 守护的 CLI 入口（启动器拉起的就是它，日志落 `AnonBuddySkin\injector.log`） |
| `src/css/skin.css` | 皮肤样式正文，占位符 `{{accent}}` 之类由 `skin-css.mjs` 填充 |
| `src/platform/` | 宿主适配（路径解析） |
| `themes/<id>/` | 内置主题，每个是 `theme.json` + `hero.webp` |
| `scripts/test-*.mjs` | 23 个 e2e 测试 |
| `scripts/probe-*.mjs` / `shot-*.mjs` | 调试探针，一次性排查用，不是运行时依赖 |
| `packaging/build-package.mjs` | 打包入口 |
| `packaging/zip.mjs` | 自己实现的 ZIP 写入器 |
| `tools/repkg/RePKG.exe` | 解场景壁纸，MIT，随仓库分发 |
| `dist/` | 打包产物，已 gitignore |

## 常用命令

```bash
# 看注入状态（9333 国际版 / 9334 国内版）
node src/cli.mjs status
node src/cli.mjs doctor

# 启动 + 注入（应用没带端口跑着时用这个）
node scripts/launch-and-skin.mjs
node scripts/launch-and-skin.mjs --prefer cn --port 9334

# 只注入（应用已经带端口开着）
node src/cli.mjs apply --theme aisu

# 卸掉
node src/cli.mjs pause
```

**测试**：改注入脚本或 CSS 后**先跑 lint 再跑静态套件**。

```bash
node scripts/lint-menu.mjs            # 语法 + Node 作用域泄漏 + 关键实现点名，秒级
node scripts/run-tests.mjs --suite static   # 不连应用，秒级
node scripts/run-tests.mjs --suite core     # 注入/还原/幂等（需要应用在跑）
node scripts/run-tests.mjs --list           # 看套件与用例
```

**打包发布**：

```bash
node packaging/build-package.mjs                    # 出 cn + intl 两个包
node packaging/build-package.mjs --edition cn       # 只出一个
```

包名规则 `chihayaanon-skin-<版本>-<cn|intl>.zip`，两个包插件代码相同，只有启动器预设的主程序名和端口不同。

## 这一轮维护做过什么

三个 commit，都在 2026-09-27/28：

- `83e9547` **收缩为 Windows 专用** —— 删掉 `.command` 启动器和 `apply-ai.sh`，README/SKILL 去掉 macOS 分支
- `9547f56` **四批重构** —— 删 118 KB 死代码（`scripts/archive/`）→ Python 打包器换成 Node → 拆 `skin-menu.mjs`（2752 行 → `src/inject/` 11 个分片）→ PowerShell 从 10 个收敛到 2 个
- `cf0ea35` **README 强调易用性 + 发布 1.0.2**

更早一次（`e8eb330` 之前）还修过一个换盘遗留问题：`WORKBUDDY_EXE` 环境变量指向已卸载的旧盘，导致 Node 侧的路径解析全挂。现在路径解析会读注册表卸载项的 `DisplayIcon`，环境变量坏掉也能自愈。

## 踩过的坑（会重复踩的）

**模板字面量会吃掉一层转义，还会规范行尾。** 按 ECMAScript 规范，模板字面量里的 `<CR><LF>` 变成一个 LINE FEED，`\\uXXXX` 变成 `\uXXXX`。所以从**源码**切分片会同时丢掉这两层——必须从**求值后的产物**切。这一条在拆 `skin-menu.mjs` 时踩实了：第一版切出来 142072 字节（应为 139222），注入内容里 `\uff08` 变成了 `\\uff08`。

**文件是 CRLF，但注入内容必须是 LF。** 源文件 CRLF，模板字面量求值后是 LF。分片用 `readFileSync` 读进来是 CRLF，所以 `readInjectedScript()` 里有一句 `replace(/\r\n?/g, "\n")`，**别删**。

**`lint-menu.mjs` 的泄漏体检**会读 `src/skin-menu.mjs` 的模块作用域声明，比对最终产物里有没有同名标识符。所以在装配器里加变量时别用注入脚本里可能出现的名字。

**JS 位运算溢出**：`0o100644 << 16` 超出有符号 32 位变负数，`writeUInt32LE` 直接抛 RangeError。`packaging/zip.mjs` 里已经 `>>> 0` 修好。

**`Buffer.indexOf(数字)` 只匹配单字节**，不是 4 字节签名。`verifyZipNames` 改成从 EOCD 反向解析中央目录。

**ZIP 必须用正斜杠**（APPNOTE 4.4.17.1）。1.0.0 那个包 44 个条目全是反斜杠，严格解压器会丢掉目录树。打包器写盘前后各校验一次。

**`homedir` 在 `node:os` 不在 `node:path`。**

**WorkBuddy 自动更新会把调试端口吃掉。** 应用更新时先以 `reason=update` 关掉旧进程，再由更新器拉起新进程（`source=app_startup` / `startup_type=upgrade`），**原始命令行参数不被继承**，`--remote-debugging-port` 就此消失。表现：更新前皮肤正常，更新后打开是裸的，`cli.mjs status` 报 `fetch failed`，`9333`/`9334` 全空。这不是故障，是"不碰官方文件"的代价——更新一次就得重走一次启动器。判定方法：看 `~/.workbuddy-ai/logs/AppStartup.log`，`[AppShutdown] ... reason=update` 紧跟 `[AppStartup] ... source=app_startup`，再跟一行 `startup_type=upgrade` 就是它。（2026-09-29 实例：5.5.2 → 5.6.2，build `910352f0` → `bd96da3a`。）

**`setup-autoskin.ps1` 是"一个 exe 绑一次"，不是全局开关。** 它按 `TargetPath -ieq $ExePath` 精确匹配，所以国际版和国内版各要跑一遍（`-Prefer intl -Port 9333` / `-Prefer cn -Port 9334`），绑定状态记在 `%LOCALAPPDATA%\AnonBuddySkin\autoskin-setup.json`。只绑了一个版本时，另一个版本的图标可能停在"直连 exe + `--remote-debugging-port`"的半截状态——**只开端口、没有注入环节**，双击出来是带端口的裸应用，一样没皮肤。

**`Page.addScriptToEvaluateOnNewDocument` 的脚本跑在"文档创建点"，那里 `<head>` 和 `<body>` 都还不存在。** 注入脚本正文两头都依赖它们（`document.head.appendChild(style)` / `document.body.appendChild(root)`），直接跑必抛 TypeError。最阴的是**症状**：注册调用返回成功、守护日志里一条错误都没有，重载后页面干干净净；换成 30 字节的探针 `window.__x=1` 却能稳稳活过重载 —— 很容易误判成"注册机制不work"。所以 `skin-menu.mjs` 的包裹层会先等 `document.body` 出现再执行正文。（只等 head 不够：会在 `appendChild(body)` 那一行再炸一次，实测现象是 style 建出来了、菜单和主题都没有。）

**CDP 会话有两种，寿命不一样。** `Target.setAutoAttach` 自动附加出来的会话**能活过页面重载**；`Target.attachToTarget` 显式附加出来的**活不过重载**，注册在它上面的 `addScriptToEvaluateOnNewDocument` 随之失效。偏偏 `setAutoAttach` 会把"已经在跑的" target 一并附加上，于是同一个窗口拿到两个会话。别挑一个用 —— **每个会话都注册一份**（注入脚本幂等，重复注册只多跑一次）。

**`Target.attachedToTarget` 的 `sessionId` 在 `params` 里**，不在消息顶层。顶层那个 `sessionId` 只有"子会话发出的事件"（如 `Runtime.bindingCalled`）才有。分不清这两者会写出永远拿不到 sessionId 的代码，症状是"事件收到了但什么都没发生"。

**`requestAnimationFrame` 在页面不可见时完全不执行。** 窗口最小化或收进托盘时 rAF 一个回调都不来（实测 300ms 内零回调，`Page.bringToFront` 也唤不回最小化的窗口）。`08-copy-typewriter.js` 的 `scheduleCopy` 一度把"重置标志位"写在 rAF 回调里，于是第一次排队的回调不来、`copyScheduled` 永久卡在 true，之后所有自动修复全被它挡掉 —— 表现是切页之后标题再也不变回来。现在 rAF / `setTimeout` / `queueMicrotask` 三路兜底（microtask 不受可见性影响，隐藏场景靠它）。连带影响：`test-roll-anim.mjs` 靠逐帧采样，窗口不可见时采不到帧，现在会明确 SKIP 并提示切到前台，而不是报一个误导性的 FAIL。

**快捷方式的参数拼写必须和启动器对齐，而 vbs 是把参数原样透传的。** `setup-autoskin.ps1` 的 `$vbsArgs` 一度写成 PowerShell 风格的 `-WorkBuddyExe ... -Port ...`，而 `launch-and-skin.mjs` 只认 `--exe / --port` → 双击图标时启动器当场抛「无法识别的参数」然后退出；**vbs 又是用隐藏窗口跑的（`shell.Run cmd, 0, False`），报错一个字都传不到眼前** → 症状就是"点了没反应 / 国内版打不开"。两头都要堵：启动器加 `ARG_ALIASES` 认下旧拼写（让已经绑好的图标记即恢复），生成的快捷方式改成规范双横线。

**已绑定的快捷方式里 `TargetPath` 是 `wscript.exe`，不再是 app 的 exe。** `Get-LaunchEntries` 原本只匹配 `TargetPath -ieq $ExePath`，于是**绑定过的入口再也不会被识别** —— 参数格式过期也永远改不回来（实测：重跑绑定只动到了 Run 键，桌面图标纹丝不动）。现在同时匹配"已指向本启动器且参数里带着这个 exe"的形态，`skip (already bound)` 也从"凡绑定就跳过"改成"只在参数已是当前格式时才跳过"。

**`Page.addScriptToEvaluateOnNewDocument` 只对**之后**创建的文档生效，而窗口从 `about:blank` 走到真实页面可能就发生在"注册"这几毫秒里。** 实测（2026-09-29）：国内版设置窗口的日志停在「已预置首屏脚本 10970EF6（等待导航）」，之后杳无音信，设置里也就看不到插件入口；**手动 reload 一次皮肤立刻全好** —— 这说明注册机制本身没问题，只是那一次导航被错过了。守护现在注册完之后会重新问一次 `location.href`：窗口若仍被 `waitForDebuggerOnStart` 暂停着，`Runtime.evaluate` 会因为还没有执行上下文而失败（那就是真的还没导航，继续等首屏脚本即可）；否则说明已经错过，补一次即时注入。

## 已知限制与待办

- **皮肤不持久**。手动重启 WorkBuddy 后就没了，这是设计如此。开机自带靠 `scripts/setup-autoskin.ps1` 把入口改接到 `autoskin-launch.vbs` → `launch-and-skin.mjs`；**包内的「一键换肤.bat」带 `--setup` 会自动做掉这一步**（见 `launch-and-skin.mjs` 第 5 段），用户双击一次就拿到完整体验，不用再读文档跑第二条命令。
- **保留的 3 个非 Node 脚本**是有理由的，别顺手删：`setup-autoskin.ps1` + `workbuddy-path.ps1` 要驱动 `WScript.Shell` COM 改写 `.lnk`（Node 没有对等接口）；`autoskin-launch.vbs` 是唯一能让快捷方式启动子进程不闪控制台窗口的手段。
- **`scripts/` 里还有 20 多个探针脚本**（`probe-*` / `shot-*` / `check-*`）。它们是排查工具不是运行时依赖，没有进发布包。要清理的话先确认 `test-scripts-registry.mjs` 还过。
- **`docs/` 里的历史数据不要删。** `ARCHITECTURE.md` 里有针对已移除主题的对比度实测、macOS 时代的 `MENUBAR_HEIGHT` 讨论——那是解释"为什么这么修"的历史记录。
- **代理时有时无，别被它卡住，也别把任何一条当永久事实。** 两种状态都实测出现过：
  - 2026-09-29 发 1.0.3 时**直连被 RST**（`Empty reply from server` / `Recv failure: Connection was reset`），必须**走代理**：
    ```bash
    git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
    ```
  - 更早一次则是反过来的：代理停着，`git push` 报 `Failed to connect to github.com:443 over proxy 127.0.0.1`，那时去掉 `-c` 参数直连即可。

  所以别照抄某一次的命令，先看 `127.0.0.1:7897` 有没有在监听、以及报错是"连不上代理"还是"被对端 RST"，再决定走哪边。
- **发布用的 token 在 git credential 里**（`gho_` 前缀，40 字符，有 repo 权限）。创建 Release 和上传附件走 `api.github.com` + `uploads.github.com`，`Invoke-RestMethod` 默认走系统代理；代理停着也能直连。

## 发布流程（照抄即可）

```powershell
cd D:\workbuddy-skin-studio
# 1. 改 package.json 的 version
# 2. 打包
node packaging/build-package.mjs
# 3. 提交 + 打标签 + 推送
git add -A; git commit -m "chore: 发布 x.y.z"
git tag -a vX.Y.Z -m 'vX.Y.Z'
git push origin main; git push origin vX.Y.Z
# 4. 建 Release 并传两个附件（用 git credential 里的 token）
```

Release 说明的写法参考：面向下载者，不写代码结构。参考同类项目的语气——`WJZ-P/sona`（写用户能感知的结果）、`BetterNCM-Installer`（极简）、`MomoTalkNTQQ-Theme`（口语化）。

## 当前 Release 状态

| tag | 附件 |
|:---|:---|
| v1.0.3 | `chihayaanon-skin-1.0.3-cn.zip` / `-intl.zip`（事件驱动首屏注入 + 状态文档 + 换肤事务） |
| v1.0.2 | `chihayaanon-skin-1.0.2-cn.zip` / `-intl.zip` |
| v1.0.1 | `chihayaanon-skin-1.0.1-cn.zip` / `-intl.zip` |
| v1.0.0 | `chihayaanon-skin-1.0.0.zip`（单包，历史） |

v1.0.1 的两个附件保持原样，不删。
