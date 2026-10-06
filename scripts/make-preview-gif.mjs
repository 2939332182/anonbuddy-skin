// 采集 WorkBuddy 主窗口的连续帧并编码成 GIF（README 的场景渲染演示图）。
//
// 这台机器上没有现成编码器（ffmpeg / ImageMagick / gifsicle 都没有），
// 所以三件事都自己来：PNG 解码（只处理 CDP 截图会给出的 8bit 非隔行 PNG）、
// 中位切分量化到 256 色、GIF89a + LZW 编码。
//
// 原本是在 outputs/ 下试做的（那里 gitignored），验证可用后移进了 scripts/ ——
// 注册表测试用的是 `${scriptFiles.length}`，不硬编码脚本数量，新增脚本不会让它失败。
//
// ⚠️ 前置条件：**目标窗口必须可见**。窗口收进托盘/最小化时没有新帧可合成，
//    `Page.captureScreenshot` 会一直悬着直到超时（脚本里有这个检查，会直接退出）。
//
// 用法: node scripts\make-preview-gif.mjs [port] [outPath] [targetWidth] [frames]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { inflateSync } from "node:zlib";

import { CdpSession, fetchRendererTargets } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const OUT = process.argv[3] || "docs/images/preview-scene.gif";
const TARGET_W = Number(process.argv[4] || 760);
const FRAMES = Number(process.argv[5] || 14);
const DELAY_MS = 90;
const DELAY_CS = 9;          // GIF 帧延迟，单位 1/100 秒

// ---------------------------------------------------------------- PNG 解码
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let p = 8;
  let w = 0;
  let h = 0;
  let bd = 0;
  let ct = 0;
  let il = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bd = data[8];
      ct = data[9];
      il = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bd !== 8 || il !== 0 || (ct !== 6 && ct !== 2)) throw new Error(`不支持的 PNG：bd=${bd} ct=${ct} il=${il}`);
  const ch = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y += 1) {
    const ft = raw[y * (stride + 1)];
    // 反过滤必须**就地**做：后面的像素依赖前面已经还原的值
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    prev = line;
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      out[o] = line[x * ch];
      out[o + 1] = line[x * ch + 1];
      out[o + 2] = line[x * ch + 2];
      out[o + 3] = ch === 4 ? line[x * ch + 3] : 255;
    }
  }
  return { w, h, data: out };
}

// ------------------------------------------------------- 中位切分量化（全局调色板）
function quantize(frames, maxColors) {
  const hist = new Map();
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4 * 5) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  const all = [];
  for (const entry of hist) {
    all.push({ r: (entry[0] >> 16) & 255, g: (entry[0] >> 8) & 255, b: entry[0] & 255, n: entry[1] });
  }
  let boxes = [all];
  while (boxes.length < maxColors) {
    let bi = -1;
    let best = -1;
    let bestCh = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.length < 2) continue;
      let rmin = 255; let rmax = 0; let gmin = 255; let gmax = 0; let bmin = 255; let bmax = 0;
      for (const c of box) {
        if (c.r < rmin) rmin = c.r; if (c.r > rmax) rmax = c.r;
        if (c.g < gmin) gmin = c.g; if (c.g > gmax) gmax = c.g;
        if (c.b < bmin) bmin = c.b; if (c.b > bmax) bmax = c.b;
      }
      const dr = rmax - rmin;
      const dg = gmax - gmin;
      const db = bmax - bmin;
      const ch = dr >= dg && dr >= db ? 0 : dg >= db ? 1 : 2;
      const score = (ch === 0 ? dr : ch === 1 ? dg : db) * box.length;
      if (score > best) { best = score; bi = i; bestCh = ch; }
    }
    if (bi < 0 || best <= 0) break;
    const box = boxes[bi].slice().sort((a, b) => (bestCh === 0 ? a.r - b.r : bestCh === 1 ? a.g - b.g : a.b - b.b));
    const mid = Math.max(1, Math.floor(box.length / 2));
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (const c of box) { r += c.r * c.n; g += c.g * c.n; b += c.b * c.n; n += c.n; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/** 把一帧映射成调色板索引（带缓存：颜色种类有限，最近邻只需算一次） */
function toIndices(frame, palette) {
  const cache = new Map();
  const out = Buffer.alloc(frame.w * frame.h);
  const d = frame.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let idx = cache.get(k);
    if (idx === undefined) {
      let best = 1e9;
      idx = 0;
      for (let j = 0; j < palette.length; j += 1) {
        const c = palette[j];
        const dr = d[i] - c[0];
        const dg = d[i + 1] - c[1];
        const db = d[i + 2] - c[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < best) { best = dist; idx = j; }
      }
      cache.set(k, idx);
    }
    out[p] = idx;
  }
  return out;
}

