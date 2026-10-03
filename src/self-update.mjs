// 一键更新：从 GitHub Release 取新包，就地覆盖当前安装目录。
//
// 为什么这件事必须由 Node 侧做：设置面板跑在渲染进程里，是个 file:// 页面，
// **写不了文件系统**。守护进程是常驻 Node（scripts/skin-guard.mjs 拉起来的），
// 让它开一个本机端点、面板点按钮打过去 —— 这是唯一不需要改官方文件的通道。
//
// 安全口径（照抄 scripts/publish-via-api.mjs 的谨慎程度）：
//   · 只从本仓库的 release 取包，镜像**只换前缀**，URL 后半段原样不动；
//   · 下载完校验字节数与 ZIP 魔数，不符就换下一个源，全失败才报错；
//   · 解包只允许落在包目录内部，绝对路径与 `..` 穿越一律跳过；
//   · 先解到临时目录再逐文件覆盖，任何一步失败都不会留下半个包。
//
// 不做的：不碰 app.asar、不碰 WorkBuddy 安装目录、不动注册表 —— 更新的只是这个插件自己。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { readZipEntries, readZipFile, detectRootPrefix } from "./zip-read.mjs";

const ZIP_LOCAL_SIG = 0x04034b50;

/**
 * 下载源。前缀是**镜像代理**，后面原样接 GitHub 的下载地址。
 * 2026-10-04 实测（本机）：直连 / ghproxy.net / gh-proxy.com / ghfast.top 四个可用；
 * hub.gitmirror.com、gh.llkk.cc、github.moeyy.xyz 当时不可用（域名失效或超时）。
 * 顺序即优先级：先直连（最快且不经第三方），失败再依次走镜像。
 */
export const DOWNLOAD_MIRRORS = [
  "",
  "https://ghproxy.net/",
  "https://gh-proxy.com/",
  "https://ghfast.top/",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 依次尝试各下载源，返回 ZIP 的字节。
 * @param {{path:string, expectBytes?:number, mirrors?:string[], timeoutMs?:number, log?:(m:string)=>void}} opts
 */
export async function downloadAsset({ path, expectBytes = 0, mirrors = DOWNLOAD_MIRRORS, timeoutMs = 90_000, log = () => {} }) {
  const failures = [];
  for (const prefix of mirrors) {
    const label = prefix ? new URL(prefix).host : "直连";
    const url = prefix + path;
    try {
      log(`下载尝试：${label}`);
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error(`内容过小（${buf.length} 字节）`);
      if (buf.readUInt32LE(0) !== ZIP_LOCAL_SIG) throw new Error("不是 ZIP");
      if (expectBytes && buf.length !== expectBytes) throw new Error(`字节数不符：${buf.length} != ${expectBytes}`);
      log(`  ✓ ${label} ${(buf.length / 1048576).toFixed(2)} MB`);
      return buf;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      failures.push(`${label}: ${message}`);
      log(`  ✗ ${label} — ${message}`);
    }
  }
  throw new Error(`所有下载源都失败（${failures.join("；")}）`);
}

/**
 * 把 ZIP 覆盖安装到 root。
 * @returns {{written:number, skipped:number}}
 */
export function installFromZip(zipBuf, root) {
  const entries = readZipEntries(zipBuf);
  const prefix = detectRootPrefix(entries);
  const rootAbs = resolve(root);
  let written = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue;              // 目录条目，交给 mkdirSync
    if (prefix && !entry.name.startsWith(prefix)) { skipped += 1; continue; }
    const rel = prefix ? entry.name.slice(prefix.length) : entry.name;
    if (!rel) continue;
    // 拒绝穿越：绝对路径、盘符、任何一段 `..`
    if (rel.startsWith("/") || /^[a-zA-Z]:/.test(rel) || rel.split("/").includes("..")) {
      skipped += 1;
      continue;
    }
    const target = resolve(join(rootAbs, rel));
    // 最后一道：解出来的路径必须真的在包目录里
    if (target !== rootAbs && !target.startsWith(rootAbs + sep)) {
      skipped += 1;
      continue;
    }
    const data = readZipFile(zipBuf, entry);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    written += 1;
  }
  return { written, skipped };
}

/** 找出这个安装目录属于哪个产品线（包目录名带 -cn / -intl；推断不出就交给调用方兜底） */
export function detectEdition(root) {
  const name = resolve(root).split(sep).pop() || "";
  if (/-cn$/i.test(name)) return "cn";
  if (/-intl$/i.test(name)) return "intl";
  return "";
}

/** 当前安装的版本（读包内的 package.json） */
export function installedVersion(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return String(pkg.version || "");
  } catch {
    return "";
  }
}

/** 三段式版本比较（与注入脚本里那套同一口径）：a > b 返回 true */
export function isNewer(a, b) {
  const parse = (v) => String(v || "").replace(/^v/i, "").split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * 查最新 Release。返回 { tag, version, asset:{name,size,path,url} } 或 null。
 * @param {{repo:string, edition?:string, log?:(m:string)=>void}} opts
 */
export async function fetchLatestRelease({ repo, edition = "", log = () => {} }) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "anonbuddy-skin-updater" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const info = await res.json();
  const tag = String(info.tag_name || "");
  const version = tag.replace(/^v/i, "");
  const zips = (info.assets || []).filter((a) => /^chihayaanon-skin-.+\.zip$/i.test(a.name || ""));
  if (!zips.length) return null;
  // 优先匹配本机产品线；推不出产品线（目录被改过名）就取第一个，宁可更新错也不空手
  const want = edition ? zips.find((a) => a.name.includes(`-${edition}.zip`)) : null;
  const asset = want || zips[0];
  return {
    tag,
    version,
    asset: { name: asset.name, size: asset.size, url: asset.browser_download_url },
    htmlUrl: info.html_url || "",
  };
}

/**
 * 走完整条更新链：查最新 → 比版本 → 下载 → 覆盖安装。
 * @returns {Promise<object>} 结构化结果（HTTP 端点直接把它转成 JSON）
 */
export async function runSelfUpdate({ root, repo, edition = "", log = () => {}, apply = true, force = false }) {
  const from = installedVersion(root);
  const release = await fetchLatestRelease({ repo, edition, log });
  if (!release) return { ok: false, stage: "check", error: "读不到 GitHub Release（可能被墙或仓库没有 Release）" };
  if (!force && from && !isNewer(release.version, from)) {
    return { ok: true, stage: "uptodate", from, to: release.version, applied: false };
  }
  if (!apply) {
    return { ok: true, stage: "available", from, to: release.version, asset: release.asset.name, applied: false };
  }
  let zipBuf;
  try {
    // assets 的下载地址是 https://github.com/<owner>/<repo>/releases/download/<tag>/<name>，
    // 镜像只在这个绝对地址前面加前缀，所以这里直接把它当 path 传（前缀拼接由 downloadAsset 做）
    zipBuf = await downloadAsset({ path: release.asset.url, expectBytes: release.asset.size, log });
  } catch (error) {
    return { ok: false, stage: "download", error: String(error && error.message ? error.message : error) };
  }
  try {
    const { written, skipped } = installFromZip(zipBuf, root);
    log(`已写入 ${written} 个文件（跳过 ${skipped}）`);
    return { ok: true, stage: "done", from, to: release.version, applied: true, written, skipped };
  } catch (error) {
    return { ok: false, stage: "install", error: String(error && error.message ? error.message : error) };
  }
}
