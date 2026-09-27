# 可行性分析：把 Wallpaper Engine 已订阅壁纸用作主题

> 状态：**方案 B（内置 RePKG）已实现并测试通过**（2026-09-20）
>
> ⚠️ **对本文件早先结论的更正**：初版评估说"内置的代价是引入 .NET 运行时依赖"——**这是错的**。
> 实测下载 RePKG v0.4.0-alpha 后确认：它是 **NativeAOT 原生编译**（单文件 3.7MB，二进制里没有
> `hostfxr`/`coreclr`/`clrjit` 任何标记；把 `DOTNET_ROOT` 指向不存在目录仍能正常运行），
> **不需要系统安装 .NET**。于是"内置"的最后一个成本也消失了，改为随仓库分发。
>
> **实测数据（2026-09-20，本机）**：
> | 项 | 结果 |
> |---|---|
> | 许可 | MIT（`tools/repkg/THIRD-PARTY-NOTICES.txt` 一并分发） |
> | 体积 | `RePKG.exe` 3.7MB，单文件，无附属 dll |
> | 格式支持 | **TEXB0004 实测可解**（本机 34 个 scene.pkg 里 TEXB0004 出现 84 次） |
> | 速度 | 9.7MB 的包 1.0s；**122.8MB 的包 0.82s** |
> | 产出 | 主贴图 **3840×2160**（创意工坊缩略图只有 1024×1024，像素量差 16 倍） |
> | 缓存 | 每个条目只留一张 `hero.png`，平均约 4.6MB（27 个条目实测 125MB） |
> 调研方式：本机实测（读盘 + CDP 注入探针）　回归：`scripts/test-we.mjs`（34 项断言）
>
> **已实现**（方案 A + C 兜底）：
> - `src/we-library.mjs`：只读盘点（自动定位 Steam 库、解析 `project.json`、分类、产出 `file://` URL）
> - `src/we-extract.mjs`：**用内置 RePKG 解出原始贴图**（按需 + 缓存 + 零依赖读图片头挑主图）
> - `tools/repkg/RePKG.exe`：随仓库分发（MIT，NativeAOT，无需 .NET）
> - `src/cli.mjs`：`we`（盘点）/ `we-extract`（解包）命令；`applySkin` 内部自动带上目录（**所有注入路径的汇合点**）
> - **后台预热**：`apply` 时把未解过的 scene 壁纸丢给一个**脱离的子进程**去解，不阻塞换肤（实测该子进程能在父进程退出后继续跑）
> - 设置面板新增「Wallpaper Engine 壁纸」分组：缩略图网格 + **「仅本机可用、不可分享」标注**
> - 视频壁纸：背景图层里挂 `<video loop muted autoplay playsinline>`，**默认自动播放**
> - **两处暂停键**：悬浮小图标旁 + 面板里，状态互相同步并落盘
> - 切到普通主题 / 选「原生」时**释放视频**（`pause` + 清 `src` + `load()`），反复 apply 不叠层
>
> **实测踩到的两个坑**（都写进了代码注释与 `HANDOFF.md` 的坑表）：
> 1. Windows 路径大小写不敏感 —— `D://Steam` 与 `D://steam` 是同一目录，候选列表不去重会让条目**翻倍**（38 → 76）
> 2. **背景层有 `<video>` 时 `Page.captureScreenshot` 会卡住**（实测超时）→ 用截图做断言的测试
>    （`test-tunables`）必须在跑完 WE 测试后处于"无视频"状态，`test-we` 收尾已强制切回普通主题

---

## 一、结论先行

**技术上可行，且比预想的简单得多** —— 关键是本机实测发现
**WorkBuddy 渲染进程本身就是 `file://` 页面，可以直接加载本机媒体文件**：

| 实测项 | 结果 |
|---|---|
| 页面协议 | `file:///D:/Apps/WorkBuddyAI/resources/app.asar/renderer/index.html`（重装前为 `E:/workbuudy/...`） |
| `fetch("file:///D:/...")` | 成功 |
| `<img src="file:///D:/...preview.jpg">` | 成功（1024×1024） |
| `<img src="file:///D:/...preview.gif">` | 成功（256×256，动图会播） |
| `<video src="file:///D:/...mp4">` | **成功**（2000×1124，20s 元数据正常） |

这意味着**零字节拷贝、零存储占用、零 payload 膨胀** —— 不需要 data URL、不需要 blob 搬运、
不需要常驻 HTTP 服务，也不必碰 localStorage 配额（当前仅剩约 7.4M 字符）。

**但覆盖率是真正的瓶颈**，不是技术：

| 本机库情况（51 个条目） | 数量 | 能否直接用 |
|---|---|---|
| `scene` 场景壁纸（素材锁在 `scene.pkg`，共 2486 MB） | 34 | **否** —— 只能退化成静态预览图 |
| `video` 视频壁纸（mp4 在工程根目录） | 4 | **可以，且带动效** |
| `preset` 预设（配置覆盖层，不是独立壁纸） | 13 | 否，跳过 |
| 带 `preview.jpg` / `preview.gif` 的条目 | 26 | 可作**静态**背景 |

