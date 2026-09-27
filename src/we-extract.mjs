// 用**外部的** RePKG 把 scene.pkg 里的贴图解出来（按需 + 缓存）。
//
// 为什么是"外部、按需"：见 docs/WE-INTEGRATION.md。要点：
//   · scene 壁纸的**动效**来自着色器 + WE 引擎逐帧求值，RePKG 不执行着色器
//     → 它拿不到动效，只能把静态兜底从「1024×1024 创意工坊缩略图」升级到「原始 4K 贴图」
//   · 所以这属于"从能用变好看"，不该为此把插件变成"必须带一个二进制"
//   · 用户自己放一份 RePKG 就启用；没放就一切照旧走 preview 兜底
//
// 实测（2026-09-20，本机）：
//   · RePKG v0.4.0-alpha，单文件 3.7MB，**NativeAOT 原生编译 → 不需要系统装 .NET**
//   · 支持 TEXB0004（WE 2.x）：本机 34 个 scene.pkg 里 TEXB0004 出现 84 次
//   · 9.7MB 的包解出 4 张图（主图 3840×2160 / 4.6MB）耗时 1.0s；122.8MB 的包 0.82s
//   · 许可 MIT → 可以分发（需保留 THIRD-PARTY-NOTICES）

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** RePKG 的查找顺序：环境变量 → 仓库内 tools/repkg → 常见位置。返回 null 表示没装（功能自动关闭）。 */
export const resolveRepkg = ({ sourceRoot } = {}) => {
  const candidates = [
    process.env.WORKBUDDY_REPKG,
    sourceRoot && join(sourceRoot, "tools", "repkg", "RePKG.exe"),
    sourceRoot && join(sourceRoot, "tools", "repkg", "RePKG"),
    sourceRoot && join(sourceRoot, "tools", "RePKG.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

/** 缓存根目录：可用 WORKBUDDY_WE_CACHE 覆盖；默认放用户级缓存，不污染仓库。 */
export const resolveCacheRoot = () => {
  if (process.env.WORKBUDDY_WE_CACHE) return process.env.WORKBUDDY_WE_CACHE;
  const base = process.env.LOCALAPPDATA || join(homedir(), ".cache");
  return join(base, "anonbuddy-skin", "we-cache");
};

/**
 * 只读文件头拿图片尺寸（零依赖）。认 PNG / JPEG 两种。
 * 不解码像素 —— 我们只需要"哪张图面积最大"这一个判断依据。
 */
export const readImageSize = async (file) => {
  let buf;
  try { buf = await readFile(file); } catch { return null; }
  // PNG: 8 字节签名 + 4 字节长度 + "IHDR" + 宽高（大端）
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: "GIF87a"/"GIF89a" + 小端宽高。创意工坊的 preview.gif 很常见，必须认。
  if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP: RIFF....WEBP，再按 VP8 / VP8L / VP8X 三种子格式取宽高
  if (buf.length > 30 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    const fourcc = buf.toString("latin1", 12, 16);
    if (fourcc === "VP8X") {
      return { width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
    }
    if (fourcc === "VP8 ") {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: 扫 SOFn 段
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
};

/**
 * 从解包产物里挑"最像主图"的那张。
 * 判据：面积最大 + 宽屏优先；并用「字节数 / 像素数」剔除近似纯色的贴图
 * （纯色 PNG 压得极小，比色丰富的图小一两个数量级 —— 不用解码像素就能判）。
 */
export const pickBestTexture = async (files) => {
  const scored = [];
  for (const file of files) {
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    const size = await readImageSize(file);
    if (!size || !size.width || !size.height) continue;
    const bytes = (await stat(file)).size;
    const pixels = size.width * size.height;
    const richness = bytes / pixels;           // 字节/像素：越低越可能是纯色/近纯色
    scored.push({
      file,
      ...size,
      bytes,
      area: pixels,
      richness,
      landscape: size.width >= size.height,
      // 主图偏好：面积大、宽屏、且不是纯色
      score: pixels * (size.width >= size.height ? 1 : 0.25) * (richness > 0.02 ? 1 : 0.05),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
};

/** 跑一次 RePKG 解包。用 execFile（不经 shell），参数是数组，避免注入与转义问题。 */
const runRepkg = (repkgPath, pkgPath, outDir) =>
  new Promise((resolve, reject) => {
    execFile(
      repkgPath,
      // ⚠️ 只能按 **tex** 过滤：pkg 里贴图的原扩展名就是 .tex，
      //    RePKG 提取时会顺手把它转成 .png。写成 -e png 会一张都匹配不到（踩过）。
      ["extract", "-e", "tex", "-s", "-o", outDir, "--overwrite", pkgPath],
      { timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`RePKG 解包失败：${stderr || error.message}`));
        else resolve(String(stdout ?? ""));
      },
    );
  });

/**
 * 解出一个 scene.pkg 的主贴图，带缓存。
 * 缓存键 = 条目 id；命中条件 = 记录里的 pkg 大小与修改时间都没变。
 * @returns {Promise<{heroPath: string, from: "cache"|"fresh", size: object}|null>}
 */
export const extractSceneTexture = async ({ itemId, pkgPath, cacheRoot, repkgPath, deps = {} }) => {
  if (!repkgPath || !existsSync(pkgPath)) return null;
  const dir = join(cacheRoot, String(itemId));
  const metaPath = join(dir, "meta.json");
  const heroPath = join(dir, "hero.png");

  const info = await stat(pkgPath);
  const stamp = { size: info.size, mtimeMs: Math.round(info.mtimeMs) };

  if (existsSync(heroPath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8"));
      if (meta.pkgSize === stamp.size && meta.pkgMtimeMs === stamp.mtimeMs) {
        const size = await readImageSize(heroPath);
        return { heroPath, from: "cache", size };
      }
    } catch {}
  }

  await mkdir(dir, { recursive: true });
  const outDir = join(dir, "raw");
  const run = deps.runRepkg ?? runRepkg;
  const { copyFile, rm } = await import("node:fs/promises");
  // ⚠️ raw/ 必须用 try/finally 收掉：解包产物（tex 原件 + 其余贴图）可能上 GB，
  //    进程被杀时若没走到清理就会留下残留（实测踩过：11 个残留吃掉 2GB）。
  try {
    await run(repkgPath, pkgPath, outDir);

    let names = [];
    try { names = await readdir(outDir); } catch { return null; }
    const best = await (deps.pickBestTexture ?? pickBestTexture)(names.map((n) => join(outDir, n)));
    if (!best) return null;

    // 只留一张主图（hero.png）；raw/ 里其余贴图用完即弃
    await copyFile(best.file, heroPath);
    await writeFile(metaPath, JSON.stringify({
      itemId, pkgPath, pkgSize: stamp.size, pkgMtimeMs: stamp.mtimeMs,
      source: best.file.split(/[\\/]/).pop(), width: best.width, height: best.height, bytes: best.bytes,
    }, null, 2), "utf8");
    return { heroPath, from: "fresh", size: { width: best.width, height: best.height } };
  } finally {
    try { await rm(outDir, { recursive: true, force: true }); } catch {}
  }
};

/**
 * 扫掉缓存里残留的 raw/ 目录（历史版本或进程被杀留下的）。
 * 解包产物可能上 GB，不清会白占磁盘。返回清掉的数量。
 */
export const sweepStrayRaw = async (cacheRoot) => {
  const { rm } = await import("node:fs/promises");
  let removed = 0;
  let entries = [];
  try { entries = await readdir(cacheRoot, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const raw = join(cacheRoot, entry.name, "raw");
    if (!existsSync(raw)) continue;
    try { await rm(raw, { recursive: true, force: true }); removed += 1; } catch {}
  }
  return removed;
};

/** 读某个条目已缓存的主图（不解包）。返回 null 表示还没解过。 */
export const readCachedHero = async (itemId, cacheRoot) => {
  const heroPath = join(cacheRoot, String(itemId), "hero.png");
  if (!existsSync(heroPath)) return null;
  const size = await readImageSize(heroPath);
  return { heroPath, size };
};

export const cacheDirOf = (itemId, cacheRoot) => dirname(join(cacheRoot, String(itemId), "hero.png"));
