# 项目记忆 · AnonBuddy Skin

> 给接手维护的人或 AI 看。截至 commit `cf0ea35` / v1.0.2（2026-09-28）。
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
双击 一键换肤.bat                        ← 包内生成，调下一行
  └─ node scripts/launch-and-skin.mjs    ← 启动 + 等待 + 注入 + 拉 watcher
       ├─ src/platform/workbuddy-path.mjs ← 找主程序（51 候选 + 注册表）、找 node、推端口
       └─ node src/cli.mjs apply          ← 校验主题、组装 payload
            └─ src/injector.mjs           ← 连 CDP、找 renderer target、注入
                 ├─ src/cdp-client.mjs    ← CDP 会话与 target 发现
                 ├─ src/skin-menu.mjs     ← 拼注入脚本（正文读 src/inject/*.js）
                 └─ src/skin-css.mjs      ← 拼皮肤 CSS（正文读 src/css/skin.css）
```

`scripts/watch-targets.mjs` 是另一条线：5.6.x 起设置是**独立 renderer 窗口**，在我们注入之后才创建，所以需要一个常驻进程轮询 CDP、发现新窗口就补一次注入（约 40 MB，`--no-watch` 可关）。

## 目录速查

| 路径 | 是什么 |
|:---|:---|
| `src/` | 注入逻辑本体（Node 侧） |
| `src/inject/*.js` | 注入到 renderer 的脚本正文，11 个分片，**不是 ES 模块** |
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

## 已知限制与待办

- **皮肤不持久**。手动重启 WorkBuddy 后就没了，这是设计如此。想开机自带要跑 `scripts/setup-autoskin.ps1`（它会把桌面/开始菜单/自启入口改接到 `autoskin-launch.vbs` → `launch-and-skin.mjs`）。
- **保留的 3 个非 Node 脚本**是有理由的，别顺手删：`setup-autoskin.ps1` + `workbuddy-path.ps1` 要驱动 `WScript.Shell` COM 改写 `.lnk`（Node 没有对等接口）；`autoskin-launch.vbs` 是唯一能让快捷方式启动子进程不闪控制台窗口的手段。
- **`scripts/` 里还有 20 多个探针脚本**（`probe-*` / `shot-*` / `check-*`）。它们是排查工具不是运行时依赖，没有进发布包。要清理的话先确认 `test-scripts-registry.mjs` 还过。
- **`docs/` 里的历史数据不要删。** `ARCHITECTURE.md` 里有针对已移除主题的对比度实测、macOS 时代的 `MENUBAR_HEIGHT` 讨论——那是解释"为什么这么修"的历史记录。
- **代理时有时无，别被它卡住。** 这台机器上 `127.0.0.1:7897` 的代理会停。停了以后 `git push` 会报 `Failed to connect to github.com:443 over proxy 127.0.0.1` —— 这时候直接绕过代理推：

  ```bash
  git -c http.proxy= -c https.proxy= push origin main
  ```

  仓库级原本配了 `http.proxy`，已经摘掉了（直连能走通）。如果哪天直连被 RST 了再把代理配回去。
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
| v1.0.2 | `chihayaanon-skin-1.0.2-cn.zip` / `-intl.zip` |
| v1.0.1 | `chihayaanon-skin-1.0.1-cn.zip` / `-intl.zip` |
| v1.0.0 | `chihayaanon-skin-1.0.0.zip`（单包，历史） |

v1.0.1 的两个附件保持原样，不删。
