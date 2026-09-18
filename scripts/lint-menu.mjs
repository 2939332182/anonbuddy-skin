// 校验两个"字符串生成器"的产物：
//   1. buildSkinMenuScript 生成的那一大坨注入脚本（仍是模板字符串）
//   2. src/css/skin.css 渲染出来的整份皮肤 CSS（正文已是真实 .css 文件）
// 注入脚本编辑器管不到，改完务必先跑这个再注入。
// 用法：node scripts/lint-menu.mjs
import { readFileSync } from "node:fs";
import { buildSkinCss } from "../src/skin-css.mjs";
import { buildSkinMenuScript } from "../src/skin-menu.mjs";

const CSS_SRC = new URL("../src/css/skin.css", import.meta.url);
const cssSource = readFileSync(CSS_SRC, "utf8").replace(/^\uFEFF/, "");

// ---------- 真实 .css 文件自身的体检（在插值之前） ----------
// 这一步的价值：把问题拦在源文件里，报错行号直接对应 skin.css，不用去猜产物。
const fatal = [];

// 1) 花括号配平：CSS 文件里 `${` 这类 JS 语法残留、或少一个 }，在这里就能抓到
{
  const stripped = cssSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  let depth = 0;
  let firstUnbalancedLine = 0;
  const lines = stripped.split("\n");
  lines.forEach((line, i) => {
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth < 0 && !firstUnbalancedLine) firstUnbalancedLine = i + 1;
      }
    }
  });
  if (depth !== 0) {
    fatal.push(`skin.css 花括号不配平（净差 ${depth > 0 ? "+" : ""}${depth}）`);
  }
  if (firstUnbalancedLine) {
    fatal.push(`skin.css 第 ${firstUnbalancedLine} 行出现多余的 }`);
  }
}

// 2) 残留的 JS 模板插值：正文里不该再出现 ${...}，那说明有片段没搬干净
{
  const leftover = [...cssSource.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
  if (leftover.length) {
    fatal.push(`skin.css 残留 JS 插值：${[...new Set(leftover)].slice(0, 5).join(" ")}`);
  }
}

// 3) 只允许清单内的占位符出现，防止改名后静默留 {{xxx}} 在产物里
const ALLOWED_PLACEHOLDERS = new Set([
  "id",
  "accent",
  "secondary",
  "surface",
  "text",
  "hero",
  "brand",
  "headline",
]);
{
  const used = [...cssSource.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]);
  const unknown = [...new Set(used)].filter((n) => !ALLOWED_PLACEHOLDERS.has(n));
  if (unknown.length) {
    fatal.push(`skin.css 出现未登记的占位符：${unknown.join("、")}（请在 css-loader/ buildSkinCss 里补取值）`);
  }
  const unused = [...ALLOWED_PLACEHOLDERS].filter((n) => !used.includes(n));
  if (unused.length) {
    fatal.push(`buildSkinCss 声明了占位符但 skin.css 未使用：${unused.join("、")}`);
  }
}

if (fatal.length) {
  console.error("皮肤 CSS 源文件校验失败（src/css/skin.css）：");
  for (const msg of fatal) console.error(`  - ${msg}`);
  process.exit(1);
}

const code = buildSkinMenuScript({
  entries: [
    { id: "miku-488137", name: "Miku 488137", accent: "#39c5bb", surface: "#f7fbff", css: "/*a*/" },
    { id: "genshin-night", name: "原神 · 星夜", accent: "#7b6bd6", surface: "#12121a", css: "/*b*/" },
  ],
  activeId: "miku-488137",
  styleId: "workbuddy-skin-style",
  menuId: "workbuddy-skin-menu",
  cssTemplate: "/*tpl*/",
});

try {
  // new Function 只解析不执行，正好当语法检查用
  new Function(code);
} catch (error) {
  console.error(`菜单脚本语法错误：${error.message}`);
  console.error("提示：整个菜单脚本是一个模板字符串，有两类写法会把它弄坏 ——");
  console.error("  1) 注释里出现反引号 / ${...}：模板会提前截断，这是最常见的翻车方式；");
  console.error("  2) 正则里的反斜杠：模板字面量会吃掉一层（\\s → s、\\( → (），");
  console.error("     所以模板内的正则要写成双反斜杠（\\\\.  \\\\( ），或用 [0-9] 这类字符类绕开。");
  process.exit(1);
}

