// 从 Wallpaper Engine 工坊条目生成插件主题（hero.webp + theme.json）。
//
// 为什么需要它：WE 的 scene/web 壁纸素材是打包或散落的（scene.pkg、files/*.mp4），
// 而插件主题只要一张静态 hero + 一套配色。本脚本借 WorkBuddy renderer 的 Chromium
// 做解码 / 抽帧 / 缩放 / webp 编码 / 取色，零外部依赖（不需要 sharp / ffmpeg）。
//
// 用法：
//   node scripts/make-skin-from-we.mjs <itemId> <themeId> "<显示名>" [preview|scene|图片路径|视频路径]
//
// preview / scene 会各自去找工坊缩略图与 we-cache 的 scene 贴图；给具体路径则直接用。
// 视频（mp4/webm）走抽帧：工坊缩略图常常只有 160~256px，而视频本体是 2K/4K。
//
// 版权提示：创意工坊内容归原作者。把 WE 素材打进公开仓库分发前，先确认你有权这么做。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
import { findWorkshopDirs, toFileUrl } from "../src/we-library.mjs";
import { resolveCacheRoot, readCachedHero } from "../src/we-extract.mjs";

const [itemId, themeId, name, sourceArg = "preview"] = process.argv.slice(2);
if (!itemId || !themeId || !name) {
  console.error('用法: node scripts/make-skin-from-we.mjs <itemId> <themeId> "<显示名>" [preview|scene|路径]');
  process.exit(1);
}

const IMAGE_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const VIDEO_EXT = new Set([".mp4", ".webm"]);

// ---- 找源 ----
let srcPath = sourceArg;
if (sourceArg === "scene") {
  const cached = await readCachedHero(itemId, resolveCacheRoot());
  if (!cached) throw new Error("we-cache 里没有该条目的 hero.png（先跑 npm run we:extract）");
  srcPath = cached.heroPath;
} else if (sourceArg === "preview") {
  const dirs = await findWorkshopDirs();
  let entry = null;
  for (const d of dirs) {
    const p = join(d, String(itemId));
    if (existsSync(p)) { entry = p; break; }
  }
  if (!entry) throw new Error("找不到工坊条目目录: " + itemId);
  const preview = readdirSync(entry).find((f) => /^preview\.(jpg|jpeg|png|gif|webp)$/i.test(f));
  if (!preview) throw new Error("条目里没有 preview 图");
  srcPath = join(entry, preview);
}
if (!existsSync(srcPath)) throw new Error("源不存在: " + srcPath);

const ext = extname(srcPath).toLowerCase();
const isVideo = VIDEO_EXT.has(ext);
const mime = IMAGE_EXT[ext];
if (!isVideo && !mime) throw new Error("不支持的类型: " + srcPath);

// ---- 借 renderer 解码 / 抽帧 / 缩放 / 编码 / 取色 ----
const targets = await fetchRendererTargets(9333);
if (!targets.length) throw new Error("未找到 WorkBuddy renderer（需以 CDP 模式运行）");
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();

// 一律走 file:// 直读：renderer 本身就是 file:// 页面，直接读本地文件比塞 base64 快得多，
// 也不会让 CDP 表达式膨胀（猫娘那张 10MB PNG 走 base64 会变成 13MB 的字符串）。
const src = toFileUrl(srcPath);

