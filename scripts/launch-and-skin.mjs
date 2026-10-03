#!/usr/bin/env node
// 带调试端口启动 WorkBuddy 并注入皮肤 —— 一条命令搞定
//
// 移植自 scripts/launch-and-skin.ps1。背景：皮肤活在渲染进程里，重启就没了；
// 而双击 WorkBuddy.exe 的默认启动**不带** --remote-debugging-port，注入器没有
// 端点可连，看起来就是"没皮肤"（其实什么都没坏）。这个脚本补上这段：
// 带端口拉起来 → 等渲染进程 → 注入。
//
// 用法：
//   node scripts/launch-and-skin.mjs                 自动识别版本
//   node scripts/launch-and-skin.mjs --prefer cn     两个版本都装着时挑国内版
//   node scripts/launch-and-skin.mjs --port 9334     显式指定端口
//   node scripts/launch-and-skin.mjs --no-watch      不常驻补注入进程
//   node scripts/launch-and-skin.mjs --no-restart    发现裸启动实例时直接报错

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { findNode, findWorkBuddyExe, portForExe, processNameFor } from "../src/platform/workbuddy-path.mjs";
import { resolveStudioPaths } from "../src/constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// autoskin-launch.vbs 会把快捷方式上的参数**原样**转交给这个脚本，而
// setup-autoskin.ps1 早期写进快捷方式的是 PowerShell 风格的单横线名
// （-WorkBuddyExe / -Port）。这里做一层别名归一，让那些已经绑好的图标记即恢复。
// ⚠️ 之前只认双横线：双击国内版图标会直接抛 "无法识别的参数：-WorkBuddyExe" 退出，
//    而 vbs 是用**隐藏窗口**跑这个脚本的（shell.Run cmd, 0, False），
//    报错一个字都传不到用户眼前 —— 症状就是"点了没反应，国内版打不开"。
const ARG_ALIASES = {
  "-WorkBuddyExe": "--exe",
  "-Port": "--port",
  "-Theme": "--theme",
  "-Prefer": "--prefer",
};

function parseArgs(argv) {
  const tokens = argv.map((token) => ARG_ALIASES[token] ?? token);
  const args = { exe: "", prefer: "", port: 0, theme: "last", watch: true, restart: true, timeout: 300, setup: false };
  for (let i = 0; i < tokens.length; i += 1) {
    const a = tokens[i];
    if (a === "--exe") args.exe = tokens[++i] ?? "";
    else if (a === "--prefer") args.prefer = tokens[++i] ?? "";
    else if (a === "--port") args.port = Number(tokens[++i] ?? 0);
    else if (a === "--theme") args.theme = tokens[++i] ?? "last";
    else if (a === "--timeout") args.timeout = Number(tokens[++i] ?? 300);
    else if (a === "--no-watch") args.watch = false;
    else if (a === "--no-restart") args.restart = false;
    else if (a === "--setup") args.setup = true;
    else if (a === "--no-setup") args.setup = false;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`无法识别的参数：${a}`);
  }
  return args;
}

