// 回归测试公共工具（只装仪器，不做断言）
//
// 目的：把每个测试文件里重复的样板收拢到一处，让单个测试文件只剩下"这个测试到底验什么"。
// 之前 14 个测试各自抄了一份 CDP 连接 + check() + sleep()，共 1612 行；
// 改动一处样板要改 14 个文件，是回归成本的主要来源。
//
// 用法：
//   import { createHarness } from "./_harness.mjs";
//   const t = await createHarness({ name: "test-xxx" });
//   t.check("标题文案已替换", got === want, got);
//   await t.finish();          // 打印小结、设置退出码、关闭连接
//
// 连接的端口优先级：命令行参数 > WORKBUDDY_SKIN_PORT 环境变量 > 9333

import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
import { applySkin, removeSkin } from "../src/injector.mjs";
import { loadTheme } from "../src/theme-schema.mjs";
import { listThemes } from "../src/theme-store.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

export const DEFAULT_PORT = 9333;

// 覆盖全屏的浮层选择器 —— 它们会拦截指针事件，让"点/悬停某行"的断言全部命不中目标。
// 已知来源：设置弹窗（test-settings-panel 会打开它）。测试之间不该互相踩，
// 所以每个测试启动时都兜底清一次，而不是指望"上一个测试收尾关干净了"。
export const BLOCKING_OVERLAYS = [".settings-modal-overlay"];

export const resolvePort = (argv = process.argv) =>
  Number(argv[2] || process.env.WORKBUDDY_SKIN_PORT || DEFAULT_PORT);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 等条件成立（最多 waitMs），而不是死等固定时长。
// 死等固定时长是本项目踩过的真坑：渲染器繁忙时 React 还要多渲染一轮，
// 同一套件连着跑会 FAIL、单独跑却 PASS（实测 5 轮复现）。
export const waitFor = async (fn, { waitMs = 8000, stepMs = 150 } = {}) => {
  const deadline = Date.now() + waitMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(stepMs);
  }
  return last;
};

export const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 建立一次 renderer 连接 + 断言器。所有测试共用。
 * @param {{name?: string, port?: number, connect?: boolean}} [options]
 */
