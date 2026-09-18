// 统一测试入口
//
// 存在的意义：让"每次改动该跑哪些测试"有明确答案（change → suite 映射），
// 而不是每次改动都把 14 个 e2e 全跑一遍（e2e 要连真实 renderer，是最贵的一层）。
//
// 用法：
//   node scripts/run-tests.mjs                 # 跑默认套件（静态检查 + 核心 e2e）
//   node scripts/run-tests.mjs --suite static  # 只跑不连 renderer 的静态/单元检查
//   node scripts/run-tests.mjs --suite core    # 核心 e2e（改动注入脚本/CSS 时）
//   node scripts/run-tests.mjs --suite all     # 全部 e2e
//   node scripts/run-tests.mjs --list          # 看有哪些套件与用例
//   node scripts/run-tests.mjs --only test-rename.mjs
//   WORKBUDDY_SKIN_PORT=9333 node scripts/run-tests.mjs --suite all
//
// 关键约定：**e2e 依赖真实渲染器**，没有 WorkBuddy 在跑时会整段跳过（不算失败），
// 静态套件永远可以跑。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRendererTargets } from "../src/cdp-client.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = (name) => join(ROOT, "scripts", name);
const PORT = Number(process.env.WORKBUDDY_SKIN_PORT || 9333);

/**
 * 套件定义 —— 这就是"改动 → 该跑什么"的映射表。
 * 每个用例带 `why`，写清什么改动会触发它，让后续维护者不用猜。
 */
const SUITES = {
  static: {
    desc: "不连 renderer 的静态检查，永远可跑，秒级",
    cases: [
      { file: "lint-menu.mjs", why: "改了 src/skin-menu.mjs 或 src/css/skin.css 后必跑" },
      { file: "test-ps1.mjs", why: "改了 scripts/*.ps1 后必跑（ASCII 校验）" },
      { file: "test-css-parse.mjs", why: "改了 CSS 后（选择器/花括号/占位符）" },
      { file: "test-scripts-registry.mjs", why: "新增或删除了脚本/主题后" },
    ],
  },
  core: {
    desc: "核心 e2e：注入/还原/幂等/标题/图标。改注入脚本或 CSS 时跑这一组",
    needsRenderer: true,
    cases: [
      { file: "test-title-copy.mjs", why: "改了 BRAND_TEXT/HERO_TITLE_TEXT/标题样式/拆字逻辑" },
      { file: "test-roll-anim.mjs", why: "改了逐字动画参数（--wb-type-step/--wb-type-life）" },
      { file: "test-pause-restore.mjs", why: "改了 restore()/dispose()/removeSkin()" },
      { file: "test-reapply-idempotent.mjs", why: "改了 applySkin() 或注入脚本的收尾逻辑" },
      { file: "test-restore-last.mjs", why: "改了 --theme last / localStorage 主题决策链" },
    ],
  },
  ui: {
    desc: "布局与视觉 e2e：改 CSS 布局规则时跑这一组",
    needsRenderer: true,
    cases: [
      { file: "test-home-skin.mjs", why: "改了欢迎页/首页背景与玻璃规则" },
      { file: "test-window-layout.mjs", why: "改了 #root 偏移、窗口非最大化布局" },
      { file: "test-overlay-opacity.mjs", why: "改了浮层/portal 实底相关规则" },
      { file: "test-tab-active.mjs", why: "改了左侧导航选中态上色" },
      { file: "test-hover.mjs", why: "改了悬停态规则" },
      { file: "test-settings-panel.mjs", why: "改了设置面板集成 / 悬浮图标开关 / 面板皮肤列表" },
      { file: "test-theme-switch-perf.mjs", why: "改了 applyMode / 深浅色类切换 / 设置界面配色与对比度" },
    ],
  },
  menu: {
    desc: "主题菜单 e2e：改菜单交互时跑这一组",
    needsRenderer: true,
    cases: [
      { file: "test-custom-themes.mjs", why: "改了自定义主题存储/迁移" },
      { file: "test-rename.mjs", why: "改了右键重命名" },
      { file: "test-menu-icon.mjs", why: "改了图标读取与渲染" },
      { file: "test-drag.mjs", why: "改了图标拖动/贴边锚点" },
    ],
  },
};

// all = core + ui + menu（去重）
SUITES.all = {
  desc: "全部 e2e（慢；发版前或大改后跑）",
  needsRenderer: true,
  cases: [...SUITES.core.cases, ...SUITES.ui.cases, ...SUITES.menu.cases],
};

const DEFAULT_SUITES = ["static", "core"];

