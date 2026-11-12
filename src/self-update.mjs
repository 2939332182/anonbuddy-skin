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
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { readZipEntries, readZipFile, detectRootPrefix } from "./zip-read.mjs";

const ZIP_LOCAL_SIG = 0x04034b50;

/**
 * 端口 → 产品线。`src/platform/workbuddy-path.mjs` 的 PORT_BY_LEAF 反过来用。
 * 用途：安装目录被改名（比如就是开发仓库 `workbuddy-skin-studio`）时，
 * `detectEdition` 推不出产品线，会退回「取第一个 asset」——国际版用户会装上国内包。
 */
export const EDITION_BY_PORT = { 9333: "intl", 9334: "cn" };

/** @param {number} port */
export function editionFromPort(port) {
  return EDITION_BY_PORT[Number(port)] || "";
}

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
 *
 * `backupDir` 给了就把「将被覆盖的已存在文件」先复制过去 —— 更新可能落在开发仓库
 * （桌面图标指向的就是仓库目录），覆盖源码前必须先留一份可回滚的副本。
 * @returns {{written:number, skipped:number, backedUp:number, backupDir:string}}
 */
export function installFromZip(zipBuf, root, { backupDir = "" } = {}) {
  const entries = readZipEntries(zipBuf);
  const prefix = detectRootPrefix(entries);
  const rootAbs = resolve(root);
  let written = 0;
  let skipped = 0;
  let backedUp = 0;

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
    if (backupDir && existsSync(target)) {
      const copyTo = join(backupDir, rel);
      try {
        mkdirSync(dirname(copyTo), { recursive: true });
        copyFileSync(target, copyTo);
        backedUp += 1;
      } catch {
        /* 备份失败不阻断更新：原件还在，只是少一层回滚保险 */
      }
    }
    const data = readZipFile(zipBuf, entry);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    written += 1;
  }
  return { written, skipped, backedUp, backupDir };
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

/** 覆盖更新前的回滚目录：%LOCALAPPDATA%\AnonBuddySkin\update-backup-<时间戳> */
function updateBackupRoot() {
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "AnonBuddySkin");
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
 * 不消耗 GitHub API 配额的 Release 探测。
 *   ① `https://github.com/<repo>/releases/latest` 是 302，Location 尾巴就是 tag；
 *   ② `https://github.com/<repo>/releases/expanded_assets/<tag>` 是渲染资产列表的 HTML 片段。
 * 两条都是网页路由，未鉴权也不计入 API 配额。
 *
 * 为什么必须绕：2026-11-12 实测本机出口 IP 调 api.github.com 直接
 * `403 rate limit exceeded`，面板点「一键更新」只会得到「读不到 GitHub Release」，
 * 而包其实是好的。终端用户走运营商 NAT，共享出口更容易打满 60 次/小时。
 *
 * @returns {Promise<string>} tag（保留 `v` 前缀），拿不到返回 ""
 */
