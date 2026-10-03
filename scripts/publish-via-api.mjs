#!/usr/bin/env node
// 用 GitHub API 完成「推送提交 + 打标签 + 建 Release + 传附件」。
//
// 为什么需要这条路：这台机器上 **git 的 HTTPS 通道会被 RST**（`Empty reply from server`
// / `Recv failure: Connection was reset`），而 `api.github.com` 与 `uploads.github.com`
// 是通的 —— 两条路走的中间设备不一样。所以网络卡住时，走 API 能把版本正常发出去。
//
// ⚠️ 它**不做合并、不会覆盖远端**：父提交必须显式给（`--base-sha`），
//    更新分支时 `force: false`（远端又变了就会失败），推完还会逐文件核对 blob sha。
//
// 默认 **dry-run**：只打印将要发生什么。加 `--apply` 才真写。
//
// 用法：
//   set GITHUB_TOKEN=gho_xxx
//   node scripts/publish-via-api.mjs --tag v1.0.5 \
//        --diff-base 5364702 --base-sha c713513 \
//        --notes-file outputs/release-notes-1.0.5.md \
//        --assets dist/chihayaanon-skin-1.0.5-cn.zip dist/chihayaanon-skin-1.0.5-intl.zip [--apply]
//
// 参数：
//   --repo <owner/name>   默认 2939332182/anonbuddy-skin
//   --branch <name>       默认 main
//   --base-sha <sha>      远端当前分支头（必填，脚本不会替你猜）
//   --diff-base <rev>     本地这个 rev 之后变更的文件才推送（通常是远端基线提交）
//   --tag <vX.Y.Z>        要打的标签
//   --message <msg>       提交信息
//   --notes-file <path>   Release 说明（UTF-8 读，按字节发，避免中文变问号）
//   --assets <f1> <f2>    要上传的附件（空格分隔，直到下一个 -- 参数）
//   --replace-assets      同名附件已存在时先删掉再传（GitHub 不允许覆盖）
//   --skip-push / --skip-tag / --skip-release   分步执行
//   --apply               真的执行（否则只 dry-run）

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
/** 收集某个 flag 之后的连续值，直到遇到下一个 -- 开头的 token */
const list = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j += 1) out.push(argv[j]);
  return out;
};

const REPO = value("--repo", "2939332182/anonbuddy-skin");
const BRANCH = value("--branch", "main");
/**
 * 短 sha 会在 `/git/commits/{sha}` 上 404（那个端点要完整 40 位），而手抄一长串又容易错。
 * 本地有该对象就自动展开成完整 sha；本地没有（例如远端刚被人推了新提交、还没 fetch）
 * 就原样返回 —— 让后面的"父提交核对"去报错，而不是在这里悄悄改掉用户的意思。
 */
