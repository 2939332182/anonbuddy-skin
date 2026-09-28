// 皮肤状态的"单一真相"文档 —— 对标 DSH skin-center 的 skin-center-active.json。
//
// 为什么要把"用户选了哪套皮肤"从渲染进程里搬出来：
//   1. 注入器不必先连上渲染进程才知道该用哪套主题 —— 常驻守护在新窗口诞生前
//      就要把脚本文本准备好，那一刻它连一个 target 都还没连上；
//   2. 主题选择从此可以被外部读写、备份、跨版本迁移；
//   3. 读到的永远是完整 JSON（原子写：临时文件 + rename，崩在写一半也读不坏）。
//
// ⚠️ 只写我们自己的目录（%LOCALAPPDATA%\AnonBuddySkin）。绝不碰 WorkBuddy 的
//    数据目录 —— "不改官方文件、不改落盘数据"是这个项目的硬约束，状态文档是
//    我们自己的东西，不算破例。
//
// 写入路径固定为 constants.mjs 里的 statePath（state.json）。那个槽位在引入
// 本文档之前一直空着，直接用它，别再发明第三个文件名。

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { STATE_SCHEMA_VERSION, resolveStudioPaths } from "./constants.mjs";

/** 原子写用的临时目录前缀 —— 落在同一个目录里，rename 才是同文件系统的原子操作。 */
const TMP_PREFIX = "state.json.tmp-";

export function resolveStateFile({ home } = {}) {
  return resolveStudioPaths(home === undefined ? {} : { home }).statePath;
}

/** 读状态文档。文件不存在、JSON 坏了、内容不是对象 —— 一律返回 null（调用方走默认值）。 */
export function readState({ home } = {}) {
  const path = resolveStateFile({ home });
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 半截 JSON（旧版本的非原子写留下的）不该让整个流程挂掉
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

/** 当前生效的皮肤 id。没记录过、值不是字符串、或者被标成原生 —— 都返回 null。 */
export function readActiveId({ home } = {}) {
  const state = readState({ home });
  const active = state?.active;
  if (typeof active !== "string" || active.length === 0) return null;
  return active;
}

/**
 * 原子写状态文档（合并式：只覆盖传入的字段）。
 *
 * 落盘顺序照抄 DSH：先在临时目录里写完整内容（flag:'wx'，避免覆盖已有临时文件），
 * 再 rename 到目标路径。rename 在同一文件系统里是原子的，所以读方要么看到旧的
 * 完整内容、要么看到新的完整内容，不会读到写了一半的 JSON。
 *
 * @returns 写入后的完整状态对象（读方视角）
 */
export function writeState(patch = {}, { home, source = null } = {}) {
  const path = resolveStateFile({ home });
  const dir = dirname(path);
  const current = readState({ home }) ?? {};

  const next = { ...current, ...patch };
  next.schemaVersion = STATE_SCHEMA_VERSION;
  next.updatedAt = new Date().toISOString();
  if (source !== null) next.source = source;

  mkdirSync(dir, { recursive: true });
  const tmpDir = mkdtempSync(join(dir, TMP_PREFIX));
  const tmpFile = join(tmpDir, basename(path));
  try {
    writeFileSync(tmpFile, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(tmpFile, path);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  return next;
}

/**
 * 记一次"当前皮肤"变更。值非法（空串 / 非字符串）时静默忽略 ——
 * 状态文档是旁路信息，不该反过来把换肤流程搞挂。
 */
export function rememberActiveId(id, { home, source = "renderer" } = {}) {
  if (typeof id !== "string" || id.length === 0) return null;
  try {
    return writeState({ active: id, initialized: true }, { home, source });
  } catch {
    return null;
  }
}
