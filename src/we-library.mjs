// Wallpaper Engine 本地壁纸库的发现与盘点（**只读**，零运行时依赖）。
//
// 背景与可行性结论见 docs/WE-INTEGRATION.md。这里只做"把本机有什么列出来"：
// 定位 Steam 库 → steamapps/workshop/content/431960/<条目ID>/ → 读 project.json → 分类。
//
// 分类规则（来自实测，详见 docs/WE-INTEGRATION.md）：
//   · type=video  → mp4/webm 在**工程根目录**，由 project.json 的 file 字段指向 → 可直接当动效背景
//   · type=scene  → 素材打包在 scene.pkg。两条升级路线：RePKG 解出 4K 静态贴图（we-extract.mjs），
//                   或者渲染层用 WebWallGL 直读 pkg 做实时渲染。所以这里要给出 pkgPath/pkgBytes。
//   · type=web    → files/index.html，不能当背景
//   · 无 type 且有 preset + dependency → 预设（配置覆盖层），不是独立壁纸，跳过
//
// ⚠️ 本模块**只产出路径与元数据，不复制、不读取媒体字节**：
//   渲染进程本身就是 file:// 页面，可以直接 <video src="file:///..."> 播本机文件（已实测），
//   所以不需要搬运字节，也就不会碰 localStorage 配额。

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

const APP_ID = "431960";
const VIDEO_EXT = new Set([".mp4", ".webm"]);
const PREVIEW_NAMES = ["preview.jpg", "preview.jpeg", "preview.png", "preview.gif", "preview.webp"];

// Steam 的常见安装位置。⚠️ 只作为"候选"，命中即用，找不到就返回空 —— 绝不写死单一绝对路径。
const STEAM_ROOT_HINTS = [
  "C:/Program Files (x86)/Steam",
  "C:/Program Files/Steam",
  "C:/Steam",
  "D:/Steam",
  "D:/steam",
  "E:/Steam",
  "E:/steam",
];

// ⚠️ Windows 路径大小写不敏感：D://Steam 与 D://steam 是同一个目录。
// 候选列表里同时写了两种写法 → 不去重的话每个条目会被扫两遍（实测 38 条变 76 条）。
const pathKey = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * 内容分级：取自 project.json 的 contentrating（Wallpaper Engine 工坊标准字段），
 * 缺失时按标题关键词兜底，与 dsh 皮肤中心的 deriveRating 语义保持一致。
 * Everyone 映射 g，Questionable 映射 pg13，Mature 映射 r18。
 */
export const deriveRating = (contentRating, title) => {
  if (typeof contentRating === "string") {
    const normalized = contentRating.trim().toLowerCase();
    if (normalized === "everyone") return "g";
    if (normalized === "questionable") return "pg13";
    if (normalized === "mature") return "r18";
  }
  if (typeof title === "string" && title !== "") {
    if (/(^|[^\w])(r-?18|nsfw|18\+)([^\w]|$)/i.test(title)) return "r18";
    if (/(^|[^\w])(pg-?13|r-?16)([^\w]|$)/i.test(title)) return "pg13";
  }
  return "g";
};

const readJsonLoose = async (file) => {
  // project.json 的编码不固定：实测见过 utf-8-sig / utf-8 / gbk
  for (const encoding of ["utf-8", "utf8", "latin1"]) {
    try {
      return JSON.parse(await readFile(file, encoding));
    } catch {}
  }
  return null;
};

/** 从 libraryfolders.vdf 里抠出所有 Steam 库根目录（多库很常见） */
const parseLibraryFolders = async (steamRoot) => {
  const vdf = join(steamRoot, "steamapps", "libraryfolders.vdf");
  const out = [steamRoot];
  if (!existsSync(vdf)) return out;
  try {
    const text = await readFile(vdf, "utf8");
    for (const m of text.matchAll(/"path"\s*"([^"]+)"/g)) {
      const p = m[1].replace(/\\\\/g, "/").replace(/\\/g, "/");
      if (p && !out.some((x) => pathKey(x) === pathKey(p))) out.push(p);
    }
  } catch {}
  return out;
};

/** 找出本机所有含 431960 工坊目录的路径 */
export const findWorkshopDirs = async () => {
  const roots = [];
  const override = process.env.WORKBUDDY_WE_LIBRARY;
  if (override) roots.push(...(await parseLibraryFolders(override)), override);
  for (const hint of STEAM_ROOT_HINTS) {
    if (existsSync(hint)) roots.push(...(await parseLibraryFolders(hint)));
  }
  const dirs = [];
  for (const root of roots) {
    const dir = join(root, "steamapps", "workshop", "content", APP_ID);
    if (existsSync(dir) && !dirs.some((x) => pathKey(x) === pathKey(dir))) dirs.push(dir);
  }
  return dirs;
};