function expandSha(rev) {
  if (!rev) return rev;
  try {
    return execFileSync("git", ["rev-parse", rev + "^{commit}"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  } catch {
    return rev;
  }
}
const BASE_SHA = expandSha(value("--base-sha"));
const DIFF_BASE = value("--diff-base");
const TAG = value("--tag");
const NOTES_FILE = value("--notes-file");
const ASSETS = list("--assets");
const APPLY = flag("--apply");
const REPLACE_ASSETS = flag("--replace-assets");
const SKIP_PUSH = flag("--skip-push");
const SKIP_TAG = flag("--skip-tag");
const SKIP_RELEASE = flag("--skip-release");
const MESSAGE = value("--message", TAG ? `release: ${TAG}` : "release");
// ⚠️ 显式文件清单（不给时按 --diff-base 算）
const FILES = list("--files");
// ⚠️ 推送前把 CRLF 压成 LF。**必须用**：`core.autocrlf=true` 时 git 里存的是 LF、
//    工作区是 CRLF，而本脚本读的是工作区字节 —— 不归一化就会把远端文件的行尾改掉
//    （1.0.5 首发踩过：3 个 CRLF 文件被推成 CRLF，与仓库其余部分不一致）。
const NORMALIZE_EOL = flag("--normalize-eol");
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error("缺少 GITHUB_TOKEN 环境变量");
  process.exit(2);
}
if (!BASE_SHA) {
  console.error("必须显式给 --base-sha（远端当前分支头），脚本不替你猜");
  process.exit(2);
}

const [OWNER, NAME] = REPO.split("/");
const log = (label, detail) => console.log(`  ${label}${detail === undefined ? "" : "  " + detail}`);
const step = (n, title) => console.log(`\n[${n}] ${title}`);

async function api(method, path, body, { contentType = "application/json", raw = false, quiet = false } = {}) {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "anonbuddy-skin-publish",
  };
  if (body) headers["Content-Type"] = contentType;
  const res = await fetch(url, { method, headers, body: body ? (raw ? body : JSON.stringify(body)) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 400)}`);
  if (!quiet) console.log(`      ${method} ${path.replace(/^https:\/\/api\.github\.com/, "")} -> ${res.status}`);
  return text ? JSON.parse(text) : null;
}

/** git blob 的 sha = sha1("blob " + 字节数 + "\0" + 内容) —— 用来核对推送结果 */
const gitBlobSha = (buf) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

// ---- 0. 待推送文件清单 ----
let files;
if (FILES.length) {
  files = FILES;
} else {
  if (!DIFF_BASE) {
    console.error("要给 --diff-base（本地基线提交，用它算变更文件），或用 --files 显式列文件");
    process.exit(2);
  }
  files = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", DIFF_BASE, "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).split("\n").map((s) => s.trim()).filter(Boolean);
}

if (!files.length) {
  console.error(" 没有文件变更，无事可做");
  process.exit(2);
}
// vendor 的大文件也要推（渲染引擎随包分发）
console.log(`\n===== 发布计划（${APPLY ? "APPLY" : "DRY-RUN"}）=====`);
console.log(`仓库 ${REPO}  分支 ${BRANCH}  父提交 ${BASE_SHA.slice(0, 7)}`);
console.log(`标签 ${TAG ?? "(跳过)"}  提交信息「${MESSAGE}」`);
if (NORMALIZE_EOL) console.log(`行尾：推送前把 CRLF 压成 LF`);
console.log(`\n待推送 ${files.length} 个文件：`);
let totalBytes = 0;
/**
 * 看着像二进制就别碰它的字节。
 *
 * 行尾归一化（--normalize-eol）是对**文本**做的，而它是全局开关 —— 对 GIF / PNG / ZIP
 * 走一遍 `toString("utf8").replace(/\r\n/g,"\n")` 再编码回去，会把文件彻底毁掉：
 * 非法字节变成 U+FFFD、编码后体积还会膨胀。实测把一个 1,411,132 字节的 GIF
 * 推成了 2,465,231 字节的乱码，GitHub 上那张图就再也显示不出来。
 */
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|zip|7z|gz|tgz|exe|dll|so|dylib|pkg|mp4|webm|mov|mp3|ogg|woff2?|ttf|otf|eot|asar|node|wasm)$/i;
const isBinaryPath = (p) => BINARY_EXT.test(p);

const payloads = files.map((path) => {
  const raw = readFileSync(resolve(path));
  const normalize = NORMALIZE_EOL && !isBinaryPath(path);
  const buf = normalize ? Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : raw;
  totalBytes += buf.length;
  return { path: path.split("\\").join("/"), buf, sha: gitBlobSha(buf), normalized: normalize };
});
for (const f of payloads.slice(0, 20)) console.log(`  ${String(f.buf.length).padStart(9)}  ${f.path}`);
if (payloads.length > 20) console.log(`  ... 其余 ${payloads.length - 20} 个`);
console.log(`  合计 ${(totalBytes / 1048576).toFixed(2)} MB`);

if (!APPLY) {
  console.log("\n（dry-run 结束。确认无误后加 --apply）");
  process.exit(0);
}

// ---- 1. 核对父提交与它的 tree ----
step(1, "核对远端父提交");
const baseCommit = await api("GET", `/repos/${REPO}/git/commits/${BASE_SHA}`);
log("父提交", `${baseCommit.sha.slice(0, 7)} ${String(baseCommit.message).split("\n")[0].slice(0, 60)}`);
const baseTree = baseCommit.tree.sha;
log("父 tree", baseTree.slice(0, 7));

const headRef = await api("GET", `/repos/${REPO}/git/ref/heads/${BRANCH}`, null, { quiet: true });
if (headRef.object.sha !== BASE_SHA) {
  console.error(`\n[!] 远端 ${BRANCH} 已经不是 ${BASE_SHA.slice(0, 7)}（现在是 ${headRef.object.sha.slice(0, 7)}）。`);
  console.error("    有人在远端推了新东西 —— 停下来，先把它的内容合并进来再说。");
  process.exit(3);
}
log("远端分支头一致", "OK");

// ---- 2. 建 blob ----
step(2, `创建 ${payloads.length} 个 blob`);
for (const f of payloads) {
  const blob = await api("POST", `/repos/${REPO}/git/blobs`, {
    content: f.buf.toString("base64"),
    encoding: "base64",
  }, { quiet: true });
  if (blob.sha !== f.sha) throw new Error(`blob sha 不一致：${f.path}（远端 ${blob.sha} / 本地 ${f.sha}）`);
  f.blobSha = blob.sha;
}
log("全部 blob 已创建且 sha 匹配", `OK`);

// ---- 3. 建 tree（base_tree 继承其余文件）----
step(3, "创建 tree");
const tree = await api("POST", `/repos/${REPO}/git/trees`, {
  base_tree: baseTree,
  tree: payloads.map((f) => ({ path: f.path, mode: "100644", type: "blob", sha: f.blobSha })),
});
log("新 tree", tree.sha.slice(0, 7));

// ---- 4. 建 commit ----
step(4, "创建 commit");
const commit = await api("POST", `/repos/${REPO}/git/commits`, {
  message: MESSAGE,
  tree: tree.sha,
  parents: [BASE_SHA],
});
log("新提交", commit.sha);
log("提交页", commit.html_url);

// ---- 5. 更新分支（force=false）----
if (!SKIP_PUSH) {
  step(5, `更新 ${BRANCH}`);
  await api("PATCH", `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
  log("分支已更新", `${BASE_SHA.slice(0, 7)} -> ${commit.sha.slice(0, 7)}`);
} else {
  step(5, `跳过更新 ${BRANCH}（--skip-push）`);
}

