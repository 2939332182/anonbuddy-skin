# 项目记忆 · AnonBuddy Skin

> 给接手维护的人或 AI 看。截至 commit `ee9a6b0` / v1.0.4（2026-09-29）。
> 更早的历史文档在 `docs/HANDOFF.md`、`docs/HANDOVER-FOR-AGENT.md`、`docs/ARCHITECTURE.md` —— 那些描述的是重构前的形态，读的时候注意时效。

## 这是什么

给 WorkBuddy 桌面端（腾讯的 AI 办公客户端）换肤的工具。原理：用 `--remote-debugging-port` 把 WorkBuddy 拉起来，通过本机 CDP 连上它的渲染进程，注入一份 CSS 和一段脚本。**不改 `app.asar`、不改安装目录、不改签名**，效果只活在渲染进程里，进程一换就没了。

仓库：https://github.com/2939332182/anonbuddy-skin
当前版本：**1.0.4**，工作区在 `D:\workbuddy-skin-studio`

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
| `scripts/desk-snapshot.mjs` | 桌面快照/对比：跑包前后各来一次，回答"这包在桌面留了什么" |
| `packaging/build-package.mjs` | 打包入口 |
| `packaging/zip.mjs` | 自己实现的 ZIP 写入器 |
| `tools/repkg/RePKG.exe` | 解场景壁纸，MIT，随仓库分发 |
| `vendor/webwallgl/` | 场景壁纸的实时渲染器（MIT，随包分发、运行期不联网）；`scripts/sync-webwallgl.mjs` 负责同步与哈希校验，**副本不许就地改** |
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

**场景壁纸实测**（要窗口在前台 —— 隐藏时 rAF 不跑、`mount` 不会 resolve；会反复切壁纸，收尾自动还原）：

```bash
node scripts/verify-wwgl.mjs --port 9333                  # 出画/切换/暂停恢复/音量/离开/连点幂等，31 项
node scripts/verify-wwgl.mjs --port 9334 --shot-dir outputs/wwgl-cn
node scripts/probe-wwgl.mjs --port 9333 --render <条目id>  # 单次切场景并看读数
node scripts/probe-settings-window.mjs --port 9334 --open  # 设置独立窗口专项（要先有守护在跑）
node scripts/sync-webwallgl.mjs --check                    # 校验 vendored 副本没被就地改
```

## 维护史

**2026-10-03（v1.0.5）**

- **场景壁纸从「静帧」升级成「真渲染」** —— 接上 WebWallGL 1.4.2（随包 vendored 在 `vendor/webwallgl/`，运行时按需 `<script src>` 加载，不内联进注入 payload）：静态 4K 贴图先铺 → 后台解析 pkg → 首帧就绪后 450ms 淡入顶替；四级降级链（实时渲染 → 静态 4K → 工坊预览图 → 主题取色渐变）保证**任何情况下都不是黑屏**
- 暂停/恢复/音量走实例 API（不重建实例），`releaseWebWallGL()` 进 `dispose()`，反复换壁纸不叠渲染循环
- 新增工具：`scripts/sync-webwallgl.mjs`（vendored 副本同步 + 哈希校验）、`scripts/verify-wwgl.mjs`（两支产品线各跑一遍的实测）、`scripts/probe-wwgl.mjs` / `probe-settings-window.mjs`（探针）
- 实测结果：国际版 **31/31**、国内版 **30/31**（唯一失败是实测脚本自己的收尾 bug，已修）、设置独立窗口专项 **9/9**
- 引擎选 1.4.2 而不是 2.0.2：后者连续创建/销毁渲染实例会泄漏，第 7 个实例起全挂（34 个包只过 1 个）；理由与哈希记在 `vendor/webwallgl/.upstream.json`
- 包体积从 2.80MB 涨到 2.96MB（+160KB 压缩后），换来场景壁纸的动画与交互

**2026-09-27/28（到 v1.0.2 为止）**

- `83e9547` **收缩为 Windows 专用** —— 删掉 `.command` 启动器和 `apply-ai.sh`，README/SKILL 去掉 macOS 分支
- `9547f56` **四批重构** —— 删 118 KB 死代码（`scripts/archive/`）→ Python 打包器换成 Node → 拆 `skin-menu.mjs`（2752 行 → `src/inject/` 11 个分片）→ PowerShell 从 10 个收敛到 2 个
- `cf0ea35` **README 强调易用性 + 发布 1.0.2**

**2026-09-29（v1.0.3 → v1.0.4）** —— 起因只是"打开 WorkBuddy 皮肤没加载"，一路挖出**四个真实故障 + 三项架构改造**。下面「踩过的坑」里 2026-09-29 那几条全出自这一轮。