// 皮肤 CSS 产物校验（正文来自 src/css/skin.css，经占位符填充）
const css = buildSkinCss({
  theme: {
    id: "lint",
    name: "lint",
    colors: { accent: "#39c5bb", secondary: "#88ddcc", surface: "#f7fbff", text: "#20303a" },
    copy: { brand: "Lint Brand", headline: "Lint Headline" },
  },
  heroDataUrl: "data:image/webp;base64,AAAA",
});
if (!css.includes("WORKBUDDY_SKIN:lint")) {
  console.error("皮肤 CSS 生成异常：缺少 WORKBUDDY_SKIN 标记");
  process.exit(1);
}
// 产物里不该再有占位符残留
{
  const leftover = [...new Set([...css.matchAll(/\{\{[a-zA-Z0-9_]+\}\}/g)].map((m) => m[0]))];
  if (leftover.length) {
    console.error(`皮肤 CSS 产物残留占位符（buildSkinCss 漏传取值）：${leftover.join("、")}`);
    process.exit(1);
  }
}
// 花括号配平（粗略）：正文写坏时最常见的表现就是括号数不对
const opens = (css.match(/\{/g) ?? []).length;
const closes = (css.match(/\}/g) ?? []).length;
if (opens !== closes) {
  console.error(`皮肤 CSS 花括号不配平：{ ×${opens} vs } ×${closes}`);
  process.exit(1);
}
// 取值确实被填进去了（占位符机制接错时会退化成空值，这里兜底）
for (const [label, needle] of [
  ["主题色 --wb-accent", "--wb-accent: #39c5bb"],
  ["brand 文案", 'content: "Lint Brand"'],
  ["headline 文案", 'content: "Lint Headline"'],
  ["hero 背景图", 'url("data:image/webp;base64,AAAA")'],
]) {
  if (!css.includes(needle)) {
    console.error(`皮肤 CSS 缺少填充结果：${label}（期望包含 ${needle}）`);
    process.exit(1);
  }
}

// 顺手确认关键能力都在，避免重构时误删
const required = [
  ["右键菜单", "contextmenu"],
  ["重命名", "beginRename"],
  ["删除自定义主题", "deleteCustomTheme"],
  ["多主题存储", "customListKey"],
  ["旧数据迁移", "workbuddyCustomTheme"],
  ["文案替换", "applyCopy"],
  ["逐字拆分", "splitTitle"],
  ["渐变跨字对齐", "alignCharGradient"],
  ["文案观察器", "MutationObserver"],
  // 幂等收尾：apply 会反复 eval 整段脚本，必须先把旧实例停掉，
  // 否则旧观察器/定时器会继续拆标题（pause 之后又"长"回来）
  ["旧实例收尾", "dispose"],
  ["停机标志位", "stopped"],
];
const missing = required.filter(([, needle]) => !code.includes(needle)).map(([label]) => label);
if (missing.length) {
  console.error(`缺少预期实现：${missing.join("、")}`);
  process.exit(1);
}

// 皮肤 CSS 的关键规则也要在（这些是踩过坑才加的，删掉会静默回归）
const requiredCss = [
  ["欢迎页主标题", ".wb-home-header__title"],
  ["逐字打字动画", "workbuddy-skin-char-type-in"],
  ["逐字延迟（按序号递增）", "--wb-char-index"],
  ["标题字距", "letter-spacing"],
  ["标题描边", "-webkit-text-stroke"],
  ["标题主题色渐变", "-webkit-background-clip"],
  ["#root 顶栏偏移", "margin-top"],
];
const missingCss = requiredCss.filter(([, needle]) => !css.includes(needle)).map(([label]) => label);
if (missingCss.length) {
  console.error(`皮肤 CSS 缺少预期规则：${missingCss.join("、")}`);
  process.exit(1);
}

// 字号必须保持原样：整份 CSS 里不允许出现对标题 font-size 的声明
const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, "");
if (/\.wb-home-header__title[^{]*\{[^}]*font-size/.test(cssNoComment)) {
  console.error("皮肤 CSS 给 .wb-home-header__title 声明了 font-size —— 需求要求字号保持原样，请移除。");
  process.exit(1);
}

console.log(`OK  menu ${code.length} chars / css ${css.length} chars`);