/** 在条目目录里找体积最大的那个视频文件（project.json.file 优先） */
const findVideo = async (entryDir, declared) => {
  const candidates = [];
  if (typeof declared === "string" && declared) {
    const p = join(entryDir, declared);
    if (existsSync(p)) {
      const ext = declared.slice(declared.lastIndexOf(".")).toLowerCase();
      if (VIDEO_EXT.has(ext)) return { path: p, size: (await stat(p)).size };
    }
  }
  const stack = [entryDir];
  while (stack.length) {
    const cur = stack.pop();
    let items = [];
    try { items = await readdir(cur, { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      const full = join(cur, item.name);
      if (item.isDirectory()) { stack.push(full); continue; }
      const ext = item.name.slice(item.name.lastIndexOf(".")).toLowerCase();
      if (!VIDEO_EXT.has(ext)) continue;
      candidates.push({ path: full, size: (await stat(full)).size });
    }
  }
  candidates.sort((a, b) => b.size - a.size);
  return candidates[0] ?? null;
};

const findPreview = async (entryDir) => {
  for (const name of PREVIEW_NAMES) {
    const p = join(entryDir, name);
    if (existsSync(p)) return p;
  }
  return null;
};

/**
 * 盘点一个工坊目录。
 * @returns {Promise<Array<{id:string,title:string,kind:"video"|"preview",path:string,size:number,rawType:string}>>}
 */
export const scanWorkshopDir = async (dir) => {
  const out = [];
  let ids = [];
  try { ids = await readdir(dir); } catch { return out; }

  for (const id of ids) {
    if (!/^\d{6,12}$/.test(id)) continue;
    const entryDir = join(dir, id);
    const manifestPath = join(entryDir, "project.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = await readJsonLoose(manifestPath);
    if (!manifest) continue;

    const rawType = String(manifest.type ?? "").toLowerCase();
    // 无 type + 有 preset → 预设（配置覆盖层），不是独立壁纸
    if (!rawType) continue;

    const title = String(manifest.title ?? manifest.project?.title ?? id);
    const rating = deriveRating(manifest.contentrating, title);

    // 预览图（创意工坊缩略图）always 顺手取一下：视频条目也用它来取色 / 当 poster 兜底
    const preview = await findPreview(entryDir);
    const previewSize = preview ? (await stat(preview)).size : 0;

    if (rawType === "video") {
      const video = await findVideo(entryDir, manifest.file);
      if (video) {
        out.push({
          id, title, kind: "video", path: video.path, size: video.size, rawType, rating,
          previewPath: preview, previewSize,
        });
        continue;
      }
    }

    // scene / web / 拿不到视频的 video：退化成静态预览图
    // scene 额外带上 scene.pkg 路径 —— 用户提供了 RePKG 时可以解出原始 4K 贴图（见 we-extract.mjs）
    if (preview || rawType === "scene") {
      const pkgPath = join(entryDir, "scene.pkg");
      const hasPkg = rawType === "scene" && existsSync(pkgPath);
      // pkg 体积是渲染层的预判依据：几十 MB 的包解/读都要付代价，值得先知道
      const pkgBytes = hasPkg ? await stat(pkgPath).then((s) => s.size, () => 0) : 0;
      out.push({
        id, title, kind: "preview", path: preview ?? pkgPath, size: previewSize, rawType, rating,
        previewPath: preview, previewSize,
        pkgPath: hasPkg ? pkgPath : null,
        pkgBytes,
      });
    }
  }

  out.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "video" ? -1 : 1));
  return out;
};

/** 盘点本机所有工坊目录 */
export const scanAll = async () => {
  const dirs = await findWorkshopDirs();
  const items = [];
  for (const dir of dirs) items.push(...(await scanWorkshopDir(dir)));
  return { dirs, items };
};

/** 供渲染层使用的 file:// URL（路径含中文/空格必须逐段百分号编码） */
export const toFileUrl = (absolutePath) => {
  const normalized = absolutePath.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg)))
    .join("/");
  return `file:///${encoded.replace(/^\/+/, "")}`;
};

// ---------------------------------------------------------------- 手动目录
// 面板里的手动目录行：没有 Wallpaper Engine（或想用零散素材）时，
// 把任意文件夹加进来就是壁纸库。与工坊扫描共用 resolveProject 的分类规则。
// 支持：散装 .mp4/.webm 视频与图片、单个 WE 项目、项目合集、WE 安装根 / Steam 库根。

const MANUAL_VIDEO_EXT = new Set([".mp4", ".webm"]);
const MANUAL_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** 展开开头的 ~（手动目录是人手输的路径） */
export const expandTilde = (input) => {
  if (typeof input !== "string" || !input) return "";
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return join(home, input.slice(2));
  return input;
};

const manualId = (full) => "manual-" + full.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(-72);

/**
 * 扫描一个手动目录。目录不存在返回空 items（面板据此显示空态）。
 * depth 限两层：用户给的是壁纸目录，不是整块盘，避免误扫全盘。
 */
export const scanManualDir = async (input) => {
  const root = expandTilde(input);
  const items = [];
  if (!root || !existsSync(root)) return { root, items };

  const emitMedia = async (full) => {
    const name = basename(full);
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return;
    const ext = name.slice(dot).toLowerCase();
    const isVideo = MANUAL_VIDEO_EXT.has(ext);
    if (!isVideo && !MANUAL_IMAGE_EXT.has(ext)) return;
    const size = await stat(full).then((s) => s.size, () => 0);
    if (size <= 0) return;
    const title = name.slice(0, dot);
    items.push({
      id: manualId(full), title, kind: isVideo ? "video" : "preview",
      path: full, size, rawType: isVideo ? "video" : "image",
      previewPath: isVideo ? null : full, previewSize: isVideo ? 0 : size,
      pkgPath: null, rating: deriveRating(null, title), manual: true,
    });
  };

  const walk = async (dir, depth) => {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    // 同层有 project.json：这是一个 WE 项目目录，交给工坊那套分类规则
    if (entries.some((e) => e.isFile() && e.name === "project.json")) {
      items.push(...(await resolveProject(dir, basename(dir))));
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) await walk(full, depth - 1);
        continue;
      }
      await emitMedia(full);
    }
  };

  await walk(root, 2);
  return { root, items };
};

/** 扫描多个手动目录并按路径去重（同一文件被两个目录覆盖时只留一份） */
export const scanManualDirs = async (dirs) => {
  const seen = new Set();
  const items = [];
  const roots = [];
  for (const dir of Array.isArray(dirs) ? dirs : []) {
    const { root, items: found } = await scanManualDir(dir);
    roots.push(root);
    for (const item of found) {
      const key = pathKey(item.path);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return { roots, items };
};