也就是说：**本机 51 条里只有 4 条（7.8%）能拿到动效**，约 26 条能当静态图用。

---

## 二、实现思路

```
Node 端（新增 src/we-library.mjs）
  定位 Steam 库 → steamapps/workshop/content/431960/<条目ID>/
  逐个读 project.json（编码回退 utf-8-sig → utf-8 → gbk）
  按 type 分类，产出**只含路径与标题**的目录（几 KB）
        │  塞进 buildSkinMenuScript 的 payload
        ▼
渲染层
  · 设置面板新增「Wallpaper Engine」分组（缩略图用 preview，绝不放 <video>）
  · 选中视频条目 → 媒体层放 <video src="file:///..." loop muted autoplay playsinline>
  · 选中静态条目 → 媒体层用 <img> 或直接当 background
  · 复用刚做好的 --wb-bg-blur-px 调节项 → 视频背景也能被模糊
        │
        ▼
持久化：只存 { weEntryId, title, path }（**不存字节**）
```

媒体层**已经存在**了 —— 需求 2 为了做"背景图模糊"，已经把 hero 从 `body` 的 background
挪进了 `body::before` 图层。视频只需要在同一个层级再放一个 `<video>` 即可，属于顺水推舟。

---

## 三、需要改动的模块

| 模块 | 改动 | 规模 |
|---|---|---|
| **`src/we-library.mjs`**（新增） | Steam 库定位 + `project.json` 解析 + 分类产出目录。只读、零依赖（Node 内置 `fs`/`path`），沿用 `asar-path.mjs` 那套"动态发现、禁止硬编码路径"的写法 | 中 |
| `src/cli.mjs` | 新增 `we list` 子命令（先能命令行盘点，再谈 UI） | 小 |
| `src/injector.mjs` | 把 WE 目录塞进 payload | 小 |
| `src/skin-menu.mjs` | 媒体层支持 `<video>`；面板新增 WE 分组；播放/暂停开关；取色；**释放逻辑必须进 `dispose()`** | 大 |
| `src/css/skin.css` | 媒体层的 `<video>` 规则（`object-fit: cover`、随 `--wb-bg-blur-px` 模糊） | 小 |
| `scripts/test-we-library.mjs`（新增） | 库定位与解析的回归（用固定 fixture，不依赖本机库） | 中 |
| 文档 | README 增补"仅本机、不可分享"的说明 | 小 |

---

## 四、技术难点与限制

### 4.1 获取方式（已实测，但有前提）

`file://` 直读**成立的前提是渲染进程本身跑在 `file://` 下**。这是 WorkBuddy 当前的行为，
不是我们能控制的契约 —— 若将来改成自定义协议（`app://`）或 http，这条路会整体失效。
因此需要保留降级路径（见第五节方案 C/D）。

另外两点实测细节：
- 路径含中文/空格**必须正确百分号编码**（实测 `20s慢_1.mp4` → `20s%E6%85%A2_1.mp4` 可用）。
- 页面在 `E:` 盘、素材在 `D:` 盘，**跨盘可读**（Chromium 的 `file://` 限制不拦媒体元素）。

### 4.2 格式兼容

| WE 类型 | 实际文件 | 兼容性 |
|---|---|---|
| `video` | `project.json` 的 `file` 字段，mp4 在**工程根目录**（不在 `files/`） | H.264/VP9 可播；**H.265/HEVC、`.mov`/`.avi`/`.mkv` 不保证**。本机 4 条全是 mp4 |
| `scene` | `scene.pkg`（打包资源） | **无法直接用**。需要 RePKG 解包，而 RePKG 0.2.2 不支持 WE 2.x 的 `TEXB0004`；本机**未安装 RePKG**，`ffmpeg`/`ffprobe` 也不在 PATH |
| `web` | `files/index.html` | 本机没有；网页壁纸不能当背景（需要 iframe 且会抢焦点） |
| `preset` | 无 `type`，有 `preset` + `dependency` | 不是独立壁纸，跳过 |

> **⚠️ 覆盖率现实**：想做 scene 壁纸的动效，只能靠 RePKG 或调用
> `wallpaper64.exe -control openWallpaper` 渲染截图 —— 后者会**接管整个桌面**，
> 作为"插件的一个功能"体验不可接受。所以 **scene 一律按静态处理**。

### 4.3 性能（这是最需要提前说清的一条）

1. **视频背景是持续 GPU 解码 + 逐帧合成**。叠加侧边栏的 `backdrop-filter` 后，
   每帧都要重新做一次背景模糊 → 功耗与发热明显高于静态皮肤。
   本机素材里有 2000×1124 和 4K 的，**4K/高帧率会明显吃 GPU**。
2. **面板列表绝不能每项一个 `<video>`** —— 几十个解码器同时跑会直接拖垮渲染进程。
   缩略图一律用 `preview.jpg`（静态）。这条和之前"不给每个主题塞 video"的判断一致。
