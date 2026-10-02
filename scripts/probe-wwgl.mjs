// renderer 侧的 WebWallGL 探针：读状态、切场景、等首帧、截图。
//
// 为什么需要它：scene 壁纸的实时渲染**看不见摸不着** —— 静态贴图一直在，
// 渲染失败也静默降级。所以实测必须有一组"能自证"的读数：
// 库有没有加载、实例有没有起来、canvas 有没有真的进图层、帧率是多少。
//
// 用法：
//   node scripts/probe-wwgl.mjs                       # 只读当前状态
//   node scripts/probe-wwgl.mjs --reset               # 顺手把"暂停"状态复位成播放中
//   node scripts/probe-wwgl.mjs --render 2788932765   # 切到某个 scene 并等首帧
//   node scripts/probe-wwgl.mjs --shot outputs/wwgl.png   # 附一张截图（可单独用）
//   node scripts/probe-wwgl.mjs --timeout 90000       # 等首帧的上限（默认 60s）
//   node scripts/probe-wwgl.mjs --port 9334           # 国内版
//
// ⚠️ 跑 --reset 的原因：test-we.mjs 的暂停/恢复两段依赖进入时的 wePaused 初值，
//    继承上一次跑完的残留状态会出现"假通过/假失败"。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { CdpSession, fetchRendererTargets } from "../src/cdp-client.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(value("--port", process.env.WORKBUDDY_SKIN_PORT || "9333"));
const RESET = flag("--reset");
const FRONT = flag("--front");
const RENDER_ID = value("--render");
const SHOT = value("--shot");
const READY_TIMEOUT = Number(value("--timeout", "60000"));

const targets = await fetchRendererTargets(PORT);
if (!targets.length) {
  console.log(`端口 ${PORT} 上没有 renderer target`);
  process.exit(1);
}
// 主窗口优先：5.6.x 的设置是独立 renderer 窗口，URL 带 windowAppId=，那里面没有背景图层
const target = targets.find((t) => !/[?&]windowAppId=/i.test(t.url ?? "")) ?? targets[0];
const session = new CdpSession(target.webSocketDebuggerUrl, { commandTimeoutMs: 300000 });
await session.open();

/** 单点求值包装：异常直接抛，方便定位 */
const evaluate = (expression, options = {}) => session.evaluate(expression, options);

// --front：把窗口提到前台。窗口隐藏时 rAF 不跑 → mount 不 resolve，
// 所以任何"等首帧"的实测都必须先确认页面可见。
if (FRONT) {
  try {
    await session.send("Page.bringToFront", {}, { timeoutMs: 10000 });
    console.log("已请求把窗口提到前台");
  } catch (error) {
    console.log("提到前台失败：" + (error && error.message));
  }
}

const stateExpression = () => `(() => {
  ${RESET ? "try { localStorage.setItem('anonbuddySkinWePaused','0'); window.__anonbuddySkin?.we?.setPaused?.(false); } catch (e) {}" : ""}
  const sk = window.__anonbuddySkin;
  const we = sk && sk.we;
  const pick = (sel) => document.querySelector("#anonbuddy-skin-bg > " + sel);
  const scene = pick("div[data-wb-we-scene]");
  const canvas = scene ? scene.querySelector("canvas") : null;
  return JSON.stringify({
    paused: we ? we.paused() : null,
    storedPaused: localStorage.getItem("anonbuddySkinWePaused"),
    active: we ? we.active() : null,
    toggle: (() => { const b = document.querySelector("button[data-wb-we-toggle]"); return b ? getComputedStyle(b).display : null; })(),
    wwglUrl: we && we.wwglUrl ? we.wwglUrl() : null,
    libLoaded: we && we.wwglLibLoaded ? we.wwglLibLoaded() : null,
    instance: we && we.wwglActive ? we.wwglActive() : null,
    renderId: we && we.wwglId ? we.wwglId() : null,
    generation: we && we.wwglGeneration ? we.wwglGeneration() : null,
    stats: we && we.wwglStats ? we.wwglStats() : null,
    sceneEl: Boolean(scene),
    sceneOpacity: scene ? scene.style.opacity : null,
    canvasSize: canvas ? canvas.width + "x" + canvas.height : null,
    gradientEl: Boolean(pick("div[data-wb-we-gradient]")),
    videoEl: Boolean(pick("video[data-wb-we-video]")),
    layerChildren: (() => { const l = document.getElementById("anonbuddy-skin-bg"); return l ? l.children.length : null; })(),
    canvases: document.querySelectorAll("canvas").length,
    visibility: document.visibilityState,
  });
})()`;

const printState = (label, s) => {
  console.log(`== ${label} ==`);
  console.log(`  active          ${s.active}      paused=${s.paused} stored=${JSON.stringify(s.storedPaused)} toggle=${s.toggle}`);
  console.log(`  libLoaded       ${s.libLoaded}      instance=${s.instance} renderId=${s.renderId} gen=${s.generation}`);
  console.log(`  stats           ${JSON.stringify(s.stats)}`);
  console.log(`  sceneEl         ${s.sceneEl}   opacity=${s.sceneOpacity}   canvas=${s.canvasSize}`);
  console.log(`  gradient/video  ${s.gradientEl} / ${s.videoEl}     图层子节点=${s.layerChildren} 全页 canvas=${s.canvases}`);
  console.log(`  visibility      ${s.visibility}`);
  console.log(`  wwglUrl         ${s.wwglUrl}`);
};

printState("当前状态", JSON.parse(await evaluate(stateExpression())));

if (RENDER_ID) {
  const applied = await evaluate(`(() => { const r = window.__anonbuddySkin?.we?.apply(${JSON.stringify(RENDER_ID)}); return r ?? null; })()`);
  console.log(`\n== 切换 scene ==\n  apply(${RENDER_ID}) -> ${applied}`);
  // 等"目标条目真的就绪"。不能用页面里的 waitReady —— 它只判断"存在实例"，
  // 上一个实例还没释放时会立刻返回 true，读到的就是旧实例（实测踩过）。
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + READY_TIMEOUT;
  let after = null;
  for (;;) {
    after = JSON.parse(await evaluate(stateExpression()));
    if (after.instance === true && after.renderId === RENDER_ID) break;
    if (Date.now() > deadline) break;
    await sleep(400);
  }
  const ready = after.instance === true && after.renderId === RENDER_ID;
  console.log(`  首帧就绪: ${ready}`);
  printState("渲染后", after);
  if (!ready) {
    console.log("\n  ⚠️ 首帧未就绪 —— 常见原因：窗口被隐藏（rAF 不跑，mount 不 resolve）、");
    console.log("     库加载失败、或 pkg 还没解析完。降级链会留在静态贴图上，界面不受影响。");
  }
}

if (SHOT) {
  const shot = await session.send("Page.captureScreenshot", { format: "png" }, { timeoutMs: 60000 });
  mkdirSync(dirname(SHOT), { recursive: true });
  writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
  console.log(`\n截图已存 ${SHOT}`);
}

session.close();
process.exit(0);
