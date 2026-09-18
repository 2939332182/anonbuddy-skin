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

export const DEFAULT_PORT = 9333;

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
        const s = new CdpSession(targets[0].webSocketDebuggerUrl);
        await s.open();
        return s;
      })()
    : null;

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
  // restore() 是可选回调，由测试自己决定怎么还原（多数场景用 applyLast）。
  const finish = async ({ restore } = {}) => {
    let restoreError = null;
    if (restore) {
      try {
        const entry = Object.assign(Object.create(null), h, { restore });
        await entry.applyLast();
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
    async applyLast({ fallbackId = "miku-488137" } = {}) {
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

    /** 记录当前主题 id，供收尾还原时比对 */
    currentThemeId: () =>
      session.evaluate(
        `document.documentElement.dataset.workbuddySkin ?? null`,
      ),
  };

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
      hasStyle: Boolean(document.getElementById("workbuddy-skin-style")),
      hasMenu: Boolean(document.getElementById("workbuddy-skin-menu")),
      hasApi: Boolean(window.__workbuddySkin),
      themeId: document.documentElement.dataset.workbuddySkin ?? null,
    };
  })()`);
