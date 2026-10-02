// 设置窗口（独立 renderer）专项探针。
//
// 为什么单独测：5.6.x 起设置是**独立窗口**（URL 带 windowKind / windowAppId），
// 而主窗口与它共享同一份注入脚本。已知的历史坑是"壁纸层按 inset:0 铺满整窗，
// 把窗口顶部 62px 的原生安全区也铺上 → 设置面板上方露出一条壁纸条"。
// 所以这一项要验的是：**子窗口里不该有背景媒体层**，同时配色与面板集成照常生效。
//
// 用法：
//   node scripts/probe-settings-window.mjs --port 9334 --open        # 自己打开设置窗口再查
//   node scripts/probe-settings-window.mjs --port 9334               # 查已开着的设置窗口
//   node scripts/probe-settings-window.mjs --port 9334 --open --close
//
// ⚠️ 设置窗口要**守护（skin-guard）在跑**才会被注入 —— 它是新生的渲染进程，
//    一次性注入（cli apply）覆盖不到它。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { CdpSession, fetchRendererTargets } from "../src/cdp-client.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(name);

const PORT = Number(value("--port", process.env.WORKBUDDY_SKIN_PORT || "9333"));
const OPEN = flag("--open");
const CLOSE = flag("--close");
const WAIT_MS = Number(value("--wait", "25000"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 设置窗口的 URL 特征（两种命名都见过） */
const isChildWindow = (url) => /[?&](?:windowKind|windowAppId)=/i.test(url ?? "");
const isMainWindow = (url) => /renderer\/index\.html/.test(url ?? "") && !isChildWindow(url);

const listTargets = async () => {
  try {
    return await fetchRendererTargets(PORT);
  } catch {
    return [];
  }
};

const before = await listTargets();
if (!before.length) {
  console.log(`端口 ${PORT} 上没有 renderer target`);
  process.exit(1);
}
console.log(`端口 ${PORT}：当前 ${before.length} 个 renderer target`);
for (const t of before) console.log(`  ${isChildWindow(t.url) ? "[子窗口]" : "[主窗口]"} ${String(t.url).slice(0, 120)}`);

if (OPEN) {
  const main = before.find((t) => isMainWindow(t.url)) ?? before[0];
  const session = new CdpSession(main.webSocketDebuggerUrl, { commandTimeoutMs: 60000 });
  await session.open();
  const opened = await session.evaluate("(() => { try { return window.__anonbuddySkin?.settings?.open?.() ?? null; } catch (e) { return 'ERR:' + e.message; } })()");
  console.log(`\n请求打开设置面板 -> ${opened}`);
  session.close();

  const deadline = Date.now() + WAIT_MS;
  let after = before;
  while (Date.now() < deadline) {
    await sleep(1000);
    after = await listTargets();
    if (after.some((t) => isChildWindow(t.url))) break;
  }
  const child = after.find((t) => isChildWindow(t.url));
  if (!child) {
    console.log(`\n[!] 等 ${WAIT_MS}ms 没等到独立设置窗口。当前 target：`);
    for (const t of after) console.log(`  ${isChildWindow(t.url) ? "[子窗口]" : "[主窗口]"} ${String(t.url).slice(0, 120)}`);
    console.log("    （settings.open() 打开的是插件面板；若这一版把设置做成主窗口内弹层，就不会有新 target。）");
  }
}

const targets = await listTargets();
const child = targets.find((t) => isChildWindow(t.url));
if (!child) {
  console.log("\n[!] 没有独立设置窗口可查。");
  process.exit(4);
}

const session = new CdpSession(child.webSocketDebuggerUrl, { commandTimeoutMs: 60000 });
await session.open();
const state = JSON.parse(await session.evaluate(`JSON.stringify({
  search: location.search,
  size: innerWidth + "x" + innerHeight,
  dataSkin: document.documentElement.dataset.anonbuddySkin ?? null,
  appName: document.body ? document.body.getAttribute("data-application-name") : null,
  childFlag: document.body ? document.body.getAttribute("data-wb-child-window") : null,
  hasStyleEl: Boolean(document.getElementById("anonbuddy-skin-style")),
  hasMenuRoot: Boolean(document.getElementById("anonbuddy-skin-menu")),
  hasBgLayer: Boolean(document.getElementById("anonbuddy-skin-bg")),
  sceneEls: document.querySelectorAll("div[data-wb-we-scene]").length,
  gradientEls: document.querySelectorAll("div[data-wb-we-gradient]").length,
  videos: document.querySelectorAll("video").length,
  canvases: document.querySelectorAll("canvas").length,
  webwallglLayers: document.querySelectorAll("[data-webwallgl]").length,
  panelEntry: Boolean(document.getElementById("anonbuddy-skin-menu-settings-entry")),
  panelPane: Boolean(document.getElementById("anonbuddy-skin-plugin-pane")),
  bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : null,
  surfaceVar: getComputedStyle(document.documentElement).getPropertyValue("--cb-bg-primary").trim() || null,
  bodyBgImage: document.body ? getComputedStyle(document.body).backgroundImage.slice(0, 60) : null,
  nativeSettingsRoot: Boolean(document.querySelector(".settings-modal-overlay, .settings-modal--window, .settings-modal")),
})`));

const checks = [];
const check = (label, ok, detail) => {
  checks.push(Boolean(ok));
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  -> " + detail}`);
};

console.log(`\n===== 设置窗口专项（端口 ${PORT}）=====`);
console.log(`  url=${state.search}  尺寸=${state.size}`);
console.log(`  原生设置根容器存在=${state.nativeSettingsRoot}  body 底色=${state.bodyBg}`);
check("子窗口里**没有**背景媒体层（不铺壁纸，避免 62px 安全区露条）", state.hasBgLayer === false, String(state.hasBgLayer));
check("子窗口里没有 scene 渲染容器", state.sceneEls === 0, String(state.sceneEls));
check("子窗口里没有渐变兜底层", state.gradientEls === 0, String(state.gradientEls));
check("子窗口里没有视频壁纸层", state.videos === 0, String(state.videos));
check("子窗口里没有 WebGL 渲染层", state.webwallglLayers === 0, String(state.webwallglLayers));
check("皮肤样式已注入（配色覆盖生效）", state.hasStyleEl === true, String(state.hasStyleEl));
check("子窗口标记已打上（我们的 CSS 靠它认窗口）", state.childFlag === "1", String(state.childFlag));
// 悬浮球在子窗口里**是故意注入的**（用户可以在设置窗口里直接换肤）；
// 只有背景媒体层才要禁掉 —— 这两件事在 09 分片里是分开判断的。
check("悬浮菜单根在子窗口也注入（可在此换肤）", state.hasMenuRoot === true, String(state.hasMenuRoot));
check("插件设置条目已注入导航", state.panelEntry === true, String(state.panelEntry));

if (CLOSE) {
  const main = (await listTargets()).find((t) => isMainWindow(t.url));
  if (main) {
    const s2 = new CdpSession(main.webSocketDebuggerUrl, { commandTimeoutMs: 60000 });
    await s2.open();
    const closed = await s2.evaluate("(() => { try { return window.__anonbuddySkin?.settings?.close?.() ?? null; } catch (e) { return 'ERR:' + e.message; } })()");
    console.log(`\n请求关闭设置面板 -> ${closed}`);
    s2.close();
  }
}

const SHOT = value("--shot");
if (SHOT) {
  const r = await session.send("Page.captureScreenshot", { format: "png" }, { timeoutMs: 60000 });
  mkdirSync(dirname(SHOT), { recursive: true });
  writeFileSync(SHOT, Buffer.from(r.data, "base64"));
  console.log(`\n设置窗口截图已存 ${SHOT}`);
}

session.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n  汇总：PASS=${checks.length - failed}  FAIL=${failed}  共 ${checks.length} 项`);
process.exit(failed ? 1 : 0);