export async function latestTagViaRedirect({ repo, timeoutMs = 15_000 }) {
  try {
    const res = await fetch(`https://github.com/${repo}/releases/latest`, {
      redirect: "manual",
      headers: { "User-Agent": "anonbuddy-skin-updater" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.headers.get("location") || "";
    const matched = /\/releases\/tag\/([^/?#]+)$/.exec(location);
    return matched ? decodeURIComponent(matched[1]) : "";
  } catch {
    return "";
  }
}

/**
 * 从 HTML 片段里刮出某个 Release 的 zip 资产。
 * @returns {Promise<Array<{name:string,url:string}>>}
 */
export async function releaseAssetsViaHtml({ repo, tag, timeoutMs = 15_000 }) {
  try {
    const res = await fetch(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`, {
      headers: { "User-Agent": "anonbuddy-skin-updater" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const names = new Set();
    const re = /releases\/download\/[^/"']+\/([^/"']+\.zip)/gi;
    let matched;
    while ((matched = re.exec(html))) names.add(decodeURIComponent(matched[1]));
    return [...names].map((name) => ({ name, url: `https://github.com/${repo}/releases/download/${tag}/${name}` }));
  } catch {
    return [];
  }
}

/**
 * 查最新 Release。返回 { tag, version, asset:{name,size,url}, htmlUrl, via } 或 null。
 * @param {{repo:string, edition?:string, log?:(m:string)=>void}} opts
 */
export async function fetchLatestRelease({ repo, edition = "", log = () => {} }) {
  // ① 网页路由：零配额。size 拿不到（HTML 里只有 "2.99 MB" 这种近似值），
  //    下载时传 expectBytes=0 跳过字节数校验，改由 ZIP 魔数 + 解包完整性兜底。
  const htmlTag = await latestTagViaRedirect({ repo });
  if (htmlTag) {
    const assets = await releaseAssetsViaHtml({ repo, tag: htmlTag });
    const zips = assets.filter((a) => /^chihayaanon-skin-.+\.zip$/i.test(a.name));
    if (zips.length) {
      const want = edition ? zips.find((a) => a.name.includes(`-${edition}.zip`)) : null;
      const asset = want || zips[0];
      if (edition && !want) log(`没有 -${edition} 包，退回 ${asset.name}`);
      log(`Release ${htmlTag}（网页路由，未消耗 API 配额）`);
      return {
        tag: htmlTag,
        version: htmlTag.replace(/^v/i, ""),
        asset: { name: asset.name, size: 0, url: asset.url },
        htmlUrl: `https://github.com/${repo}/releases/tag/${htmlTag}`,
        via: "html",
      };
    }
    log(`读到 tag ${htmlTag}，但资产列表没解析出来，回退 API`);
  }

  // ② API 回退（有配额时更准，能拿到精确字节数）
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "anonbuddy-skin-updater" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    log(`API 不可达：${error && error.message ? error.message : error}`);
    return null;
  }
  if (res.status === 403 || res.status === 429) {
    log("API 被限流（未鉴权 60 次/小时），网页路由也没读到 Release");
    return null;
  }
  if (!res.ok) return null;
  const info = await res.json();
  const tag = String(info.tag_name || "");
  const version = tag.replace(/^v/i, "");
  const zips = (info.assets || []).filter((a) => /^chihayaanon-skin-.+\.zip$/i.test(a.name || ""));
  if (!zips.length) return null;
  // 优先匹配本机产品线；推不出产品线就取第一个
  const want = edition ? zips.find((a) => a.name.includes(`-${edition}.zip`)) : null;
  const asset = want || zips[0];
  return {
    tag,
    version,
    asset: { name: asset.name, size: asset.size, url: asset.browser_download_url },
    htmlUrl: info.html_url || "",
    via: "api",
  };
}

/**
 * 走完整条更新链：查最新 → 比版本 → 下载 → 覆盖安装。
 * @returns {Promise<object>} 结构化结果（HTTP 端点直接把它转成 JSON）
 */
export async function runSelfUpdate({ root, repo, edition = "", log = () => {}, apply = true, force = false }) {
  const from = installedVersion(root);
  const release = await fetchLatestRelease({ repo, edition, log });
  if (!release) {
    return {
      ok: false,
      stage: "check",
      error: "读不到 GitHub Release：网络不可达，或 GitHub API 已限流（未登录 60 次/小时）。稍后再试。",
    };
  }
  if (!force && from && !isNewer(release.version, from)) {
    return { ok: true, stage: "uptodate", from, to: release.version, applied: false };
  }
  if (!apply) {
    return { ok: true, stage: "available", from, to: release.version, asset: release.asset.name, applied: false };
  }
  let zipBuf;
  try {
    // assets 的下载地址是 https://github.com/<owner>/<repo>/releases/download/<tag>/<name>，
    // 镜像只在这个绝对地址前面加前缀，所以这里直接把它当 path 传（前缀拼接由 downloadAsset 做）。
    // 网页路由拿到的 size 是 0（HTML 里只有 "2.99 MB" 这种近似值），跳过字节数校验，
    // 由 downloadAsset 的 ZIP 魔数检查 + installFromZip 的解包完整性兜底。
    zipBuf = await downloadAsset({ path: release.asset.url, expectBytes: release.asset.size, log });
  } catch (error) {
    return { ok: false, stage: "download", error: String(error && error.message ? error.message : error) };
  }
  try {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const backupDir = join(updateBackupRoot(), `update-backup-${stamp}`);
    const { written, skipped, backedUp } = installFromZip(zipBuf, root, { backupDir });
    log(`已写入 ${written} 个文件（跳过 ${skipped}，备份 ${backedUp}）`);
    return {
      ok: true,
      stage: "done",
      from,
      to: release.version,
      applied: true,
      written,
      skipped,
      backedUp,
      backupDir: backedUp ? backupDir : "",
    };
  } catch (error) {
    return { ok: false, stage: "install", error: String(error && error.message ? error.message : error) };
  }
}
