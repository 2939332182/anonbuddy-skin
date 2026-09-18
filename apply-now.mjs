// 等待 WorkBuddy renderer 就绪并注入主题
// 由桌面快捷方式 / bat 调用： <node> "<此文件>" [themeId] [port]
// themeId 默认 "last"：恢复用户上次在 🎨 菜单里选用的主题（含自定义上传的），没选过则用默认主题。
// 想强制指定主题就传具体 id，例如 miku-488137。
//
// 路径全部从脚本自身位置推导（import.meta.url），所以仓库可以放在任意目录、
// 换台电脑 clone 下来也能直接用，不需要改任何文件。
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CLI = join(ROOT, "src", "cli.mjs");
const LOG = join(ROOT, "apply-result.log");

// 端口默认 9333（9223 曾被僵尸 socket 占用，换一个干净的）
const PORT = Number(process.env.WB_CDP_PORT || process.argv[3] || 9333);
const NODE = process.execPath;
const THEME = process.argv[2] || "last";

const stamp = () => new Date().toLocaleString("zh-CN", { hour12: false });

writeFileSync(LOG, `[${stamp()}] === NODE APPLY START (theme=${THEME}) ===\n`);
function log(m) {
  try {
    appendFileSync(LOG, m + "\n");
  } catch {}
  console.log(m);
}

async function waitRenderer(timeoutMs = 90000) {
  const start = Date.now();
  let tries = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      // 必须带超时：端口可能是僵尸 socket（TCP 显示 LISTENING 但永不响应），
      // 不设超时 fetch 会永久挂起，脚本看起来像"卡死"
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, {
        signal: AbortSignal.timeout(3000),
      });
      const list = await res.json();
      if (
        Array.isArray(list) &&
        list.some((t) => t.type === "page" && String(t.url || "").includes("renderer/index.html"))
      ) {
        log(`[${stamp()}] renderer 已就绪（第 ${tries} 次探测）`);
        return true;
      }
    } catch {
      // 还没起来，继续等
    }
    tries++;
    await new Promise((r) => setTimeout(r, 1500));
  }
  log(`[${stamp()}] 错误：等待 renderer 超时（${timeoutMs / 1000}s）`);
  return false;
}

const ok = await waitRenderer();
if (ok) {
  log(`[${stamp()}] 开始注入：${THEME}`);
  const res = spawnSync(NODE, [CLI, "apply", "--port", String(PORT), "--theme", THEME], {
    encoding: "utf8",
    cwd: ROOT,
    windowsHide: true,
  });
  log("--- apply stdout ---");
  log(res.stdout || "(空)");
  if (res.stderr) {
    log("--- apply stderr ---");
    log(res.stderr);
  }
  const st = spawnSync(NODE, [CLI, "status", "--port", String(PORT)], {
    encoding: "utf8",
    cwd: ROOT,
    windowsHide: true,
  });
  log("--- status ---");
  log((st.stdout || "") + (st.stderr || ""));
} else {
  log("跳过注入：WorkBuddy 未以调试模式启动。");
}

log(`[${stamp()}] === END ===`);
