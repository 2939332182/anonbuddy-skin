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

import { appendFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defaults, prepareApply } from "../src/cli.mjs";
import { DEFAULT_CDP_PORT, readProductInfo, resolveStudioPaths } from "../src/constants.mjs";
import { buildInjectionPayload } from "../src/injector.mjs";
import { SkinGuard } from "../src/skin-guard.mjs";
import { detectEdition, installedVersion, runSelfUpdate } from "../src/self-update.mjs";

// 守护是被启动器 detached 拉起来的（stdio: "ignore"），stdout 直接进黑洞 ——
// 出问题时没有任何现场可看。所以自己落一份日志：前台跑时照样打印，
// 后台跑时至少能在 %LOCALAPPDATA%\AnonBuddySkin\guard.log 里翻。
// 超过 1MB 就从头写，避免无限增长（这是个滚动日志，不是审计日志）。
const STUDIO_PATHS = resolveStudioPaths();
const LOG_PATH = STUDIO_PATHS.logPath;
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

  // 把自己的 pid 记到一个按端口命名的文件里。启动器读它就能回答
  // "这个端口的守护已经在跑了吗"，不必再起一个 PowerShell 去枚举进程
  // —— 那是开机路径上唯一的多余动作，也是用户看得见的那个 powershell。
  // 读法见 scripts/launch-and-skin.mjs 的 liveGuardPid()。
  const pidPath = join(STUDIO_PATHS.stateRoot, `guard-${args.port}.pid`);
  try {
    writeFileSync(pidPath, String(process.pid), "utf8");
  } catch {
    /* 记不下来不影响守护本身，最坏是启动器下次多起一个（幂等） */
  }
  const clearPid = () => {
    try {
      rmSync(pidPath, { force: true });
    } catch {
      /* 忽略：残留的 pid 文件会被启动器按"pid 已死"清掉 */
    }
  };
  process.on("exit", clearPid);

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
    cdpPort: args.port,
  });

  const guard = new SkinGuard({ port: args.port, expression: payload.expression, log });
  await guard.start();
  log(`守护已就绪：端口 ${args.port}，主题 ${payload.themeId}，脚本 ${payload.expression.length} 字符`);

  // ---- 一键更新的本机端点 ----
  // 设置面板跑在渲染进程里，是个 file:// 页面，写不了文件系统；更新这件事只能由
  // 这个常驻 Node 进程来做，面板点一下按钮打过来。
  // 端口取 CDP 端口 + 1000（9333→10333 / 9334→10334）：渲染进程读不了文件，
  // 只能靠一个**可预测的固定端口**找到我们。
  // ⚠️ 只绑 127.0.0.1 —— 这个端点能覆盖磁盘上的插件文件，绝不能对外暴露。
  const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
  const updatePort = args.port + 1000;
  const product = readProductInfo();
  const repoSlug = product.repo.replace(/^https:\/\/github\.com\//i, "");

  const sendJson = (res, status, body) => {
    const bytes = Buffer.from(JSON.stringify(body), "utf8");
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length });
    res.end(bytes);
  };

  const updateServer = createServer(async (req, res) => {
    // 渲染进程的 Origin 是 "null"（file:// 页面），不放行就过不来
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let pathname = "/";
    try {
      pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    } catch {
      /* 畸形 URL 当作根路径处理 */
    }
    try {
      if (pathname === "/status") {
        sendJson(res, 200, {
          ok: true,
          version: installedVersion(ROOT_DIR),
          edition: detectEdition(ROOT_DIR),
          root: ROOT_DIR,
          cdpPort: args.port,
        });
        return;
      }
      if (pathname === "/update") {
        const force = /[?&]force=1/.test(req.url || "");
        log(`收到一键更新请求（force=${force}）`);
        const result = await runSelfUpdate({
          root: ROOT_DIR,
          repo: repoSlug,
          edition: detectEdition(ROOT_DIR),
          force,
          apply: true,
          log: (message) => log(`[update] ${message}`),
        });
        log(`一键更新结束：${JSON.stringify(result)}`);
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }
      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      log(`更新端点出错：${message}`);
      sendJson(res, 500, { ok: false, error: message });
    }
  });
  updateServer.on("error", (error) => log(`更新端点没起来：${error.message}`));
  updateServer.listen(updatePort, "127.0.0.1", () => {
    log(`更新端点就绪：http://127.0.0.1:${updatePort}（版本 ${installedVersion(ROOT_DIR) || "?"}）`);
  });

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
