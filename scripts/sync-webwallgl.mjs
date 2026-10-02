#!/usr/bin/env node
// WebWallGL vendored 副本的同步与校验。
//
// 为什么要有这个脚本（而不是手动往 vendor/ 里丢一个 js）：
//   1. vendored 副本**不许就地改** —— 别人（或未来的你）改一行，下次同步就冲突，
//      而且没有任何记录能说明当前这坨 950KB 到底是哪个版本。
//   2. 库的 volume / 帧率 / key 缓存语义都与版本强相关（2.0.2 的泄漏就是这么发现的），
//      所以要有一处能回答"现在装的是哪一版、从哪来、哈希多少"。
//
// vendor/webwallgl/.upstream.json 是唯一事实来源：文件、版本、哈希都在里面。
// 本脚本三种用法：
//
//     node scripts/sync-webwallgl.mjs --check                  # 只核对哈希，不改盘（CI / 发版前跑）
//     node scripts/sync-webwallgl.mjs                          # 按 .upstream.json 重新拉取并覆盖副本
//     node scripts/sync-webwallgl.mjs --from <路径或 URL>       # 从指定来源落地（离线/自建镜像）
//
// 不引任何依赖：tarball 解包用 node:zlib + 手写 USTAR 头解析（只需读文件名与大小）。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const VENDOR_DIR = join(REPO, "vendor", "webwallgl");
const META_FILE = join(VENDOR_DIR, ".upstream.json");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex").toUpperCase();

const readMeta = () => JSON.parse(readFileSync(META_FILE, "utf8").replace(/^\uFEFF/, ""));

function parseArgs(argv) {
  const args = { check: false, from: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`无法识别的参数：${a}`);
  }
  return args;
}

/** 从 USTAR 包里取出指定条目（只用到 name 与 size，够读了） */
function extractFromTar(tar, wantName) {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0[\s\S]*$/, "");
    const sizeText = header.subarray(124, 136).toString("utf8").replace(/\0[\s\S]*$/, "").trim();
    const size = parseInt(sizeText, 8) || 0;
    const start = offset + 512;
    if (name === wantName || name.endsWith("/" + wantName.split("/").pop())) {
      return tar.subarray(start, start + size);
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function readSource(from, meta) {
  const isUrl = /^https?:\/\//i.test(from);
  if (isUrl) {
    const res = await fetch(from);
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status} ${from}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // .tgz：先解 gzip，再从 tar 里挑出 js
    if (from.endsWith(".tgz") || from.endsWith(".tar.gz")) {
      const inner = extractFromTar(gunzipSync(buf), meta.tarballPath ?? "webwallgl.global.min.js");
      if (!inner) throw new Error(`tarball 里找不到 ${meta.tarballPath}`);
      return Buffer.from(inner);
    }
    return buf;
  }
  if (!existsSync(from)) throw new Error(`来源不存在：${from}`);
  return readFileSync(from);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const meta = readMeta();
  if (args.help) {
    console.log(`用法: node scripts/sync-webwallgl.mjs [--check] [--from <路径或 URL>]

  --check        只核对 vendored 副本的哈希与 .upstream.json 是否一致（不改盘）
  --from <来源>  从本地文件 / tar 包 / URL 落地，而不是按 .upstream.json 的 tarball 拉取
  --help         显示本帮助

当前记录：${meta.name}@${meta.version}  ${meta.file}  ${meta.sha256}`);
    return;
  }

  const target = join(VENDOR_DIR, meta.file);

  if (args.check) {
    if (!existsSync(target)) throw new Error(`vendored 副本缺失：${target}`);
    const actual = sha256(readFileSync(target));
    const ok = actual === meta.sha256;
    console.log(`${ok ? "OK  " : "FAIL"} ${meta.file}`);
    console.log(`     记录 ${meta.sha256}`);
    console.log(`     实际 ${actual}`);
    if (!ok) {
      throw new Error("vendored 副本与 .upstream.json 不一致 —— 副本不许就地改，请重新同步");
    }
    console.log(`     版本 ${meta.name}@${meta.version}（${(meta.bytes / 1024).toFixed(0)}KB）`);
    return;
  }

  const from = args.from ?? meta.tarball ?? meta.source;
  if (!from) throw new Error("没有可用来源：请在 .upstream.json 里写 tarball/source，或用 --from 指定");
  console.log(`来源 ${from}`);
  const bytes = await readSource(from, meta);
  const hash = sha256(bytes);

  mkdirSync(VENDOR_DIR, { recursive: true });
  writeFileSync(target, bytes);
  const next = { ...meta, bytes: bytes.length, sha256: hash, syncedAt: new Date().toISOString().slice(0, 10) };
  if (args.from) next.source = args.from;
  writeFileSync(META_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");

  console.log(`落地 ${target}`);
  console.log(`  ${bytes.length} 字节  sha256=${hash}`);
  if (meta.sha256 && meta.sha256 !== hash) {
    console.log(`  ⚠️ 与上一版记录的哈希不同（上一版 ${meta.sha256}）—— 确认这是有意的升级`);
  }
  console.log("  .upstream.json 已更新");
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
});
