import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCT_ID = "anonbuddy-skin";
export const PRODUCT_NAME = "AnonBuddy Skin";
export const STATE_SCHEMA_VERSION = 1;
export const THEME_SCHEMA_VERSION = 1;
export const DEFAULT_THEME_ID = "aisu";
export const DEFAULT_CDP_PORT = 9333;
export const EXPECTED_BUNDLE_ID = "com.workbuddy.workbuddy";

// 项目主页。设置面板底部的链接与「检查更新」的兜底来源都用它。
export const REPO_URL = "https://github.com/2939332182/anonbuddy-skin";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 版本号与仓库地址 —— 设置面板底部「关于」要用（检查更新 + 项目链接）。
 *
 * 直接读 package.json，而不是在别处再抄一份常量：发布时只改 package.json 一处，
 * 就不会出现"包是 1.0.6，面板里却显示 1.0.5"这种对不上的情况。
 * 读不到就退回占位值 —— 面板少一行信息可以接受，不该让整次注入失败。
 */
export function readProductInfo() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    const raw = String(pkg.repository?.url ?? pkg.homepage ?? REPO_URL);
    const repo = raw
      .replace(/^git\+/, "")
      .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "https://github.com/")
      .replace(/\.git$/, "")
      .replace(/#.*$/, "");
    return { version: String(pkg.version ?? "0.0.0"), repo };
  } catch {
    return { version: "0.0.0", repo: REPO_URL };
  }
}

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
