import { homedir } from "node:os";
import { join } from "node:path";

export const PRODUCT_ID = "anonbuddy-skin";
export const PRODUCT_NAME = "AnonBuddy Skin";
export const STATE_SCHEMA_VERSION = 1;
export const THEME_SCHEMA_VERSION = 1;
export const DEFAULT_THEME_ID = "aisu";
export const DEFAULT_CDP_PORT = 9333;
export const EXPECTED_BUNDLE_ID = "com.workbuddy.workbuddy";

// WorkBuddy renderer target 的 URL 特征：app.asar/renderer/index.html
export const RENDERER_URL_HINT = "renderer/index.html";

// 常驻守护（skin-guard.mjs）用 Runtime.addBinding 挂到页面上的上报函数名。
// 渲染进程里切换皮肤时调用它，守护收到就把选择回写状态文档（state.json）。
// 这个名字同时出现在三处：constants（单一来源）、payload（注入脚本按名字取）、
// 守护的 addBinding 调用 —— 改就一起改。
export const REPORT_BINDING = "__anonbuddySkinReport";

export function resolveStudioPaths({ home = homedir() } = {}) {
  const isWin = process.platform === "win32";
  const installRoot = join(home, ".workbuddy", PRODUCT_ID);
  const stateRoot = isWin
    ? join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "AnonBuddySkin")
    : join(home, "Library", "Application Support", "AnonBuddySkin");

  return {
    installRoot,
    stateRoot,
    statePath: join(stateRoot, "state.json"),
    logPath: join(stateRoot, "injector.log"),
    userThemesRoot: join(stateRoot, "themes"),
  };
}
