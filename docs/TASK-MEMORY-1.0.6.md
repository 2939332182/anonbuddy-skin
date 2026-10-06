# 任务记忆 · 2026-10-04 · anonbuddy-skin 1.0.6

> 给接手这个仓库的人或 AI 看。这一轮从"接手复核 1.0.5 交接简报"开始，做到 1.0.6 发布收官。
> 读这份之前先读 [PROJECT-MEMORY.md](PROJECT-MEMORY.md) —— 那里是长期记忆，这里是这一轮的过程记录。

---

## 一、已完成工作

### 1. 接手复核 1.0.5 交接简报

- **起因**：简报声称「工作区干净、与远端内容一致」，需核实。
- **处理**：逐项比对版本、tree、vendor 哈希、端口、测试。
- **验证**：本地 tree `e0ca6a60af8031d71e9f1420a05875ffbefdcabd` == 远端 tree；`vendor/webwallgl/webwallgl-1.4.2.global.min.js` 950,112 字节、sha256 `A40B7295…` 与 `.upstream.json` 一致；`lint` + static 4/4 + core 5/5。
- **两处偏差**：工作区实际**不干净**（多出未跟踪的 `README.suggested.md`，17,018 字节）；遗留项行号是 263 不是 258。

### 2. 修复 `resolveProject` 空引用

- **起因**：简报遗留项 1。
- **处理**：把 `scanWorkshopDir` 内联的单条目分类逻辑提取为 `resolveProject(entryDir, {id, fallbackTitle})`，工坊与手动目录共用；`src/we-library.mjs` 146 行定义、204 行工坊调用、281 行手动调用，`+62/−44`。
- **验证**：A/B 对照——修复前 `MANUAL THREW ReferenceError: resolveProject is not defined`；修复后手动目录返回 2 条（`手动场景` pkgBytes=4104 + `loose.mp4`），工坊输出与基线逐字段一致。

### 3. 启动链路零黑框

- **起因**：用户报「每次开机自动调用 PowerShell，第一次启动仍有黑框」。
- **根因**：`scripts/autoskin-launch.vbs` 的 `shell.Exec("cmd /c where node.exe 2>nul")` —— `Exec` 会创建**可见**控制台（`Run(cmd,0,False)` 的 `0` 才是 SW_HIDE）。
- **处理**：改用 `FileSystemObject` 逐段遍历 `%PATH%`；`.bat` 保留，新增 `一键换肤.vbs` 静默入口。
- **验证**：`cscript` 探针 `FindNode -> [D:\Apps\nodejs\node.exe]` / `node v24.20.0` / `RESULT: OK`；Win32 A/B（`EnumWindows`+`IsWindowVisible`+`GetClassName`）旧版 `[721868:ConsoleWindowClass]`、新版 `[]`。

### 4. 去掉开机路径上的 PowerShell

- **处理**：`listWatchers()` 原本 `execFileSync("powershell.exe",…)` 枚举 node 进程，改为守护写 `guard-<port>.pid`、启动器读它 + `tasklist` 验活；`--setup` 与 `cli apply` 补 `windowsHide`。
- **验证**：`guard-9333.pid = 17904` / `guard-9334.pid = 16688`。

### 5. 开机自启改为自有 Run 值 + 自愈

- **起因**：Run 键里 `WorkBuddy.WorkBuddy*` 被改回裸 exe。
- **处理**：`setup-autoskin.ps1` 增建 `AnonBuddySkin.<exe>`（每产品线一条）；`launch-and-skin.mjs` 增 `ensureAutostart()` 在启动末尾复查自愈。
- **验证**：注册表四项全部指向静默启动器。

### 6. 外观系统 v2 + 四个 bug + 自动调优

- **处理**：`TUNABLE_SPEC` 从 2 项扩到 6 项（壁纸组：壁纸模糊 / 磨砂遮罩；液态玻璃组：玻璃模糊 / 通透 / 顶部高光 / 边缘描边），旧键 `sidebarBlur` 迁移为 `glassBlur`；新增磨砂遮罩层与 iOS 液态玻璃配方；新增「自动调优」。
- **验证**：面板 6 滑块 + 两组标题正确；两版玻璃生效（侧边栏 `bg=color(srgb 0.99 0.93 0.94 / 0.37)`）；自动调优实测 `scrim 45→35`、`tint 37→48`、`sheen 3→44`、`border 100→32`（反推壁纸亮度 ≈0.64）。
- **四个 bug 的根因见「二、关键问题与修复」第 5–9 条。**

### 7. 音乐播放三个 bug

- **处理**：`setWePaused` 不再调 `setWeVolume(0,…)`；音量改派生 `effectiveVolume()`；`setWeSound` 补 `syncWwglVolume()`；恢复播放还原实例音量。
- **验证**：`设音量 60 → storedVolume 60` → `暂停 → 60`（修复前 `0`）→ `继续 → 60`（修复前 `0`）。