// ---------------------------------------------------------------- GIF LZW
function lzwEncode(pixels, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = clear + 2;
  let dict = new Map();
  const out = [];
  let cur = 0;
  let bits = 0;
  const emit = (code) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) { out.push(cur & 255); cur >>= 8; bits -= 8; }
  };
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i += 1) {
    const k = pixels[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next);
      next += 1;
      if (next > (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      emit(clear);
      dict = new Map();
      next = clear + 2;
      codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return Buffer.from(out);
}

function buildGif(w, h, palette, frames, delayCs) {
  const parts = [];
  const push = (...bytes) => parts.push(Buffer.from(bytes));
  parts.push(Buffer.from("GIF89a", "ascii"));
  push(w & 255, w >> 8, h & 255, h >> 8, 0xf7, 0, 0);
  const gct = Buffer.alloc(768);
  for (let i = 0; i < 256; i += 1) {
    const c = palette[i] || [0, 0, 0];
    gct[i * 3] = c[0];
    gct[i * 3 + 1] = c[1];
    gct[i * 3 + 2] = c[2];
  }
  parts.push(gct);
  push(0x21, 0xff, 0x0b);
  parts.push(Buffer.from("NETSCAPE2.0", "ascii"));
  push(0x03, 0x01, 0x00, 0x00, 0x00);
  for (const indices of frames) {
    push(0x21, 0xf9, 0x04, 0x04, delayCs & 255, delayCs >> 8, 0x00, 0x00);
    push(0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0x00);
    const lzw = lzwEncode(indices, 8);
    push(0x08);
    for (let i = 0; i < lzw.length; i += 255) {
      const chunk = lzw.subarray(i, i + 255);
      push(chunk.length);
      parts.push(chunk);
    }
    push(0x00);
  }
  push(0x3b);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- 主流程
const targets = await fetchRendererTargets(PORT);
const main = targets.find((t) => !/[?&](?:windowKind|windowAppId)=/i.test(t.url ?? ""));
if (!main) { console.log("没有主窗口 target"); process.exit(4); }
const session = new CdpSession(main.webSocketDebuggerUrl, { commandTimeoutMs: 120000 });
await session.open();

/** 最近邻降采样。不用 Page.captureScreenshot 的 clip.scale —— 那会让 Chromium 重新光栅化，
 *  而场景渲染正占着 GPU，实测直接卡到 60 秒超时。全尺寸截完自己缩，稳。 */
function downsample(frame, targetW) {
  if (frame.w <= targetW) return frame;
  const step = frame.w / targetW;
  const w = targetW;
  const h = Math.round(frame.h / step);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(frame.h - 1, Math.round(y * step));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(frame.w - 1, Math.round(x * step));
      const si = (sy * frame.w + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = frame.data[si];
      out[di + 1] = frame.data[si + 1];
      out[di + 2] = frame.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { w, h, data: out };
}

const vp = JSON.parse(await session.evaluate(`JSON.stringify({
  w: innerWidth, h: innerHeight,
  skin: document.documentElement.dataset.anonbuddySkin || null,
  scene: document.querySelectorAll("[data-wb-we-scene]").length,
  video: document.querySelectorAll("#anonbuddy-skin-bg > video").length,
  hidden: document.hidden,
})`));
console.log(`视口 ${vp.w}x${vp.h}  壁纸=${vp.skin}  scene层=${vp.scene}  video=${vp.video}  页面隐藏=${vp.hidden}`);
if (vp.hidden) {
  console.log("⚠️ 页面处于隐藏状态（窗口收进托盘/最小化）—— 此时没有新帧可合成，截图会挂住。先让窗口可见。");
  process.exit(3);
}
console.log(`采集 ${FRAMES} 帧（全尺寸截图后本地降采样）`);

const frames = [];
// 场景渲染持续占着 GPU，合成器截图会排队 —— 先把窗口提到前台（前台窗口的合成器更活跃），
// 并开 optimizeForSpeed（让截图走更快的编码路径）。
await session.send("Page.bringToFront", {}).catch(() => {});
for (let i = 0; i < FRAMES; i += 1) {
  const shot = await session.send(
    "Page.captureScreenshot",
    { format: "png", optimizeForSpeed: true },
    { timeoutMs: 20_000 },
  );
  frames.push(downsample(decodePng(Buffer.from(shot.data, "base64")), TARGET_W));
  process.stdout.write(`\r  已采 ${i + 1}/${FRAMES}`);
  await new Promise((r) => setTimeout(r, DELAY_MS));
}
console.log("");
const { w, h } = frames[0];
console.log(`帧尺寸 ${w}x${h}`);

console.log("量化中…");
const palette = quantize(frames, 256);
console.log(`调色板 ${palette.length} 色`);
const indices = frames.map((f) => toIndices(f, palette));
const gif = buildGif(w, h, palette, indices, DELAY_CS);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, gif);
console.log(`${OUT}  ${(gif.length / 1048576).toFixed(2)} MB  ${FRAMES} 帧`);
session.close();
