// 测试前置：把 WorkBuddy 窗口唤到前台。
//
// 为什么必须做：窗口被别的窗口遮挡或收进托盘时，Chromium 会停止输入分发与
// requestAnimationFrame —— 实测同一个 Input.dispatchMouseEvent mouseMoved 在
// 遮挡时耗 5019ms（超时）、可见时只要 10ms；rAF 被遮挡时零回调，逐字动画与
// sticky 布局断言随之失真。测试套件里过半的"假红"都是这个原因，不是皮肤回归。
//
// 用 WScript.Shell.AppActivate 而不是 SendInput：只切焦点，不动用户的真实鼠标。

import { execFileSync } from "node:child_process";
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const TITLES = ["WorkBuddy AI", "WorkBuddy"];

async function probe(port) {
  try {
    const targets = await fetchRendererTargets(port);
    const main = targets.find((t) => !/[?&](?:windowKind|windowAppId)=/i.test(t.url)) ?? targets[0];
    if (!main) return null;
    const s = new CdpSession(main.webSocketDebuggerUrl);
    await s.open();
    const st = await s.evaluate(`({ vis: document.visibilityState, focus: document.hasFocus() })`);
    s.close();
    return st;
  } catch {
    return null;
  }
}

export async function ensureWindowAwake(port, { tries = 3 } = {}) {
  let st = await probe(port);
  if (st?.vis === "visible" && st?.focus === true) return { ok: true, woke: false, ...st };

  for (let i = 0; i < tries; i += 1) {
    for (const title of TITLES) {
      try {
        // AppActivate 在标题不完全匹配时会返回 False，窗口照样会被激活，所以忽略返回值
        execFileSync(
          "powershell.exe",
          ["-NoProfile", "-Command", `$w = New-Object -ComObject WScript.Shell; $w.AppActivate('${title}')`],
          { stdio: "ignore", timeout: 8000 },
        );
      } catch {
        /* 单次激活失败就换下一个标题 */
      }
    }
    await new Promise((r) => setTimeout(r, 900));
    st = await probe(port);
    if (st?.vis === "visible" && st?.focus === true) return { ok: true, woke: true, ...st };
  }
  return { ok: false, woke: false, ...(st ?? {}) };
}

if (process.argv[1] && process.argv[1].endsWith("ensure-window-awake.mjs")) {
  const port = Number(process.argv[2] || process.env.WORKBUDDY_SKIN_PORT || 9333);
  const r = await ensureWindowAwake(port);
  console.log(JSON.stringify(r));
  process.exitCode = r.ok ? 0 : 1;
}
