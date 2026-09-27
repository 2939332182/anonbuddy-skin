// 回归测试：换肤插件的图标（自定义图片 / 默认 emoji）
// 用法：node scripts/test-menu-icon.mjs [port]
// 规则：assets/ 下放了 menu-icon.* 或 icon.* 就用图片，否则退回 🎨 emoji。
// 素材要求：正方形、主体居中（按钮是 38×38 圆形，图片按 cover 裁切）。
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

import { createHarness } from "./_harness.mjs";

const t = await createHarness({ name: "test-menu-icon" });
const ASSETS = fileURLToPath(new URL("../assets", import.meta.url));

// 磁盘上有没有素材（和 injector.mjs 的查找规则保持一致）
const SUPPORTED = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];
let iconFile = null;
try {
  const files = await readdir(ASSETS);
  iconFile = files.find((f) => /^(menu-icon|icon)\./i.test(f) && SUPPORTED.includes(f.slice(f.lastIndexOf(".")).toLowerCase())) ?? null;
} catch { /* assets/ 不存在就是没有 */ }
console.log(`素材文件：${iconFile ?? "(无，应走 emoji)"}`);

const { session } = t;

const info = await session.evaluate(`(() => {
  const btn = document.querySelector("#anonbuddy-skin-menu > button");
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const b = btn.getBoundingClientRect();
  return {
    hasImage: cs.backgroundImage.startsWith("url("),
    imageHead: cs.backgroundImage.slice(0, 40),
    text: btn.textContent,
    w: Math.round(b.width), h: Math.round(b.height),
    radius: cs.borderRadius,
    draggable: cs.cursor,
  };
})()`);

if (!info) {
  t.check("图标按钮存在", false, "找不到 #anonbuddy-skin-menu > button");
} else {
  t.check("图标按钮存在且为 38×38 圆形", info.w === 38 && info.h === 38 && info.radius === "50%", `${info.w}×${info.h} ${info.radius}`);
  if (iconFile) {
    t.check(`已放置素材 ${iconFile} → 走图片模式`, info.hasImage, info.imageHead);
    t.check("图片模式下不再渲染 emoji 文字", info.text === "", JSON.stringify(info.text));
  } else {
    t.check("没有素材 → 退回 🎨 emoji", !info.hasImage && info.text === "🎨", `${info.hasImage} ${JSON.stringify(info.text)}`);
  }
  t.check("图标仍可拖动", info.draggable === "grab", info.draggable);
}

await t.finish();
