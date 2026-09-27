// AnonBuddy Skin - 新窗口注入守护
//
// 为什么需要它：皮肤是注入进渲染进程的，而注入发生在启动那一刻 —— 那一刻
// 只有主窗口存在。此后 WorkBuddy 再开新窗口（最典型的是 5.6.x 的「设置」独立窗口：
// URL 带 windowKind=settings），那是一个全新的 renderer，不在启动时的注入名单里，
// 于是设置页里的换肤入口不会出现。
//
// 这个脚本轮询 CDP 的 /json/list，发现新的 renderer target 就补一次注入。
// 用轮询而不是 browser 级 Target.setDiscoverTargets：两者效果一样，但轮询没有
// 长连接、断线重连、事件解析这些失败面，2 秒一次的开销可以忽略。
//
// 用法:
//   node scripts/watch-targets.mjs 9334
//
// 退出: 收到 SIGINT/SIGTERM，或父进程消失。
// 内存: 一个常驻 Node 进程（约 40 MB）。不需要就在启动器里别开它。

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "src", "cli.mjs");
const PORT = Number(process.argv[2] || 9334);
const INTERVAL_MS = 2000;

/** target 是渲染主页面（含设置独立窗口） */
const isRenderer = (t) =>
  t &&
  t.type === "page" &&
  typeof t.url === "string" &&
  t.url.includes("renderer/index.html");

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`, {
    signal: AbortSignal.timeout(3000),
  });
  const targets = await response.json();
  return Array.isArray(targets) ? targets.filter(isRenderer) : [];
}

let known = new Set();
let priming = true; // 第一轮只登记，不注入（启动器已经注入过了）
let injecting = false;

function inject(reason) {
  if (injecting) return;
  injecting = true;
  console.log(`[watch] ${reason} -> apply on port ${PORT}`);
  const child = spawn(
    process.execPath,
    [CLI, "apply", "--port", String(PORT), "--theme", "last"],
    { cwd: ROOT, stdio: "ignore", windowsHide: true },
  );
  child.on("close", (code) => {
    injecting = false;
    if (code !== 0) console.log(`[watch] apply exited with ${code}`);
  });
}

async function tick() {
  try {
    const targets = await listTargets();
    const fresh = targets.filter((t) => !known.has(t.id));
    for (const t of targets) known.add(t.id);

    if (priming) {
      priming = false;
      console.log(`[watch] port ${PORT} primed with ${targets.length} renderer(s)`);
      return;
    }
    // 关掉的 target 从名单里清掉，避免同一 id 复用时被误判为"已见过"
    const alive = new Set(targets.map((t) => t.id));
    for (const id of [...known]) if (!alive.has(id)) known.delete(id);

    if (fresh.length > 0) inject(`new renderer: ${fresh.map((t) => t.id.slice(0, 8)).join(",")}`);
  } catch {
    // 应用没起来 / 端口关了就静默重试：这是常态，不是错误
  }
}

console.log(`[watch] watching port ${PORT} every ${INTERVAL_MS}ms`);
await tick();
setInterval(tick, INTERVAL_MS);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[watch] ${sig} - exiting`);
    process.exit(0);
  });
}
