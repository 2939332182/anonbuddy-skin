#!/usr/bin/env node
// 打印 WorkBuddy 装在哪、Node 在哪 —— 排查"启动器找不到应用"用
//
// 移植自 scripts/find-workbuddy.ps1。这里列出**试过的每一个候选**和命中的那一个，
// 因为最常见的困惑就是"我明明装了它却说找不到"，只报一个最终结果没法排查。
//
// 用法：
//   node scripts/find-workbuddy.mjs
//   node scripts/find-workbuddy.mjs --json   # 给脚本/AI 取结构化结果

import { existsSync } from "node:fs";

import { findNode, findWorkBuddyExe, portForExe, processNameFor, workbuddyCandidates } from "../src/platform/workbuddy-path.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const preferAt = args.indexOf("--prefer");
const prefer = preferAt >= 0 ? args[preferAt + 1] : "";

const candidates = workbuddyCandidates({});
const hits = candidates.filter((p) => existsSync(p));
const exe = findWorkBuddyExe({ prefer });
const node = findNode();

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ exe, node, port: exe ? portForExe(exe) : null, process: exe ? processNameFor(exe) : null, hits, tried: candidates.length }, null, 2)}\n`,
  );
  process.exitCode = exe ? 0 : 1;
} else {
  console.log("=== AnonBuddy Skin 探测 ===");
  console.log(`WorkBuddy.exe: ${exe ?? "(未找到)"}`);
  console.log(`node:          ${node ?? "(未找到)"}`);
  console.log("");
  console.log(`试过 ${candidates.length} 个候选路径，其中真实存在的 ${hits.length} 个：`);
  for (const p of candidates) console.log(`  [${existsSync(p) ? "x" : " "}] ${p}`);
  if (hits.length > 1) {
    console.log("");
    console.log("注意：有多个候选真实存在，上面列出的第一个会被采用。");
  }
  if (!exe) {
    console.log("");
    console.log("没找到 WorkBuddy。可以这样指定：");
    console.log("  1. 设环境变量（只影响新开的终端）：");
    console.log('     [Environment]::SetEnvironmentVariable("WORKBUDDY_EXE", "D:\\路径\\WorkBuddyAI.exe", "User")');
    console.log("  2. 或者直接传给启动脚本：");
    console.log('     node scripts/launch-and-skin.mjs --exe "D:\\路径\\WorkBuddyAI.exe"');
  }
  if (!node) {
    console.log("");
    console.log("没找到 node。装个 Node.js 20+，或先把 WorkBuddy 正常启动一次让它把自己那份解出来。");
  }
  process.exitCode = exe ? 0 : 1;
}
