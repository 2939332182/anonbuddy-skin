#!/usr/bin/env node
// 常驻皮肤守护的入口 —— 启动后一直活着，盯着每一个新出生的渲染进程。
//
// 用法:
//   node scripts/skin-guard.mjs 9333                用上次选的主题
//   node scripts/skin-guard.mjs 9333 --theme aisu   强制某个主题
//
// 与 scripts/watch-targets.mjs 的关系：那个是轮询版，保留着当回退路径
// （--no-guard 时启动器仍然会拉它）。两者的职责相同，实现不同：
//   watch-targets：每 2s 拉 /json/list → 发现新 target → spawn 一个 cli apply 子进程
//   skin-guard   ：连 browser 端点 → Target.setAutoAttach → 新 target 出生即暂停
//                  → 在文档创建前装脚本 → 放行
// 后者没有轮询延迟、不需要子进程、而且能赶在首屏之前。
//
// 退出: 收到 SIGINT/SIGTERM，或应用关掉之后连续重连失败达到上限。

import { appendFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { defaults, prepareApply } from "../src/cli.mjs";
import { DEFAULT_CDP_PORT, resolveStudioPaths } from "../src/constants.mjs";
import { buildInjectionPayload } from "../src/injector.mjs";
import { SkinGuard } from "../src/skin-guard.mjs";

// 守护是被启动器 detached 拉起来的（stdio: "ignore"），stdout 直接进黑洞 ——
// 出问题时没有任何现场可看。所以自己落一份日志：前台跑时照样打印，
// 后台跑时至少能在 %LOCALAPPDATA%\AnonBuddySkin\guard.log 里翻。
// 超过 1MB 就从头写，避免无限增长（这是个滚动日志，不是审计日志）。
const LOG_PATH = resolveStudioPaths().logPath;
const LOG_MAX_BYTES = 1024 * 1024;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(`[guard] ${message}\n`);
  try {
    let size = 0;
    try {
      size = statSync(LOG_PATH).size;
    } catch {
      /* 文件还不存在就是 0 */
    }
    if (size > LOG_MAX_BYTES) writeFileSync(LOG_PATH, "");
    appendFileSync(LOG_PATH, line);
  } catch {
    /* 日志写不进去不该拖垮守护本身 */
  }
}

function parseArgs(argv) {
  const args = { port: DEFAULT_CDP_PORT, theme: "last" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--theme") {
      args.theme = argv[index + 1] ?? "last";
      index += 1;
      continue;
    }
    if (token.startsWith("--")) throw new Error(`无法识别的参数：${token}`);
    const port = Number(token);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`端口必须是 1024 到 65535 的整数，收到：${token}`);
    }
    args.port = port;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deps = defaults({});
  const prepared = await prepareApply({
    roots: [deps.bundledThemesRoot, deps.userThemesRoot],
    deps,
    requested: args.theme,
  });
  const payload = await buildInjectionPayload({
    ...prepared,
    warmWeCache: true,
    deps,
  });

  const guard = new SkinGuard({ port: args.port, expression: payload.expression, log });
  await guard.start();
  log(`守护已就绪：端口 ${args.port}，主题 ${payload.themeId}，脚本 ${payload.expression.length} 字符`);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      log(`收到 ${signal}，退出`);
      guard.stop();
      process.exit(0);
    });
  }

  // 应用关掉之后 guard 该自己走 —— SkinGuard 内部连不上就累加失败次数并退出，
  // 但它没有"退出进程"的职责，这里轮询它的状态。
  const idle = setInterval(() => {
    if (guard.stopped) {
      clearInterval(idle);
      log("守护已停止");
      process.exit(0);
    }
  }, 5000);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`AnonBuddy Skin：守护启动失败 —— ${error.message}\n`);
    process.exitCode = 1;
  });
}
