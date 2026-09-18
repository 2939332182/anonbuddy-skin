// WorkBuddy 皮肤 CSS 生成
// 基于实测：WorkBuddy renderer 的 body[data-application-name=workbuddy] 上有完整的
// --cb-* 设计变量系统（60+ 个），override 它们即可全局换色；#root 作背景图层。
// 不使用 CSS module 哈希类名（._grid_xxx），只用稳定锚点。
//
// 样式正文在 ./css/skin.css（真实 .css 文件，可被编辑器高亮/lint），
// 这里只做占位符取值与填充。占位符清单：
//   {{id}}       主题 id（写入首行哨兵注释）
//   {{accent}} {{secondary}} {{surface}} {{text}}   主题色
//   {{hero}}     hero 图 data URL（已 JSON.stringify）
//   {{brand}}    #root::before 的 content（已 JSON.stringify）
//   {{headline}} #root::after  的 content（已 JSON.stringify）

import { fillTemplateFile } from "./css-loader.mjs";

const CSS_FILE = new URL("./css/skin.css", import.meta.url);

const DEFAULT_COLORS = {
  accent: "#24c9d7",
  secondary: "#ef8fd3",
  surface: "#f7fbff",
  text: "#17344f",
};

function color(value, fallback) {
  const result = value ?? fallback;
  if (!/^#[0-9a-f]{3,8}$/i.test(result)) throw new Error(`无效主题颜色：${result}`);
  return result;
}

function copy(value, fallback = "") {
  return JSON.stringify(typeof value === "string" ? value : fallback);
}

export function buildSkinCss({ theme, heroDataUrl }) {
  if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(heroDataUrl)) {
    throw new Error("hero 必须是本地 PNG、JPEG 或 WebP 数据");
  }
  const colors = {
    accent: color(theme.colors?.accent, DEFAULT_COLORS.accent),
    secondary: color(theme.colors?.secondary, DEFAULT_COLORS.secondary),
    surface: color(theme.colors?.surface, DEFAULT_COLORS.surface),
    text: color(theme.colors?.text, DEFAULT_COLORS.text),
  };
  const id = String(theme.id ?? "custom").replace(/[^a-z0-9_-]/gi, "");

  return fillTemplateFile(CSS_FILE, {
    id,
    accent: colors.accent,
    secondary: colors.secondary,
    surface: colors.surface,
    text: colors.text,
    hero: JSON.stringify(heroDataUrl),
    brand: copy(theme.copy?.brand),
    headline: copy(theme.copy?.headline),
  });
}