3. **切主题/暂停必须真正释放解码器**：`pause()` + `removeAttribute("src")` + `load()`。
   只把节点 `display:none` 或从 DOM 摘掉，解码器可能仍在跑。
   ⚠️ 这条同时踩中本项目的**幂等红线**：视频节点与其释放逻辑必须进 `dispose()`，
   否则重复 `apply` 会留下多个仍在播的视频。
4. 建议默认给视频主题**自动调低侧边栏模糊**（正好可以复用刚做的 `sidebarBlur` 调节项）。

### 4.4 授权

- 创意工坊内容**版权归作者**。本地个人使用（WE 本身就是这么用的）没有问题，
  但必须守住两条：
  1. **绝不能把媒体打进仓库** —— 本仓库要公开。好在我们**只存路径**，不存字节，
     所以天然不会入库；`.gitignore` 无需改动。
  2. **WE 来源的主题不可导出分享** —— 它引用的是本机绝对路径，换台机器就是死链。
     必须在面板上明确标注"仅本机"，并在未来的"主题包导出"功能里**排除 WE 来源**。
- 读取 Steam 目录是本地只读操作，不涉及绕过 DRM 或破解。

---

## 五、可选方案对比

| 方案 | 做法 | 优点 | 缺点 | 取舍 |
|---|---|---|---|---|
| **A. `file://` 直读** | 渲染层直接 `<video src="file:///…">` | 零拷贝/零存储/支持 500MB 级大文件；**已实测通过**；天然复用现有媒体层 | 仅本机；**依赖页面是 `file://` 协议**（非我们可控）；路径失效即断 | ✅ **推荐为主** |
| B. Node 读字节 → data URL | 把 mp4 塞进 payload | 不依赖协议 | 素材 35–495 MB，payload/内存/localStorage **全部爆** | ❌ 不可行 |
| **C. 抽帧成静态图** | 取一帧存成图片，走现有图片链路 | 体积小、零新风险、复用已有上传管线 | 丢动效；本机**无 ffmpeg**（需在渲染层用 `<video>`+canvas 抽帧） | ✅ **推荐为兜底**（尤其给 34 个 scene） |
| D. 常驻本地 HTTP 服务 | Node 起 `127.0.0.1` 服务 + Range 流式传输 | 可流式、不占内存、不依赖 `file://` 协议 | 需要新增**常驻进程**（当前插件是一次性脚本，没有 daemon），架构改动最大 | ⏸ 暂不采用；若 A 因协议变更失效再上 |
| E. 手动导入单个文件 | 用户自己把 mp4 拖进插件 | 实现最简单 | 覆盖窄，还要复制大文件占盘（几十 GB 级不现实） | ❌ 不采用 |

---

## 六、分步实施方案（确认后按此推进）

**阶段 1 · 只读盘点（先证明能发现什么，不碰 UI）**
- 新增 `src/we-library.mjs`：定位 Steam 库（支持多库 `libraryfolders.vdf`）→ 扫 `431960` →
  解析 `project.json` → 产出 `{ id, title, kind, path, sizeBytes }` 目录
- `cli.mjs` 加 `we list`，命令行能列出分类结果
- 配套 `test-we-library.mjs`（用 fixture，不依赖本机库）

**阶段 2 · 静态可用（零新风险）**
- 面板新增「Wallpaper Engine」分组，列出条目（`preview.jpg` 缩略图 + 类型标签 + 体积）
- 选中静态条目 → 作为背景图应用（复用现有链路）
- 面板标注「仅本机、不可分享」

**阶段 3 · 视频动效（主要风险集中在这一步）**
- 媒体层支持 `<video>`：`loop muted autoplay playsinline` + `object-fit: cover`
- 播放/暂停开关；默认性能档（自动降侧边栏模糊）
- **释放逻辑进 `dispose()`**，并补幂等回归（反复 `apply` 不得留下多个在播的视频）
- 取色：seek 到某帧 → canvas → `extractPalette`（避开 `currentTime=0` 的黑帧）

**阶段 4 · 打磨**
- 面板显示"本机路径已失效"的状态（条目被取消订阅/移动后要能优雅降级）
- README / ARCHITECTURE 补文档；发版前跑 `test:all`

---

## 七、待确认的三个点

1. **是否接受"scene 壁纸只能静态"这个现实？** 本机 34/51 是 scene，拿到动效只有 4 条。
   要突破就得引入 RePKG（且新版才支持 WE 2.x）或调用 WE 渲染截图（会接管桌面）。
2. **视频默认自动播放还是默认暂停？** 我倾向**默认播放**（符合"动态壁纸"的预期）
   但提供暂停开关；若更看重省电，可反过来。
3. **面板是否加「仅本机」标注？** 我建议加 —— 避免用户以为能分享。

---

## 附：本次调研用到的脚本

| 脚本 | 用途 |
|---|---|
| `scripts/archive/probe-we-library.py` | 盘点 WE 库：类型分布、体积、preview 覆盖率 |
| `scripts/archive/_probe-we-video.py` | 查看 video 类型条目的真实文件结构 |
| `scripts/archive/probe-file-scheme.mjs` | **决定性探针**：渲染进程能否读 `file://` 图片/GIF/视频 |
