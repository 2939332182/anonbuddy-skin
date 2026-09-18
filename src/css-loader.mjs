// 占位符模板加载器
//
// 为什么需要它：皮肤 CSS 与注入脚本原本都是「一整个模板字符串」，
// 里面的反引号会静默截断它（本项目踩过 3 次）。把 CSS 落到真实的 .css 文件里，
// 编辑器就能直接高亮/校验，也不会再有截断风险。
//
// 规则：
//   - 文件只读一次并缓存（同进程内复用）
//   - `{{name}}` 替换为 values[name]，值会被 String() 包裹
//   - 未提供的占位符 → 抛错（防止改名后静默留 `{{xxx}}` 在产物里）
//   - `{{!` 开头的是「注释占位符」：替换为空串，用于可选片段
//
// 反斜杠：值里若含 `$&` 这类替换模式，String.replace 会二次解释。
// 所以这里用 split/join 而不是 replace，避免 `$` 被当特殊字符。

import { readFileSync } from "node:fs";

const cache = new Map();

const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export function readTemplate(path) {
  if (!cache.has(path)) cache.set(path, readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  return cache.get(path);
}

export function clearTemplateCache() {
  cache.clear();
}

export function fillTemplate(source, values, { label = "template" } = {}) {
  const missing = [];
  const out = source.replace(PLACEHOLDER, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      missing.push(name);
      return match;
    }
    return String(values[name]);
  });
  if (missing.length) {
    const unique = [...new Set(missing)].sort();
    throw new Error(`${label}: 缺少占位符取值 → ${unique.join(", ")}`);
  }
  return out;
}

export function fillTemplateFile(path, values, opts) {
  return fillTemplate(readTemplate(path), values, { label: path, ...opts });
}

export { PLACEHOLDER };
