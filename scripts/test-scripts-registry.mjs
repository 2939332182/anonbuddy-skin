// 静态检查：项目结构卫生（不连 renderer）
//
// 这个检查是给"长期迭代 + 发到 GitHub 给别人用"兜底的。它守住几条容易随迭代腐化的规矩：
//   1. 每个 scripts/*.mjs 都能被 node 解析（没有语法错、没有从绝对路径 import）
//   2. 生成器不再依赖"一整个模板字符串"（CSS 已外置到 src/css/skin.css）
//   3. 不出现硬编码的本机绝对路径（换电脑 / 别人 clone 后直接能跑）
//   4. package.json 的 scripts 指向真实存在的文件
//   5. 测试文件都走公共 harness（不再各自抄一份 check/CDP 样板）
//
// 用法：node scripts/test-scripts-registry.mjs

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};

const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ---- 1. scripts/*.mjs 全部语法正确 ----
const scriptFiles = readdirSync(join(ROOT, "scripts"))
  .filter((f) => f.endsWith(".mjs"))
  .sort();

const syntaxBad = [];
for (const f of scriptFiles) {
  try {
    execFileSync(process.execPath, ["--check", join(ROOT, "scripts", f)], { stdio: "pipe" });
  } catch (e) {
    syntaxBad.push(`${f}: ${String(e.stderr || e.message).split("\n")[0]}`);
  }
}
check("scripts/*.mjs 全部语法正确", syntaxBad.length === 0, syntaxBad.join(" | "), );
console.log(`          (共检查 ${scriptFiles.length} 个脚本)`);

// ---- 2. 项目源码不再有硬编码本机路径 ----
// 这是"换台电脑能不能直接跑"的红线：别人 clone 之后不该需要改任何文件。
const SOURCES = [
  "src/injector.mjs", "src/cli.mjs", "src/cdp-client.mjs", "src/theme-store.mjs",
  "src/theme-schema.mjs", "src/skin-css.mjs", "src/skin-menu.mjs", "src/css-loader.mjs",
  "src/asar-path.mjs", "src/constants.mjs",
  "scripts/run-tests.mjs", "scripts/_harness.mjs", "scripts/asar-find.mjs", "scripts/sel-of.mjs",
  "apply-now.mjs",
];
const HARDCODED = /["'`](?:[A-Za-z]:[\\/]{1,2}(?:Users|workbuudy|workbuddy|Program Files)[^"'`]*|\/(?:Users|home)\/[A-Za-z0-9._-]+\/[^"'`]*)["'`]|=\s*["']\/[a-z]\/[^"']*["']/g;
const pathViolations = [];
for (const rel of SOURCES) {
  if (!existsSync(join(ROOT, rel))) continue;
  const src = read(rel);
  const lines = src.split("\n");
  const hits = [...new Set([...src.matchAll(HARDCODED)].map((m) => m[0].replace(/^["'`=]|["'`]$/g, "").trim()))];
  // 只算"真正拿来做路径"的：注释、帮助文案、报错提示里出现示例路径是正常的
  const codeHits = hits.filter((h) => {
    const line = lines.find((l) => l.includes(h)) ?? "";
    if (/^\s*(\/\/|\*|#)/.test(line)) return false; // 注释
    // 出现在 help/提示文本里（同一行有"例如"/"如："/"example" 或属于拼接的提示数组）
    if (/(例如|如：|比如|example|PowerShell:|bash:)/i.test(line)) return false;
    return true;
  });
  if (codeHits.length) pathViolations.push(`${rel}: ${codeHits.join(", ")}`);
}
check("源码内无硬编码本机绝对路径", pathViolations.length === 0, pathViolations.join(" | "));

// ---- 2b. PowerShell 脚本必须纯 ASCII 且能解析 ----
{
  const psFiles = readdirSync(join(ROOT, "scripts")).filter((f) => f.toLowerCase().endsWith(".ps1"));
  const dirty = [];
  for (const f of psFiles) {
    const buf = readFileSync(join(ROOT, "scripts", f));
    let nonAscii = 0;
    for (const b of buf) if (b > 0x7f) nonAscii++;
    if (nonAscii) dirty.push(`${f}(${nonAscii} bytes)`);
  }
  check(".ps1 全部纯 ASCII", dirty.length === 0, dirty.join(", "));
  console.log(`          (PowerShell 脚本共 ${psFiles.length} 个)`);
}

// ---- 3. CSS 已从模板字符串外置 ----
{
  const cssMod = read("src/skin-css.mjs");
  const hasRealFile = existsSync(join(ROOT, "src/css/skin.css"));
  const cssFileSize = hasRealFile ? statSync(join(ROOT, "src/css/skin.css")).size : 0;
  check("src/css/skin.css 已外置且非空", hasRealFile && cssFileSize > 10000, `${cssFileSize} bytes`);
  check("skin-css.mjs 不再内联整段 CSS", !/return\s+`[\s\S]{5000,}/.test(cssMod));
  check("skin-css.mjs 通过 fillTemplateFile 读取", cssMod.includes("fillTemplateFile"));
  // 模板字符串里的大块 CSS 是历史包袱：一行超过 2000 字符基本就是它
  const longLines = cssMod.split("\n").filter((l) => l.length > 2000);
  check("skin-css.mjs 无超长内联行", longLines.length === 0, `最长行 ${Math.max(...cssMod.split("\n").map((l) => l.length))} 字符`);
}

// ---- 4. package.json 的 scripts 指向真实文件 ----
{
  const pkg = JSON.parse(read("package.json"));
  const scripts = pkg.scripts ?? {};
  const broken = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    // 抓 "node scripts/xxx.mjs" / "node src/xxx.mjs" 这类路径
    for (const m of cmd.matchAll(/node\s+([\w./-]+\.mjs)/g)) {
      const target = m[1];
      if (!existsSync(join(ROOT, target))) broken.push(`${name} -> ${target}`);
    }
  }
  check("package.json scripts 目标文件都存在", broken.length === 0, broken.join(" | "));
  check("package.json 有 test 脚本", Boolean(scripts.test));
  check("package.json 声明了 type:module", pkg.type === "module");
}

// ---- 5. 测试文件统一走 harness（减少样板，降低回归成本）----
{
  const testFiles = scriptFiles.filter((f) => f.startsWith("test-") && f !== "test-css-parse.mjs" && f !== "test-ps1.mjs" && f !== "test-scripts-registry.mjs");
  const withoutHarness = [];
  const inlineCheck = [];
  for (const f of testFiles) {
    const src = read(join("scripts", f));
    if (!src.includes("_harness.mjs")) withoutHarness.push(f);
    if (/const check = \(label/.test(src)) inlineCheck.push(f);
  }
  check("e2e 测试均引用公共 harness", withoutHarness.length === 0, withoutHarness.join(", "));
  check("e2e 测试不再各自定义 check()", inlineCheck.length === 0, inlineCheck.join(", "));
  console.log(`          (e2e 测试共 ${testFiles.length} 个)`);
}

// ---- 6. 没有临时/垃圾文件混在 scripts/ ----
{
  const junk = scriptFiles.filter((f) => f.startsWith("_") && !["_harness.mjs"].includes(f));
  check("scripts/ 无遗留临时文件", junk.length === 0, junk.join(", "));
}

console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"}  (test-scripts-registry, ${passed} checks)`);
process.exitCode = failed === 0 ? 0 : 1;