const result = await s.evaluate(`(async () => {
  let drawSource, srcW, srcH;

  if (${isVideo}) {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = ${JSON.stringify(src)};
    await new Promise((resolve, reject) => {
      v.onloadeddata = () => resolve(true);
      v.onerror = () => reject(new Error("视频加载失败"));
      setTimeout(() => reject(new Error("视频加载超时")), 40000);
    });
    // 取中间偏后的帧：片头常有黑场 / 字幕板
    const target = Math.min(Math.max(1, v.duration * 0.35), Math.max(1, v.duration - 1));
    v.currentTime = target;
    await new Promise((resolve, reject) => {
      v.onseeked = () => resolve(true);
      setTimeout(() => reject(new Error("跳帧超时")), 40000);
    });
    drawSource = v;
    srcW = v.videoWidth; srcH = v.videoHeight;
  } else {
    const img = new Image();
    //  用 onload 而不是 img.decode()：实测 decode() 在本 renderer 里会永久 pending（30s+ 不 settle），
    //    onload 走同一条解码路径却只要几毫秒。
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(true);
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = ${JSON.stringify(src)};
    });
    drawSource = img;
    srcW = img.naturalWidth; srcH = img.naturalHeight;
  }

  const MAX = 2560;
  const scale = Math.min(1, MAX / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(drawSource, 0, 0, w, h);
  const webp = c.toDataURL("image/webp", 0.86);

  // 取色：缩到 64 宽采样，先取"出现最多"的一批主色，再在其中挑饱和度最高的当强调色
  const sw = 64, sh = Math.max(1, Math.round(64 * srcH / srcW));
  const sc = document.createElement("canvas");
  sc.width = sw; sc.height = sh;
  const sctx = sc.getContext("2d");
  sctx.drawImage(drawSource, 0, 0, sw, sh);
  const px = sctx.getImageData(0, 0, sw, sh).data;

  const buckets = new Map();
  let lumSum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
    if (a < 128) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const v = mx / 255;
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; n++;
    if (sat < 0.22 || v < 0.28) continue;   // 太灰或太暗的像素当不了 UI 强调色
    const q = [Math.round(r / 32) * 32, Math.round(g / 32) * 32, Math.round(b / 32) * 32].join(",");
    const cur = buckets.get(q) || { count: 0, r: 0, g: 0, b: 0, sat: 0, val: 0 };
    cur.count++; cur.r += r; cur.g += g; cur.b += b; cur.sat += sat; cur.val += v;
    buckets.set(q, cur);
  }
  const score = (o) => (o.sat / o.count) * (o.val / o.count) * Math.log(1 + o.count);
  const ranked = [...buckets.values()]
    .map((o) => ({ ...o, avgSat: o.sat / o.count, avgVal: o.val / o.count }))
    .sort((a, b) => score(b) - score(a));
  const avg = (o) => [Math.round(o.r / o.count), Math.round(o.g / o.count), Math.round(o.b / o.count)];
  const hex = (rgb) => "#" + rgb.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("");
  const brighten = (rgb, t) => rgb.map((x) => Math.round(x + (255 - x) * t));
  const darken = (rgb, t) => rgb.map((x) => Math.round(x * (1 - t)));
  const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

  const c1 = ranked[0] ? avg(ranked[0]) : [36, 201, 215];
  const c2 = ranked[1] ? avg(ranked[1]) : [239, 143, 211];
  const avgLum = n ? lumSum / n : 0.5;
  const dark = avgLum < 0.42;

  return {
    webp,
    size: [w, h],
    source: [srcW, srcH],
    dark,
    avgLum: Math.round(avgLum * 100) / 100,
    picked: ranked.length,
    colors: {
      accent: hex(c1),
      secondary: hex(c2),
      surface: dark ? hex(darken(mix(c1, [255, 255, 255], 0.03), 0.88)) : hex(brighten(c1, 0.93)),
      text: dark ? hex(brighten(c1, 0.84)) : hex(darken(mix(c1, [0, 0, 0], 0.5), 0.55)),
    },
  };
})()`, { timeoutMs: 180000 });
s.close();

// ---- 落盘 ----
const dir = join(fileURLToPath(new URL("..", import.meta.url)), "themes", themeId);
mkdirSync(dir, { recursive: true });
const webpBuf = Buffer.from(result.webp.split(",")[1], "base64");
writeFileSync(join(dir, "hero.webp"), webpBuf);
const manifest = { schemaVersion: 1, id: themeId, name, hero: "hero.webp", colors: result.colors };
writeFileSync(join(dir, "theme.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({
  themeId, name, src: srcPath, isVideo,
  srcSize: result.source, outSize: result.size,
  dark: result.dark, avgLum: result.avgLum, colorBuckets: result.picked,
  colors: result.colors, heroBytes: webpBuf.length,
}, null, 2));
