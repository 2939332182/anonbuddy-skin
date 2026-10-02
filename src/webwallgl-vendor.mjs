// WebWallGL vendored 副本的定位（**只解析路径，不读库内容**）。
//
// 库随包分发在 vendor/webwallgl/，文件名带版本号；版本以 .upstream.json 为准，
// 这样升级库时只改一个 JSON，注入器不用跟着改。
//
// 为什么要独立成模块：
//   · injector 需要在注入前拿到一个 **file:// 绝对路径**，而不是把 950KB 塞进 payload；
//   · 测试要能替换这个解析（deps.resolveWebWallGLUrl），不能因此去建真实目录。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VENDOR_REL = ["vendor", "webwallgl"];

/** 读 vendored 副本的元数据；缺失或损坏都返回 null（调用方据此降级为"没有引擎"） */
export function readWebWallGLMeta({ sourceRoot }) {
  const metaPath = join(sourceRoot, ...VENDOR_REL, ".upstream.json");
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8").replace(/^\uFEFF/, ""));
    return meta && typeof meta.file === "string" && meta.file ? meta : null;
  } catch {
    return null;
  }
}

/** vendored 库的绝对路径（不存在返回 null —— 缺库只该少一个能力，不该让换肤失败） */
export function resolveWebWallGLPath({ sourceRoot }) {
  const meta = readWebWallGLMeta({ sourceRoot });
  if (!meta) return null;
  const file = join(sourceRoot, ...VENDOR_REL, meta.file);
  return existsSync(file) ? file : null;
}

/** 注入用的 file:// URL —— 渲染进程是 file:// 页面，按需 <script src> 加载本机副本 */
export function resolveWebWallGLUrl({ sourceRoot }) {
  const file = resolveWebWallGLPath({ sourceRoot });
  return file ? pathToFileURL(file).href : null;
}

export const WEBWALLGL_VENDOR_DIR = VENDOR_REL.join("/");