const parseArgs = (argv) => {
  const out = { suites: [], only: null, list: false, keepGoing: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--suite") out.suites.push(argv[++i]);
    else if (a.startsWith("--suite=")) out.suites.push(a.slice(8));
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--fail-fast") out.keepGoing = false;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`用法: node scripts/run-tests.mjs [选项]

  --suite <名>   指定套件（可多次）：${Object.keys(SUITES).join(", ")}
                 不指定时跑：${DEFAULT_SUITES.join(" + ")}
  --only <文件>  只跑某个脚本（matches 文件名子串）
  --list         列出套件与用例
  --fail-fast    首个失败即停
  --help         显示本帮助

环境变量: WORKBUDDY_SKIN_PORT   CDP 端口（默认 9333）`);
  process.exit(0);
}

if (args.list) {
  for (const [name, suite] of Object.entries(SUITES)) {
    console.log(`\n[${name}] ${suite.desc}${suite.needsRenderer ? "  (需要 WorkBuddy 在运行)" : ""}`);
    for (const c of suite.cases) {
      const exists = existsSync(SCRIPT(c.file));
      console.log(`   ${exists ? " " : "!"} ${c.file.padEnd(32)} ${c.why}`);
    }
  }
  console.log("\n! 标记的文件尚不存在\n");
  process.exit(0);
}

const selected = args.suites.length ? args.suites : DEFAULT_SUITES;
const unknown = selected.filter((s) => !SUITES[s]);
if (unknown.length) {
  console.error(`未知套件：${unknown.join("、")}。可用：${Object.keys(SUITES).join("、")}`);
  process.exit(2);
}

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT(file)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WORKBUDDY_SKIN_PORT: String(PORT) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

// 先探一次渲染器，避免每个 e2e 各自超时等连接
let rendererUp = false;
if (selected.some((s) => SUITES[s].needsRenderer) && !args.only) {
  try {
    const targets = await fetchRendererTargets(PORT);
    rendererUp = targets.length > 0;
  } catch {
    rendererUp = false;
  }
  if (!rendererUp) {
    console.log(`注意：端口 ${PORT} 上没有 renderer，需要渲染器的套件将跳过。`);
    console.log("      启动 WorkBuddy 后重跑，或设 WORKBUDDY_SKIN_PORT 指定端口。\n");
  }
}

const summary = [];

for (const suiteName of selected) {
  const suite = SUITES[suiteName];
  console.log(`\n${"=".repeat(60)}\n套件 [${suiteName}] ${suite.desc}\n${"=".repeat(60)}`);

  if (suite.needsRenderer && !rendererUp && !args.only) {
    for (const c of suite.cases) summary.push({ suite: suiteName, file: c.file, status: "SKIP" });
    console.log("  跳过（无渲染器）");
    continue;
  }

  for (const c of suite.cases) {
    if (args.only && !c.file.includes(args.only)) continue;
    if (!existsSync(SCRIPT(c.file))) {
      summary.push({ suite: suiteName, file: c.file, status: "MISSING" });
      console.log(`\n--- ${c.file}  [缺失]`);
      continue;
    }
    console.log(`\n--- ${c.file}`);
    const { code, stdout, stderr } = await run(c.file);
    const lines = stdout.trimEnd().split("\n");
    // 只回显非 PASS 行，避免刷屏；PASS 汇总到小结
    const interesting = lines.filter((l) => !l.startsWith("PASS"));
    const passCount = lines.filter((l) => l.startsWith("PASS")).length;
    for (const l of interesting) console.log("   " + l);
    if (stderr.trim()) console.log("   [stderr] " + stderr.trim().split("\n").join("\n   "));
    if (passCount) console.log(`   (${passCount} 项 PASS 已折叠)`);

    let status = "FAIL";
    if (code === 0) status = "PASS";
    else if (code === 2) status = "ERROR";
    summary.push({ suite: suiteName, file: c.file, status, code });

    if (code !== 0 && !args.keepGoing) break;
  }
  if (!args.keepGoing && summary.some((s) => s.status === "FAIL" || s.status === "ERROR")) break;
}

console.log(`\n${"=".repeat(60)}\n汇总（端口 ${PORT}）\n${"=".repeat(60)}`);
const width = Math.max(...summary.map((s) => s.file.length), 10);
for (const s of summary) {
  const mark = { PASS: "PASS", FAIL: "FAIL", SKIP: "SKIP", MISSING: "MISS", ERROR: "ERR " }[s.status] ?? s.status;
  console.log(`  ${mark}  ${s.file.padEnd(width)}  [${s.suite}]`);
}
const counts = summary.reduce((acc, s) => ((acc[s.status] = (acc[s.status] ?? 0) + 1), acc), {});
console.log(
  "\n" +
    Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join("  "),
);

const bad = (counts.FAIL ?? 0) + (counts.ERROR ?? 0) + (counts.MISSING ?? 0);
process.exit(bad ? 1 : 0);