- `d80b75e` **1.0.3：三项改造**
  - **① 事件驱动首屏注入** —— 新增 `src/skin-guard.mjs` + `scripts/skin-guard.mjs`：连 CDP browser 端点做 `Target.setAutoAttach({waitForDebuggerOnStart:true})`，新渲染进程**一出生就被暂停**，趁暂停期把脚本注册到文档创建点再放行 → 设置窗口首屏即带皮肤，没有轮询延迟、不需要反复 spawn 子进程。取代了 2 秒轮询的 `watch-targets.mjs`（保留作回退，`--no-watch` 两条都不起）。`src/cdp-client.mjs` 相应急扩：事件订阅、`sessionId` 路由、browser 端点发现、`onClose` 回调
  - **② 外部状态文档** —— 新增 `src/active-state.mjs`，把"当前皮肤"记到 `%LOCALAPPDATA%\AnonBuddySkin\state.json`（`mkdtemp` + `flag:'wx'` + `rename` 原子写）。渲染进程经 `Runtime.addBinding` 实时回写，注入器读它作兜底（优先级仍是 localStorage > 文档，见 `09-tunables-icon.js` 的 `hintOk`）
  - **③ 换肤事务** —— `commitTheme`（`src/inject/05-theme-memory.js`）：先拍快照 → 落地 → 任一步抛错按相反顺序回滚。三条切换路径 `setTheme` / `clearTheme` / `applyCustomTheme` 全部接入，自定义主题的 CSS 合成也提到事务外先算
  - 同时修的四个故障：**自动更新吃端口**、**国内版打不开**（快捷方式参数拼写）、**设置窗口漏注入**（错过首次导航）、**标题文案卡死**（rAF 在隐藏页面不执行）
- `7dda199` **1.0.3 补** —— `--prefer` 命中不了时明确警告（它是软偏好，会静默退回另一版，便携版用户必踩）；新增 `scripts/desk-snapshot.mjs`
- `ee9a6b0` **1.0.4** —— `launch-and-skin.mjs` 新增 `--setup` / `--no-setup`；包内「一键换肤.bat」默认带上它，**注入成功后自动接好桌面图标 / 开始菜单 / 开机自启**，用户双击一次即完整体验

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

**`Promise.race` 的超时兜底挂在正常路径上，会把刚成功的那个实例销毁（2026-10-03，1.0.5 实测抓到）。**

WebWallGL 的 `mount()` 只在**首帧画出来之后**才 resolve，而窗口隐藏时 rAF 不跑、首帧永远不来 ——
所以给它加了 `Promise.race` 超时。但"接住迟到实例并销毁"的那个 `.then` 回调**注册在 race 外侧**：
先注册的微任务排在 `await` 续体之前，那一刻 `wwglInstance` 还没赋值，于是
`late !== wwglInstance` 恒为真 → **刚 mount 好的实例被立刻 `destroy()`**。

症状极具迷惑性，值得记住：mount 正常 resolve、日志打「渲染就绪」、canvas 尺寸也对，
但 `wp.info` 永远是 `null`、`stats.fps` 恒为 0。而**探针容器里单独调 `mount()` 一切正常**
（fps 30、info 完整）—— 因为那条路绕过了这段代码，差点被判成"库在这台机器上不行"。
真相是靠对照实验切出来的：同一容器、同一字节、同一 key，走我们的 `renderScene` 就废，
直调就好。