### 8. 一键更新

- **处理**：守护开 `127.0.0.1:<CDP端口+1000>` 端点（`/status`、`/update`）；新增 `src/zip-read.mjs`（零依赖 ZIP 读取器）与 `src/self-update.mjs`；面板按钮改「一键更新」。
- **验证**：镜像实测可用四个（直连 / ghproxy.net / gh-proxy.com / ghfast.top）；zip 读取 62 条目、prefix `chihayaanon-skin-1.0.6-intl/`；解包 62 文件 0 跳过；`isNewer("1.0.10","1.0.9")=true`；真实下载 2.97 MB、字节 3,113,958、ZIP 魔数正确；端点 `/status` 返回 `{"ok":true,"version":"1.0.6","cdpPort":9333}`。

### 9. 面板控件按参考项目重做

- **处理**：抽出 `.wb-p-slider` / `.wb-p-value`——4px track、16px thumb（accent 2px 描边、hover/active 放大 1.12/1.2）、48px 数值胶囊、深色 track 换白色系。

### 10. README 重写 + 演示 GIF

- **处理**：主卖点提前为「让你的 WorkBuddy 跑起 Wallpaper Engine 的场景壁纸 —— 真的在跑」；正文首图换实录 GIF；新增「外观」章节；对比表补三条；目录改分组三行。
- **验证**：图片引用 4 处全部存在；**目录锚点 15/15 全对**（用 `outputs/check-readme-anchors.mjs` 按 GitHub slug 规则核对）。
- **GIF**：本机无 ffmpeg / ImageMagick / gifsicle，自写链路（CDP 取帧 → PNG 解码 → 中位切分量化 256 色 → GIF89a + LZW）。`docs/images/preview-scene.gif` 12 帧、760×412、1,411,132 字节。

### 11. 发布 1.0.6（四次推送）

| 次序 | 本地提交 | 远端 main | tag | 附件（cn / intl） |
|:--|:--|:--|:--|:--|
| 1 | `6fec6cb` | `f8ac106` | `v1.0.6` → `f8ac106` | 3,113,716 / 3,113,958 |
| 2 | `0d16dd9` | `4af5550` | 移到 `4af5550` | 3,128,252 / 3,128,502 |
| 3 | `23c5571` | `93773d0` | 仍 `4af5550` | 3,130,473 / 3,130,723 |
| 4 | `8dd9fa1` | `c20c212` | 仍 `4af5550` | 未再替换 |

Release id `402653654`，`draft: false`，说明已 PATCH（body 1379 字符）。

---

## 二、关键问题与修复

| # | 坑 / 结论 | 已写入 PROJECT-MEMORY |
|:--|:---|:---|
| 1 | `WScript.Shell.Exec` 会创建**可见**控制台窗口（`Run` 的 `0` 才是隐藏） | ✅ |
| 2 | 绑 WorkBuddy 自己的 Run 值必然回滚；判据：`autoskin-setup.json` 仍在 ⇒ `-Undo` 没跑过 | ✅ |
| 3 | `HKCU\…\Run` 枚举顺序是 S/M/F/W，**不是**字母序 | ✅ |
| 4 | 暂停不要把音量写死成 0（会落盘）；`setWeSound` 必须调 `syncWwglVolume()` | ✅ |
| 5 | `--wb-glass` 掺主题强调色，当玻璃底会把界面整体染色 | ✅ |
| 6 | CSS 自定义属性必须在**声明它的元素**上解析出 `var()`；`:root` 引用 body 变量 → guaranteed-invalid 且**停止继承** | ✅ |
| 7 | 「从选择器列表里删掉」≠ 内联样式消失；重新注入不清原生元素的内联 `backdrop-filter` | ✅ |
| 8 | 独立窗口各写各的 CSS 变量，需 `storage` 事件架桥 | ✅ |
| 9 | 同作用域 `const` 的 TDZ 会让整个 `buildSettingsPane` 抛错 | ✅ |
| 10 | 窗口不可见时 `Page.captureScreenshot` 会**挂住**；判据要问 `document.hidden`，不能只看窗口句柄 | ✅ |
| 11 | `clip.scale` 会让 Chromium 重新光栅化且**留下未回收的视口覆盖** | ✅ |
| 12 | 本机无编码器，需自写采集+编码链 | ✅ |
| 13 | `--normalize-eol` 是全局开关，会把二进制毁掉（1,411,132 → 2,465,231 字节） | ✅（本轮补写） |
| 14 | `/git/commits/{sha}` 要完整 40 位 sha，短 sha 一律 404 | ✅（本轮补写） |
| 15 | 发布脚本 `MESSAGE` 默认值在不给 `--tag` 时落成 `release`，commit 标题会很难看 | ❌ |

