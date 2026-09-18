// 静态检查：scripts/*.ps1 的编码与语法体检（不连 renderer）
//
// 为什么必须有：PowerShell 5.1 读无 BOM 的 UTF-8 文件时按 GBK 解析，
// 一旦脚本里混进中文，语法就可能被破坏（本项目踩过）。所以硬性规矩是
// **scripts/*.ps1 必须是纯 ASCII**。改完先跑这个，比手工敲 ParseFile 快。
//
// 用法：node scripts/test-ps1.mjs

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DIR = new URL("../scripts/", import.meta.url);

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};

const files = readdirSync(DIR)
  .filter((f) => f.toLowerCase().endsWith(".ps1"))
  .sort();

check("找到 PowerShell 脚本", files.length > 0, `${files.length} 个：${files.join(", ")}`);

// 用 PowerShell 自身的解析器做语法校验（一次调用校验全部，避免 N 次启动开销）
const parseScript = `
$ErrorActionPreference = 'Stop'
$files = @(${files.map((f) => `'${f}'`).join(",")})
$errs = 0
foreach ($f in $files) {
  $p = Join-Path '${new URL("../scripts/", import.meta.url).pathname.replace(/^\//, "").replace(/\//g, "\\")}' $f
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors -and $errors.Count -gt 0) {
    Write-Output ("SYNTAX " + $f + " :: " + $errors[0].Message)
    $errs++
  } else {
    Write-Output ("OK " + $f)
  }
}
exit $errs
`;

const res = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-NonInteractive", "-Command", parseScript],
  { encoding: "utf8" },
);

if (res.error || res.status === null) {
  console.log("SKIP  无法调用 powershell.exe，跳过语法校验（仍做 ASCII 检查）");
} else {
  const out = (res.stdout || "").trim().split("\n").map((l) => l.trim());
  const syntaxBad = out.filter((l) => l.startsWith("SYNTAX"));
  check(
    "全部 .ps1 通过 ParseFile 语法校验",
    syntaxBad.length === 0,
    syntaxBad.map((l) => l.replace("SYNTAX ", "")).join(" | "),
  );
}

// ASCII 检查：任何非 ASCII 字节都算违规（含中文注释、全角标点、BOM）
for (const f of files) {
  const buf = readFileSync(new URL(f, DIR));
  const nonAscii = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > 0x7f) {
      nonAscii.push({ offset: i, byte: buf[i].toString(16) });
      if (nonAscii.length >= 3) break;
    }
  }
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  check(
    `纯 ASCII：${f}`,
    nonAscii.length === 0 && !hasBom,
    hasBom ? "含 UTF-8 BOM" : nonAscii.length ? `非 ASCII 字节 @${nonAscii.map((n) => n.offset).join(",")}` : "",
  );
}

console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"}  (test-ps1, ${passed} checks)`);
process.exitCode = failed === 0 ? 0 : 1;