**教训：兜底逻辑要注册在它真正负责的那条分支里**（这里是 `catch` 的超时分支），
不要挂在共享路径上。另外，`we.waitReady()` 那种"只判断存在实例"的等待是**不可靠的**
（上一个实例还没释放时就返回 true），实测脚本要等的是"实例的条目 id 等于目标"。

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
# 3. 提交 + 打标签 + 推送（推送方式看代理当前状态，见「已知限制」那条）
git add -A; git commit -m "chore: 发布 x.y.z"
git tag -a vX.Y.Z -m 'vX.Y.Z'
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin vX.Y.Z
# 4. 建 Release 并传两个附件（脚本见下）
```

**⚠️ 两个必踩的坑，都在 2026-09-29 实发过一次：**
1. **Release 说明必须用 UTF-8 字节发送。** 直接把字符串丢给 `Invoke-RestMethod` 时它不按 UTF-8 编码，中文会整篇变成 `?????`（v1.0.3 第一版说明就这么废了，只能 PATCH 重发）。

   ```powershell
   $json  = @{ tag_name = "vX.Y.Z"; name = "X.Y.Z"; body = $notes; draft = $false } | ConvertTo-Json -Depth 4
   $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
   Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/2939332182/anonbuddy-skin/releases" `
     -Headers $h -Body $bytes -ContentType "application/json; charset=utf-8"
   ```

   取 token（在 git credential 里，`gho_` 前缀 40 字符，有 repo 权限）：

   ```powershell
   $cred  = ("protocol=https`nhost=github.com`n" | git credential fill) 2>$null
   $token = ($cred | Select-String '^password=').Line -replace '^password=', ''
   $h = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "anonbuddy-skin" }
   ```

2. **附件一旦传错，要删掉重传**（同名附件不能覆盖，会 422）。列出现有的：

   ```powershell
   $rel = Invoke-RestMethod -Uri ".../releases/tags/vX.Y.Z" -Headers $h
   $rel.assets | ForEach-Object { Invoke-RestMethod -Method Delete -Uri ".../releases/assets/$($_.id)" -Headers $h }
   ```

   上传记得走 `uploads.github.com`：`.../releases/$($rel.id)/assets?name=<文件名>`，`-ContentType application/zip`。

Release 说明的写法参考：面向下载者，不写代码结构。参考同类项目的语气——`WJZ-P/sona`（写用户能感知的结果）、`BetterNCM-Installer`（极简）、`MomoTalkNTQQ-Theme`（口语化）。

### 第三条路：git 不通时走 API（2026-10-03 发 1.0.5 实发验证）

那天代理**全部**未监听（7897 / 7890 / 10809 / 10808 / 1080 / 8080 全试过），直连 `git fetch`/`git push`
一律 `Empty reply from server` 或 `Recv failure: Connection was reset`（`-c http.version=HTTP/1.1` 也救不了）。
但同一时刻 `api.github.com` 和 `uploads.github.com` **都通** —— 两条路走的中间设备不一样。

于是用 GitHub 的 Git Data API 把提交推上去（blob → tree(base_tree) → commit → PATCH ref），再打标签、
建 Release、传附件，一条命令走完。工具已经落在仓库里：

```powershell
$cred  = ("protocol=https`nhost=github.com`n" | git credential fill) 2>$null
$env:GITHUB_TOKEN = ($cred | Select-String '^password=').Line -replace '^password=', ''
# 默认 dry-run：只打印文件清单与父提交
node scripts/publish-via-api.mjs --tag vX.Y.Z `
  --diff-base <本地基线 sha> --base-sha <远端 main 头> `
  --notes-file outputs/release-notes-X.Y.Z.md `
  --assets dist/xxx-cn.zip dist/xxx-intl.zip
# 确认无误再加 --apply；只补推文件、不动 tag/Release 就加 --skip-tag --skip-release
```

它的安全设计：**不做合并**（`--base-sha` 必须手填远端当前头）、分支更新用 `force:false`、
推完逐文件核对 blob sha、附件核对字节数。**千万别用 `git push --force` 绕过去** —— 发 1.0.5 那次远端
就躺着一个用户自己推的 README 重写（`c713513`），盲推会把它抹掉；正确做法是先把它的内容合进本地
（下载远端文件 → 作为基线 → 重新施加本次改动），再拿它当 parent。

⚠️ 走 API 之后**本地历史会与远端分叉**（本地多个提交 vs 远端一个合并提交，内容与 tree 相同）。
网络恢复后对齐用 `git fetch origin && git reset --hard origin/main`，**先确认两边的 tree 一致**
（`git rev-parse HEAD^{tree}` 对远端 commit 的 tree）再 reset。

**这次发版还有一条值得记住的实测结论**：`git worktree` 建对照基线很好用（`git worktree add <dir> <sha>`，
零成本拿到一份"改动前"的代码去跑同一套测试），但在同一个渲染进程上跑测试时，**测试之间会通过
localStorage 残留状态互相污染** —— 基线那次就因为继承了上一次的 `wePaused=true`，把三条本该失败的断言
"假通过"了。跑这类测试前先复位状态（`node scripts/probe-wwgl.mjs --port <n> --reset`）。

## 当前 Release 状态

| tag | 附件 |
|:---|:---|
| v1.0.5 | `chihayaanon-skin-1.0.5-cn.zip` / `-intl.zip`（场景壁纸真渲染 + 四级降级链） |
| v1.0.4 | `chihayaanon-skin-1.0.4-cn.zip` / `-intl.zip`（一键换肤顺手接好启动入口，用户零额外步骤） |
| v1.0.3 | `chihayaanon-skin-1.0.3-cn.zip` / `-intl.zip`（事件驱动首屏注入 + 状态文档 + 换肤事务） |
| v1.0.2 | `chihayaanon-skin-1.0.2-cn.zip` / `-intl.zip` |
| v1.0.1 | `chihayaanon-skin-1.0.1-cn.zip` / `-intl.zip` |
| v1.0.0 | `chihayaanon-skin-1.0.0.zip`（单包，历史） |

v1.0.1 的两个附件保持原样，不删。