---

## 三、遗留事项（本轮收尾结果）

| # | 遗留 | 状态 | 结果 |
|:--|:---|:---|:---|
| 1 | 本地 / 远端历史结构不同 | ⚠️ 未完成 | `git fetch` 先后被 RST 两次、最后一次完全连不上（`Failed to connect to github.com:443 after 21081 ms`）。**内容**可通过 API 对齐，**历史结构**只能等网络。恢复后：`git fetch origin --tags --force`，先比 `git rev-parse HEAD^{tree}` 与远端 tree，一致再 `git reset --hard origin/main`。 |
| 2 | tag `v1.0.6` 落后于 main | ✅ 已处理 | 用 API `PATCH /git/refs/tags/v1.0.6`（`force:true`）移到当前 main 头。 |
| 3 | 一键更新未端到端验证 | ✅ 已完成 | 造临时目录模拟 1.0.5 安装，真实走完「查最新 → 下载 → 校验 → 解包 → 覆盖」：`{"ok":true,"stage":"done","from":"1.0.5","to":"1.0.6","applied":true,"written":62,"skipped":0}`，7 项检查全 PASS（含引擎 950,112 字节一致）。 |
| 4 | UI 重构未做页签制 | ❌ 未做 | 理由见下。 |
| 5 | GIF 工具在 gitignored 目录 | ✅ 已完成 | 移入 `scripts/make-preview-gif.mjs`，注释同步更新；static 4/4 仍通过。 |
| 6 | 两条坑未写入 PROJECT-MEMORY | ✅ 已完成 | 已补：`--normalize-eol` 毁二进制、`/git/commits/{sha}` 要完整 40 位 sha。 |
| 7 | GIF 采自国内版窗口 | ⏭️ 未做 | 非阻塞。国际版窗口当时被收进托盘（所有 `WorkBuddyAI` 进程 `MainWindowHandle = 0`）。要重采：恢复窗口后 `node scripts\make-preview-gif.mjs 9333 docs/images/preview-scene.gif 760 12`。 |

### 第 3 项的一个额外收获

端到端验证那一次，下载链**真实地回退了一轮**：

```
下载尝试：直连        ✗ fetch failed
下载尝试：ghproxy.net ✗ The operation was aborted due to timeout
下载尝试：gh-proxy.com ✓ 2.99 MB
```

也就是说镜像回退不只是纸面设计，在当时的网络条件下确实救回了这次更新。

### 第 4 项为什么没做

页签制（壁纸库 / 外观 / 播放 / 系统 / 扩展 / 关于）是一次**结构重写**：`buildSettingsPane` 现在是
单函数顺序构建六个分组，改页签要引入容器与切换状态、并重排全部分组的挂载时机。

这一轮已经把**控件层**统一了（`.wb-p-slider` / `.wb-p-value`），剩下的属于结构改造，而现有面板
功能正常、两个版本都验证过 —— 在没有足够验证轮次的情况下重写，风险大于收益。

**建议单独一轮做**，验收标准：
- 六个分组各自可独立渲染、切换时不重建 DOM
- `pane.__syncTunables` / `pane.__syncSwitch` / `pane.__renderList` 三个既有钩子仍可用
- `scripts/test-settings-panel.mjs` 等既有测试不回归

---

## 四、当前状态

| 项 | 值 |
|:---|:---|
| 远端 main | `59b2d76781443464664c2469c533886f031f69a9`（含网页提交 `59b2d76`，见下） |
| tag `v1.0.6` | 见文末收尾记录 |
| Release | `v1.0.6`，id `402653654`，`draft: false` |
| 附件 | `chihayaanon-skin-1.0.6-cn.zip` = 3,130,473 字节；`-intl.zip` = 3,130,723 字节 |
| 附件校验 | 与本地构建 SHA256 一致（cn `F42037458D7F2604…`、intl `6DD11BFA524AAE63…`） |
| 演示图 | `docs/images/preview-scene.gif`，1,411,132 字节，12 帧 / 760×412 / 256 色 |
| README 锚点 | 15/15 全部命中 |

### 本轮新发现的远端改动（重要）

`59b2d76` "Update README.md"（GitHub 网页编辑，`2026-10-03T20:17:36Z`，只改 1 行）删掉了主标题里的
「—— 真的在跑。」：句子下面的排比（粒子在飘、模型在动…）已经把这层意思说完了。**已同步进本地，
不覆盖。**

这条正好印证了 PROJECT-MEMORY 里已有的那条教训：**每次推送前先确认远端头，别假设它还是你上次推的
那个**。当时本地以为远端是 `c20c212`，而实际已经是 `59b2d767`。