// ---- 6. 逐文件核对远端内容 ----
step(6, "核对远端文件内容");
let mismatched = 0;
for (const f of payloads) {
  const remote = await api("GET", `/repos/${REPO}/contents/${encodeURIComponent(f.path)}?ref=${BRANCH}`, null, { quiet: true });
  if (remote.sha !== f.sha) {
    mismatched += 1;
    console.error(`      [x] ${f.path} 远端 ${remote.sha.slice(0, 7)} != 本地 ${f.sha.slice(0, 7)}`);
  }
}
log(mismatched ? `有 ${mismatched} 个文件不一致` : `全部 ${payloads.length} 个文件一致`, mismatched ? "" : "OK");
if (mismatched) process.exit(4);

// ---- 7. 打标签 ----
if (TAG && !SKIP_TAG) {
  step(7, `创建标签 ${TAG}`);
  try {
    await api("POST", `/repos/${REPO}/git/refs`, { ref: `refs/tags/${TAG}`, sha: commit.sha });
    log("标签已创建", TAG);
  } catch (error) {
    if (/422/.test(String(error.message))) log("标签已存在，跳过", TAG);
    else throw error;
  }
}

// ---- 8. Release + 附件 ----
if (TAG && !SKIP_RELEASE) {
  step(8, `创建 Release ${TAG}`);
  const notes = NOTES_FILE ? readFileSync(resolve(NOTES_FILE), "utf8") : "";
  if (!notes) console.log("      [!] 没有 --notes-file，说明为空");
  let release = null;
  try {
    // 说明按**字节**发：直接丢字符串时 API 不按 UTF-8 编码，中文会整篇变问号
    const bodyBytes = Buffer.from(
      JSON.stringify({ tag_name: TAG, name: TAG.replace(/^v/, ""), body: notes, draft: false }),
      "utf8",
    );
    release = await api("POST", `/repos/${REPO}/releases`, bodyBytes, {
      contentType: "application/json; charset=utf-8",
      raw: true,
      quiet: true,
    });
    console.log(`      POST /releases -> 200  id=${release.id}`);
  } catch (error) {
    if (/422/.test(String(error.message))) {
      release = await api("GET", `/repos/${REPO}/releases/tags/${TAG}`, null, { quiet: true });
      log("Release 已存在，改用它", `id=${release.id}`);
    } else throw error;
  }
  log("Release", release.html_url);

  for (const assetPath of ASSETS) {
    const file = resolve(assetPath);
    const name = basename(file);
    const buf = readFileSync(file);
    let existing = (release.assets ?? []).find((a) => a.name === name);
    if (existing && REPLACE_ASSETS) {
      await api("DELETE", `/repos/${REPO}/releases/assets/${existing.id}`, null, { quiet: true });
      log("删掉同名旧附件", name);
      existing = null;
    }
    if (existing) {
      throw new Error(`附件 ${name} 已存在（GitHub 不允许覆盖）。加 --replace-assets 先删再传。`);
    }
    const uploaded = await api(
      "POST",
      `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      buf,
      { contentType: "application/zip", raw: true, quiet: true },
    );
    const ok = uploaded.size === statSync(file).size;
    console.log(`      ${ok ? "OK  " : "FAIL"} ${name}  ${uploaded.size} 字节  ${uploaded.browser_download_url}`);
    if (!ok) throw new Error(`附件 ${name} 字节数不一致：上传 ${uploaded.size} / 本地 ${statSync(file).size}`);
  }
}

console.log(`\n===== 完成 =====`);
console.log(`  提交 ${commit.sha}`);
if (TAG) console.log(`  标签 ${TAG}`);
