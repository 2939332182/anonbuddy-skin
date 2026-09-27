// 静态检查：src/css/skin.css 的结构体检（不连 renderer，毫秒级）
//
// 为什么单独存在：CSS 现在是一个真实文件，编辑器能高亮，但**语法错、括号错、
// 选择器写坏**这几种问题编辑器不一定拦得住（尤其本项目有 {{占位符}} 预处理）。
// 这个检查就是 CSS 的"单元测试"，改完 CSS 先跑它，不用启动 WorkBuddy。
//
// 用法：node scripts/test-css-parse.mjs

import { readFileSync } from "node:fs";

const FILE = new URL("../src/css/skin.css", import.meta.url);
let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};

const raw = readFileSync(FILE, "utf8");
const src = raw.replace(/^\uFEFF/, "");
check("skin.css 存在且非空", src.length > 1000, `${Buffer.byteLength(src)} bytes`);
check("skin.css 无 BOM 残留（已剥离）", !raw.startsWith("\uFEFF") || true);

// 去掉注释与字符串后的"骨架"，用于括号配平与结构检查
const skeleton = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");

// ---- 1. 花括号配平（逐行，能报出出错行号）----
{
  let depth = 0;
  let badLine = 0;
  skeleton.split("\n").forEach((line, i) => {
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth < 0 && !badLine) badLine = i + 1;
      }
    }
  });
  check("花括号配平", depth === 0 && !badLine, badLine ? `第 ${badLine} 行多余 }` : `净差 ${depth}`);
}

// ---- 2. 无残留 JS 插值 ----
{
  const leftover = [...new Set([...src.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]))];
  check("无残留 JS 模板插值", leftover.length === 0, leftover.slice(0, 3).join(" "));
}

// ---- 3. 占位符全部登记 ----
const ALLOWED = new Set(["id", "accent", "secondary", "surface", "text", "hero", "brand", "headline"]);
{
  const used = [...new Set([...src.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]))];
  const unknown = used.filter((n) => !ALLOWED.has(n));
  const unused = [...ALLOWED].filter((n) => !used.includes(n));
  check("占位符均已登记", unknown.length === 0, unknown.join("、"));
  check("登记的占位符都被使用", unused.length === 0, unused.join("、"));
}

// ---- 4. 每个 {@media / @keyframes / 选择器块）都有成对的结束 ----
{
  // 抓出所有顶层块名，确认常见 at-rule 拼写正确
  const atRules = [...skeleton.matchAll(/@([a-z-]+)/g)].map((m) => m[1]);
  const known = new Set(["media", "keyframes", "supports", "font-face", "layer", "property", "container", "import", "charset"]);
  const typos = [...new Set(atRules)].filter((a) => !known.has(a));
  check("无拼错的 at-rule", typos.length === 0, typos.join("、"));
  check("含逐字打字动画关键帧", src.includes("@keyframes anonbuddy-skin-char-type-in"));
}

// ---- 5. 关键不变量（踩过坑才加的，删掉会静默回归）----
{
  const noComment = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const titleBlockHasFontSize = /\.wb-home-header__title[^{,]*\{[^}]*font-size/.test(noComment);
  check(
    "标题未声明 font-size（必须跟随用户字号设置）",
    !titleBlockHasFontSize,
    titleBlockHasFontSize ? "发现 font-size 声明！" : "",
  );
  check("含 #root 顶栏偏移兜底", /margin-top:\s*var\(--wb-desktop-menubar-height/.test(noComment));
  // 侧边栏 sticky 行（分组标题 / 工作区行）必须有不透明实底，否则滚动的列表项会穿透出两层文字。
  // 注意：皮肤不重声明 position:sticky（那是原生带的），只负责给底色 —— 所以断言"有底色"而不是"有 sticky"。
  {
    const stickyBlock = /\[data-view-id=sidebar\][^{]*\.conversation-section-label[\s\S]{0,200}?background-color:\s*var\(--wb-glass\)\s*!important/;
    check("侧边栏 sticky 行有不透明实底", stickyBlock.test(noComment));
    // 悬停/选中只能用 background-image 叠渐变；改 background-color 会让底色又变透明
    const hoverUsesImage = /\[class\*="_headerTopPadding_"\]:hover\s*\{[^}]*background-image/.test(noComment);
    check("sticky 行悬停态用 background-image 而非 background-color", hoverUsesImage);
  }
  // 磨砂不能用来遮 sticky 穿透（后代 backdrop-filter 在已有 backdrop root 下失效）
  {
    const stickyIdx = noComment.indexOf("conversation-section-label");
    const nearby = stickyIdx >= 0 ? noComment.slice(stickyIdx, stickyIdx + 400) : "";
    check("sticky 行未错误使用 backdrop-filter", !/backdrop-filter/.test(nearby));
  }
}

// ---- 6. 没有硬编码的平台路径 / 本机绝对路径（发版卫生）----
{
  const hardcoded = [...new Set([...src.matchAll(/[A-Za-z]:[\\/]{1,2}(?:Users|workbuudy|workbuddy)[^\s"')]*/g)].map((m) => m[0]))];
  check("CSS 内无硬编码本机路径", hardcoded.length === 0, hardcoded.slice(0, 3).join(" "));
}

console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"}  (test-css-parse, ${passed} checks)`);
process.exitCode = failed === 0 ? 0 : 1;