export async function createHarness(options = {}) {
  const { name = "test", port = resolvePort(), connect = true } = options;

  const session = connect
    ? await (async () => {
        const targets = await fetchRendererTargets(port);
        if (!targets.length) {
          throw new Error(
            `端口 ${port} 上没有可用的 renderer。请先启动 WorkBuddy，或用 WORKBUDDY_SKIN_PORT 指定端口。`,
          );
        }
        // 5.6.x 的设置是**独立 renderer 窗口**，URL 同样带 renderer/index.html，
        // 但它没有欢迎页标题 / 侧边栏那套 DOM —— 测试连上它只会全线报 null
        // （2026-09-29 实测：打开设置窗口后 core 套件整片失败，看着像注入坏了）。
        // 注入本身要覆盖所有窗口，但**测试要的是主窗口**，所以这里显式挑一个：
        // 设置窗口的 URL 带 windowAppId=，主窗口不带。挑不出来才退回第一个。
        const main = targets.find((t) => !/[?&]windowAppId=/i.test(t.url)) ?? targets[0];
        const s = new CdpSession(main.webSocketDebuggerUrl);
        await s.open();
        return s;
      })()
    : null;

  // ---- 状态隔离 ---------------------------------------------------------
  // 每个测试都会改主题 / 暂停位 / 自定义主题，一旦中途抛错或提前退出，残留就会把
  // 下一个脚本带挂（实测「单跑全绿、整套乱挂」，restore-last 最明显）。
  // 所以在连接后立刻快照用户状态，退出时（含异常退出）原样写回。
  const SKIN_LS_KEYS = [
    "anonbuddySkinLastTheme",
    "anonbuddySkinWeTheme",
    "anonbuddySkinWePaused",
    "anonbuddySkinAliases",
    "anonbuddySkinBootTheme",
    "anonbuddySkinTunables",
    "anonbuddySkinIconHidden",
    "anonbuddySkinWeSound",
    "anonbuddySkinWeFilter",
    "anonbuddySkinWeVolume",
  ];
  const skinStatePath = join(
    process.env.LOCALAPPDATA ??
      join(process.env.USERPROFILE ?? ".", "AppData", "Local"),
    "AnonBuddySkin",
    "state.json",
  );
  const snapshotLs = session
    ? await session.evaluate(
        `(() => { const o = {}; for (const k of ${JSON.stringify(SKIN_LS_KEYS)}) { const v = localStorage.getItem(k); if (v !== null) o[k] = v; } return o; })()`,
      )
    : null;
  const snapshotState = existsSync(skinStatePath)
    ? readFileSync(skinStatePath, "utf8")
    : null;

  const restoreStateFile = () => {
    try {
      if (snapshotState === null) rmSync(skinStatePath, { force: true });
      else writeFileSync(skinStatePath, snapshotState);
    } catch {
      /* 还原失败不阻断测试结论 */
    }
  };
  // exit 里只能跑同步操作；state.json 是 restoreLast 的唯一来源，必须兜住
  process.once("exit", restoreStateFile);

  const restoreSnapshot = async () => {
    if (!session || !snapshotLs) return;
    try {
      await session.evaluate(
        `(() => { const want = ${JSON.stringify(snapshotLs)}; for (const k of ${JSON.stringify(SKIN_LS_KEYS)}) { const v = want[k]; if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } return true; })()`,
      );
    } catch {
      /* 连接可能已经断了 */
    }
    restoreStateFile();
  };

  let passed = 0;
  let failed = 0;
  const failures = [];

  const check = (label, ok, detail = "") => {
    if (ok) passed += 1;
    else {
      failed += 1;
      failures.push(label);
    }
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
  };

  const note = (label) => console.log(`----  ${label}`);

  // 状态中性：即便测试中途抛错，也保证连接被关掉、把皮肤恢复成"用户原主题"。
  // 默认就还原 —— 之前只有传 restore 才还原，结果 test-pause-restore 这类
  // 会停在"暂停/无皮肤"状态的测试把后面的脚本一起带挂（整套跑 vs 单跑结果不一致）。
  const finish = async ({ restore = true } = {}) => {
    let restoreError = null;
    if (restore !== false) {
      try {
        // 先把 localStorage / state.json 还原成测试前的值，再按它重新装一遍皮肤：
        // 顺序反了的话 applyLast 写回的是测试中途的主题，隔离就白做了。
        await restoreSnapshot();
        await h.applyLast();
      } catch (error) {
        restoreError = error;
      }
    }
    try {
      session?.close?.();
    } catch {
      /* 关闭失败不影响结论 */
    }
    console.log(
      failed === 0
        ? `\nALL PASS  (${name}, ${passed} checks)`
        : `\n${failed} FAILED / ${passed} PASSED  (${name})\n  - ${failures.join("\n  - ")}`,
    );
    if (restoreError) console.error(`收尾还原失败：${restoreError.message}`);
    process.exitCode = failed === 0 && !restoreError ? 0 : 1;
    return failed === 0 && !restoreError;
  };

  const h = {
    name,
    port,
    session,
    evaluate: (expr) => session.evaluate(expr),
    send: (method, params) => session.send(method, params),
    check,
    note,
    sleep,
    waitFor,
    finish,
    /** 轮询直到 renderer 里条件成立；未成立则返回最后一次取值 */
    waitUntil: (expr, opts) => waitFor(() => session.evaluate(expr), opts),

    /** 切到"新建任务"欢迎页（多数标题/皮肤断言的前置状态） */
    async gotoHome({ settleMs = 0 } = {}) {
      await session.evaluate(`(() => {
        [...document.querySelectorAll("[data-view-id=sidebar] button")]
          .find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click();
        return true;
      })()`);
      if (settleMs) await sleep(settleMs);
      return true;
    },

    /** 读取磁盘上的主题清单（内置 + 已安装） */
    async loadMenuThemes() {
      const themes = await listThemes({ roots: [join(SOURCE_ROOT, "themes")] });
      const out = [];
      for (const t of themes) out.push(await loadTheme(t.path));
      return out;
    },

    /**
     * 走正常恢复路径：--theme last（注入脚本自己从 localStorage 取用户主题）。
     * 用户主题通常是 custom-*，不在磁盘 themes/ 里，所以不能用 loadTheme 加载。
     */
    async applyLast({ fallbackId = "aisu" } = {}) {
      const menuThemes = await h.loadMenuThemes();
      const fallback = menuThemes.find((t) => t.manifest.id === fallbackId) ?? menuThemes[0];
      return applySkin({
        loadedTheme: fallback,
        themes: menuThemes,
        port,
        activeId: fallback.manifest.id,
        restoreLast: true,
      });
    },

    /** 卸掉皮肤 */
    removeSkin: () => removeSkin({ port }),

    /**
     * 关掉任何残留的全屏遮罩（主要就是设置弹窗）。
     * 只做"关闭"不做别的 —— 这是测试启动时的卫生动作，不是断言。
     * 先按 Esc，不行再对遮罩本体派发 pointerdown（原生就是这么关的）。
     */
    async clearBlockingOverlays() {
      for (const selector of BLOCKING_OVERLAYS) {
        let open = await session.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        if (!open) continue;
        await session.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
          nativeVirtualKeyCode: 27,
        });
        await session.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
          nativeVirtualKeyCode: 27,
        });
        open = await waitFor(
          () => session.evaluate(`!document.querySelector(${JSON.stringify(selector)})`),
          { waitMs: 2000, stepMs: 120 },
        );
        // Esc 不够（有的弹窗只认真实外部点击）时，降级成直接点遮罩
        if (open !== true) {
          await session.evaluate(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
              el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
            }
            return true;
          })()`);
          await waitFor(
            () => session.evaluate(`!document.querySelector(${JSON.stringify(selector)})`),
            { waitMs: 2000, stepMs: 120 },
          );
        }
      }
      return BLOCKING_OVERLAYS.every((s) => s) &&
        (await session.evaluate(
          `(${JSON.stringify(BLOCKING_OVERLAYS)}).every((s) => !document.querySelector(s))`,
        )) === true;
    },

    /** 记录当前主题 id，供收尾还原时比对 */
    currentThemeId: () =>
      session.evaluate(
        `document.documentElement.dataset.anonbuddySkin ?? null`,
      ),
  };

  // 卫生动作：连接一建立就把残留的全屏遮罩清掉。
  // 这样"跑整套"和"单跑一个测试"的前置状态一致 —— 测试不再依赖执行顺序。
  if (session) {
    try {
      await h.clearBlockingOverlays();
    } catch {
      /* 清理失败不阻断测试，由测试自己的断言去暴露真实问题 */
    }
  }

  return h;
}

/** 原生欢迎页主标题的两种写法（半角/全角逗号），还原时回到其中之一都算正确 */
export const NATIVE_TITLES = ["WorkBuddy, 我帮你", "WorkBuddy，我帮你"];
export const NATIVE_BRAND = "WorkBuddy AI";
export const SKIN_TITLE = "探索未至之境";
export const SKIN_BRAND = "ChihayaAnon AI";

/** 读欢迎页标题/侧边栏应用名/皮肤装载状态 —— 多个测试共用的探针 */
export const probeSkinState = (session) =>
  session.evaluate(`(() => {
    const h1 = document.querySelector(".wb-home-header__title");
    const brand = document.querySelector(".logo-workbuddy-title");
    return {
      titleHTML: h1?.outerHTML?.slice(0, 400) ?? null,
      titleText: h1?.textContent?.trim() ?? null,
      charCount: document.querySelectorAll(".wb-home-header__title span > i").length,
      brandText: brand?.textContent?.trim() ?? null,
      hasStyle: Boolean(document.getElementById("anonbuddy-skin-style")),
      hasMenu: Boolean(document.getElementById("anonbuddy-skin-menu")),
      hasApi: Boolean(window.__anonbuddySkin),
      themeId: document.documentElement.dataset.anonbuddySkin ?? null,
    };
  })()`);

/** 5.9.4 起设置面板是独立 BrowserWindow，主窗口里再没有 .settings-modal-*。
 *  依赖主窗口设置 DOM 的用例在迁到子窗口之前先调用本函数：
 *  返回非空字符串 = 当前环境已换布局、断言位置不对，调用方据此 SKIP（而不是报假 FAIL）。
 *  探测时会顺手触发一次 settings.open()，判为子窗口后把窗口关回去，不留残余。 */
export async function settingsPanelBecameChildWindow(session, port, { waitMs = 5000 } = {}) {
  const inline = () =>
    session.evaluate(`Boolean(document.querySelector(".settings-modal, .settings-modal-overlay"))`).catch(() => false);
  if (await inline()) return ""; // 旧布局：面板就挂在主窗口里
  await session
    .evaluate(`(() => { try { window.__anonbuddySkin?.settings?.open?.(); } catch {} return true; })()`)
    .catch(() => {});
  const deadline = Date.now() + waitMs;
  do {
    if (await inline()) return "";
    let targets = [];
    try {
      targets = await fetchRendererTargets(port);
    } catch {
      targets = [];
    }
    if (targets.some((t) => /[?&](?:windowKind|windowAppId)=/i.test(t.url))) {
      await session
        .evaluate(`(() => { try { window.__anonbuddySkin?.settings?.close?.(); } catch {} return true; })()`)
        .catch(() => {});
      return "设置面板在 5.9.4 已是独立 BrowserWindow，本用例断言仍按主窗口 DOM 写，待迁移到子窗口";
    }
    await new Promise((r) => setTimeout(r, 250));
  } while (Date.now() < deadline);
  return "";
}