/** 这个进程名在跑吗？WorkBuddy 有进程保护，只能用 tasklist 看名字。 */
function isRunning(procName) {
  try {
    const out = execFileSync("tasklist.exe", ["/FI", `IMAGENAME eq ${procName}.exe`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    return new RegExp(`"${procName}\\.exe"`, "i").test(out);
  } catch {
    // tasklist 失败时保守地当作"在跑"，免得误杀用户正在用的实例
    return true;
  }
}

async function cdpReady(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    const targets = await res.json();
    return targets.some((t) => t.type === "page" && String(t.url).includes("renderer/index.html"));
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp(port, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await cdpReady(port)) return true;
    await sleep(500);
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法: node scripts/launch-and-skin.mjs [选项]

  --prefer cn|intl   两个版本都装时挑一个
  --exe <路径>       直接指定主程序
  --port <端口>      默认按版本推（国内 9334 / 国际 9333）
  --theme <主题名>   默认 last（恢复菜单里最后选的那个）
  --timeout <秒>     等渲染进程的上限，默认 300
  --no-watch         不启动补注入进程
  --no-restart       发现裸启动实例时直接报错，不等用户
  --setup            顺便把桌面图标/开始菜单/开机自启接到静默启动器上（包内 bat 默认带这个）
  --no-setup         不做上面那件事，只注入这一次
  --help             显示本帮助`);
    return;
  }

  // --- 1. 定目标 ----------------------------------------------------------
  const exe = findWorkBuddyExe({ extra: args.exe, prefer: args.prefer });
  if (!exe || !existsSync(exe)) {
    console.error("找不到 WorkBuddy 主程序。用 --exe <路径> 指定，或设 WORKBUDDY_EXE 环境变量。");
    process.exitCode = 1;
    return;
  }
  // --prefer 是**软偏好**：候选列表里没有那一版时会静默退回另一版。
  // 便携版（解压即用、不写注册表）恰好落在自动发现范围之外，于是双击「国内版」的包
  // 会开出来国际版，而屏幕上一句提示都没有 —— 用户只会觉得"这包不对"。
  // 所以命中不了偏好时把话说清楚，并指出真正的解法。
  if (args.prefer) {
    const want = args.prefer === "cn" ? "workbuddy.exe" : "workbuddyai.exe";
    if (basename(exe).toLowerCase() !== want) {
      console.log("");
      console.log(`  ⚠️  你要的是 ${args.prefer === "cn" ? "国内版" : "国际版"}，但自动发现没找到它。`);
      console.log(`      实际会用：${exe}`);
      console.log("      便携版（解压出来直接用、没写过注册表）不在自动发现范围内。");
      console.log('      请改用 --exe "<主程序完整路径>"，或直接双击你平时用的那个图标。');
      console.log("");
    }
  }
  const port = args.port || portForExe(exe);
  const procName = processNameFor(exe);
  console.log(`WorkBuddy : ${exe}`);
  console.log(`Process   : ${procName}.exe`);
  console.log(`CDP port  : ${port}`);

  const node = findNode();
  if (!node) {
    console.error("找不到 node。装一个 Node.js 20+，或先把 WorkBuddy 启动一次让它把自己那份解出来。");
    process.exitCode = 1;
    return;
  }

  // --- 2. 确保它带着端口跑着 ----------------------------------------------
  if (await cdpReady(port)) {
    console.log(`CDP 已经在 ${port} 上 - 直接注入。`);
  } else {
    if (isRunning(procName)) {
      // 我们没法自己结束它：进程带保护，Stop-Process / taskkill /F / CIM Terminate
      // 全部被拒（Access is denied），连 GetOwner 都不给。CloseMainWindow 能用，
      // 但应用把 WM_CLOSE 当"收进托盘"，进程照活。所以只能请用户自己退。
      console.log("");
      console.log(`  ${procName}.exe 正在运行，但没有 --remote-debugging-port=${port}，`);
      console.log("  注入器没有端点可连。");
      console.log("");
      console.log("  请右键托盘图标选「退出」把它关掉。");
      console.log("  （点窗口右上角的 X 只会缩到托盘，不算退出。）");
      console.log("");
      if (!args.restart) {
        console.error("--no-restart 已指定，不再等待。");
        process.exitCode = 1;
        return;
      }
      console.log(`  最多等 ${args.timeout} 秒...`);
      const deadline = Date.now() + args.timeout * 1000;
      while (Date.now() < deadline) {
        if (!isRunning(procName)) break;
        await sleep(800);
      }
      if (isRunning(procName)) {
        console.error(`等了 ${args.timeout} 秒还在跑。什么都没动过 —— 关掉之后再跑一次即可。`);
        process.exitCode = 1;
        return;
      }
      console.log("  已退出，继续。");
    }

    console.log(`启动 ${procName}.exe --remote-debugging-port=${port} ...`);
    // detached：父进程退出（比如从 .bat 里调用）不能把 WorkBuddy 一起带走
    spawn(exe, [`--remote-debugging-port=${port}`], { detached: true, stdio: "ignore" }).unref();

    if (!(await waitForCdp(port, args.timeout))) {
      console.error(`${args.timeout} 秒内没等到渲染进程。应用可能还在启动 —— 稍后重跑 apply 即可。`);
      process.exitCode = 1;
      return;
    }
    console.log("渲染进程就绪。");
  }

  // --- 3. 注入 ------------------------------------------------------------
  const cli = join(ROOT, "src", "cli.mjs");
  console.log(`应用主题 '${args.theme}' ...`);
  execFileSync(node, [cli, "apply", "--port", String(port), "--theme", args.theme], {
    stdio: "inherit",
    cwd: ROOT,
    // 父进程是被 wscript 以隐藏窗口拉起来的，但没有 windowsHide 时 Node 仍可能在
    // 某些宿主下为子进程另开一个控制台 —— 显式关掉，启动路径上不留任何窗口。
    windowsHide: true,
  });
  console.log("完成。去 WorkBuddy 右上角找那颗浮动按钮。");

  // --- 4. 盯着后开的窗口 --------------------------------------------------
  // 5.6.x 起设置是独立 renderer 窗口，在我们注入之后才创建，新窗口是没皮肤的，
  // 设置页里也就看不到换肤入口。
  //
  // 默认走 skin-guard：连 browser 端点做 Target.setAutoAttach，新渲染进程一出生
  // 就被接管 —— 首屏直接带皮肤（不再"先裸奔再换脸"）、没有 2 秒轮询延迟、
  // 不需要反复 spawn 子进程。
  // 找不到它就退回老的轮询版 watch-targets.mjs：两条路径职责完全相同，
  // 只是实现不同，各自的头注释里写了取舍。
  if (args.watch) {
    const guard = join(ROOT, "scripts", "skin-guard.mjs");
    const watcher = join(ROOT, "scripts", "watch-targets.mjs");
    const script = existsSync(guard) ? guard : existsSync(watcher) ? watcher : null;
    if (script) {
      const name = basename(script);
      const runningPid = liveGuardPid(port);
      if (runningPid) {
        console.log(`端口 ${port} 的补注入进程已经在跑了（PID ${runningPid}）。`);
      } else {
        const child = spawn(node, [script, String(port)], { detached: true, stdio: "ignore", windowsHide: true });
        // 记下 pid：下次启动靠它判断"守护已经在跑"，不必再去问系统。
        child.unref();
        writeGuardPid(port, child.pid);
        console.log(
          name === "skin-guard.mjs"
            ? "常驻守护已启动：后开的窗口一出生就带皮肤（无需等待）。"
            : "补注入进程已启动：后开的窗口会自动带上皮肤。",
        );
      }
    }
  }

  // --- 5. 可选：把快捷方式 / 开机自启接到这套流程上 --------------------------
  // 包里的「一键换肤.bat」默认带 --setup，让用户双击一次就拿到完整体验：
  // 以后开机、双击图标都自带皮肤，不必再读文档、再手动跑一条命令。
  // 放在**注入成功之后**做：这一步要改快捷方式和注册表，万一失败或用户中途
  // 取消，皮肤也已经生效，不会白跑一趟。
  if (args.setup) {
    const setupScript = join(ROOT, "scripts", "setup-autoskin.ps1");
    if (!existsSync(setupScript)) {
      console.log("找不到 scripts\\setup-autoskin.ps1，跳过快捷方式绑定。");
    } else {
      console.log("");
      console.log("把桌面图标、开始菜单和开机自启接到这套启动流程上……");
      const bound = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          setupScript,
          "-WorkBuddyExe",
          exe,
          "-Port",
          String(port),
        ],
        { cwd: ROOT, stdio: "inherit", windowsHide: true },
      );
      if (bound.status === 0) {
        console.log("");
        console.log("完成。以后开机、双击图标都是自带皮肤的。");
        console.log("想撤销这些改动：powershell -File scripts\\setup-autoskin.ps1 -Undo");
      } else {
        console.log("");
        console.log(`快捷方式绑定没成功（退出码 ${bound.status}），但皮肤已经生效，这次照常能用。`);
      }
    }
  }

  // --- 6. 自愈开机自启值 ----------------------------------------------------
  // 刻意放在最后：此刻 WorkBuddy 已经启动完成，它对自己 Run 值的那一次重写也已经落地，
  // 所以这次写入能盖住它。详见 ensureAutostart 的注释。
  const repaired = ensureAutostart(exe, port);
  if (repaired > 0) {
    console.log("");
    console.log(`开机自启项已修复 ${repaired} 处 —— WorkBuddy 会把自己的 Run 值改回裸 exe，这里补回静默启动器。`);
  }
}

// ---- 守护进程的 pid 文件 ---------------------------------------------------
// 启动器只需要回答一个问题："这个端口是不是已经有守护在跑了？"
//
// 以前是去问系统：起一个 powershell.exe 跑 Get-CimInstance 列出所有 node 的命令行。
// 那有两个代价，在开机路径上都不能接受：
//   1. 每次启动都拉起一个 PowerShell 进程 —— 用户看得见，也正是"怎么老弹 powershell"的来源；
//   2. 枚举全部 node 进程要几百毫秒，只为拿到一条本可以自己记下来的事实。
//
// 现在：守护启动时把自己的 pid 写进 %LOCALAPPDATA%\AnonBuddySkin\guard-<port>.pid，
// 启动器读文件 + tasklist 验活（tasklist 带 windowsHide，不建窗口）。
// 文件缺失、pid 已死、进程被别人复用 —— 一律当作"没在跑"，最坏结果只是多起一个守护，
// 而多一个守护是幂等的（新文档照样只注入一次）。
function guardPidPath(port) {
  return join(resolveStudioPaths().stateRoot, `guard-${port}.pid`);
}

function writeGuardPid(port, pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    writeFileSync(guardPidPath(port), String(pid), "utf8");
  } catch {
    /* 写不进去不影响本次启动，只是下次会重新起一个守护 */
  }
}

/** 返回仍然活着的守护 pid，没有则返回 0（顺手清掉过期文件） */
function liveGuardPid(port) {
  const file = guardPidPath(port);
  let pid = 0;
  try {
    pid = Number(readFileSync(file, "utf8").trim());
  } catch {
    return 0;
  }
  if (!Number.isInteger(pid) || pid <= 0) return 0;
  try {
    const out = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    if (out.includes(`"${pid}"`)) return pid;
  } catch {
    /* tasklist 失败时按"没在跑"处理：多起一个守护无害，漏起一个才是故障 */
  }
  try {
    rmSync(file, { force: true });
  } catch {
    /* 删不掉就算了，下次照样会走"pid 已死"这条分支 */
  }
  return 0;
}

// ---- 开机自启值的自愈 ------------------------------------------------------
// WorkBuddy 每次启动都会把它**自己**的 Run 值写回裸 exe（不带调试端口）——那是 Electron
// setLoginItemSettings 的标准行为。所以"绑一次、永久有效"不成立。本机实测证据：
// autoskin-setup.json 里记着 Run 值被绑过，而 -Undo 从没跑过（跑了会删掉这个状态文件，
// 文件还在），但今天读回来的两个 Run 值都是裸 exe —— 只能是被应用自己改回去的。
//
// 于是这里在**启动流程末尾**复查一次。这个时机是刻意选的：那一刻 WorkBuddy 早已启动完成，
// 它那次重写也已经落地，所以这一次写入能盖住它。下次开机两个 Run 值都指向静默启动器，
// 谁先执行都无所谓 —— 后执行的那个会发现 CDP 已经就绪，只重新注入一次（全程幂等）。
//
// 只用 reg.exe（带 windowsHide）读写，不起 PowerShell：这是开机路径，多一个进程都算噪声。
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

// 每个产品线一条自己的自启值。名字里必须带版本：国际版与国内版是可以并存的
// （单实例锁、任务栏分组、卸载项 GUID 都不同），共用一个值名只会让后配置的那个
// 覆盖掉前一个 —— 结果就是"配好了一版，另一版开机又变成裸的"。
const ourRunName = (exe) => "AnonBuddySkin." + basename(exe, ".exe");

function regQueryRun() {
  let out = "";
  try {
    out = execFileSync("reg.exe", ["query", RUN_KEY], { encoding: "utf8", timeout: 10000, windowsHide: true });
  } catch {
    return [];
  }
  const rows = [];
  // reg query 的格式是：4 空格 名称 4 空格 类型 4 空格 数据
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(line);
    if (m) rows.push({ name: m[1].trim(), value: m[3] });
  }
  return rows;
}

function regSetRun(name, value) {
  execFileSync("reg.exe", ["add", RUN_KEY, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
}

/** 取一条 Run 值里被启动的那个程序（剥掉引号），取不到返回 "" */
function runValueTarget(value) {
  const quoted = /^\s*"([^"]+)"/.exec(value);
  if (quoted) return quoted[1];
  const bare = /^\s*(\S+)/.exec(value);
  return bare ? bare[1] : "";
}

/**
 * 让开机自启值回到"指向静默启动器"的状态。返回修好的条数。
 * 只动两类值：我们自己那条，以及**确实指向本次要启动的这个 exe** 的值。
 * 用户的其它自启项一概不碰。
 */
function ensureAutostart(exe, port) {
  const vbs = join(ROOT, "scripts", "autoskin-launch.vbs");
  if (!existsSync(vbs)) return 0;
  const wscriptExe = join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
  const want = `"${wscriptExe}" "${vbs}" --exe "${exe}" --port ${port}`;
  const wantKey = exe.toLowerCase();
  const mineName = ourRunName(exe);
  let fixed = 0;

  const rows = regQueryRun();

  const mine = rows.find((row) => row.name === mineName);
  if (!mine || mine.value !== want) {
    try {
      regSetRun(mineName, want);
      fixed += 1;
    } catch {
      /* 注册表写不进去不该让整次启动失败 */
    }
  }

  for (const row of rows) {
    if (row.name === mineName) continue;
    if (/autoskin-launch\.vbs/i.test(row.value)) continue; // 已经绑好了
    if (runValueTarget(row.value).toLowerCase() !== wantKey) continue; // 不是在启动这个 exe
    try {
      regSetRun(row.name, want);
      fixed += 1;
    } catch {
      /* 同上 */
    }
  }

  return fixed;
}

main().catch((error) => {
  console.error(`启动失败：${error.message}`);
  process.exitCode = 1;
});
