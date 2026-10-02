// 国际版 / 国内版两套环境通用的 scene 实时渲染实测（把"B/C 清单"固化成可重放的一次运行）。
//
// 为什么不是 test-*.mjs：它依赖本机的 Wallpaper Engine 库、显卡、以及窗口可见性
// （窗口隐藏时 rAF 不跑，mount 不 resolve）。这种测试放进 e2e 套件只会制造不稳定信号，
// 所以它是一件**手动跑的取证工具**，逐项打印 PASS/FAIL 与原始读数，并把截图落到 outputs/。
//
// 用法：
//   node scripts/verify-wwgl.mjs                       # 全流程，端口 9333，收尾自动还原
//   node scripts/verify-wwgl.mjs --port 9334           # 国内版
//   node scripts/verify-wwgl.mjs --shot-dir outputs/wwgl-intl
//   node scripts/verify-wwgl.mjs --no-restore          # 保留结束时选中的壁纸
//   node scripts/verify-wwgl.mjs --timeout 120000      # 单次等首帧上限（默认 90s）
//   node scripts/verify-wwgl.mjs --large-limit 200     # 第二步用多大的包（默认 ≤60MB）
//
// 覆盖清单：出画 → 切换（旧实例是否真销毁）→ 暂停/恢复 → 音量 → 离开主题 → 反复 apply 幂等。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CdpSession, fetchRendererTargets } from "../src/cdp-client.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(name);

const PORT = Number(value("--port", process.env.WORKBUDDY_SKIN_PORT || "9333"));
const SHOT_DIR = value("--shot-dir", "outputs/wwgl-" + PORT);
const READY_TIMEOUT = Number(value("--timeout", "90000"));
const RESTORE = !flag("--no-restore");
// 上限保护：第一轮先用小包跑通链路，大包单独一步（要看清"值不值得解"这条预判是否合理）
const LARGE_LIMIT_MB = Number(value("--large-limit", "60"));

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  -> " + detail}`);
};

const targets = await fetchRendererTargets(PORT);
if (!targets.length) {
  console.log(`端口 ${PORT} 上没有 renderer target`);
  process.exit(1);
}
// 主窗口：设置窗口是独立 renderer（URL 带 windowAppId=），它没有背景图层可测
const target = targets.find((t) => !/[?&]windowAppId=/i.test(t.url ?? "")) ?? targets[0];
// commandTimeoutMs 要给足：单次等首帧最长按 READY_TIMEOUT 走
const session = new CdpSession(target.webSocketDebuggerUrl, { commandTimeoutMs: 300000 });
await session.open();

const evaluate = (expression, options = {}) => session.evaluate(expression, options);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = async () => JSON.parse(await evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  const we = sk && sk.we;
  const pick = (sel) => document.querySelector("#anonbuddy-skin-bg > " + sel);
  const scene = pick("div[data-wb-we-scene]");
  const canvas = scene ? scene.querySelector("canvas") : null;
  return JSON.stringify({
    active: we ? we.active() : null,
    paused: we ? we.paused() : null,
    sound: we && we.sound ? we.sound() : null,
    volume: we && we.volume ? we.volume() : null,
    wwglUrl: we && we.wwglUrl ? we.wwglUrl() : null,
    libLoaded: we && we.wwglLibLoaded ? we.wwglLibLoaded() : null,
    instance: we && we.wwglActive ? we.wwglActive() : false,
    renderId: we && we.wwglId ? we.wwglId() : null,
    generation: we && we.wwglGeneration ? we.wwglGeneration() : null,
    stats: we && we.wwglStats ? we.wwglStats() : null,
    sceneEls: document.querySelectorAll("#anonbuddy-skin-bg > div[data-wb-we-scene]").length,
    sceneOpacity: scene ? scene.style.opacity : null,
    canvasSize: canvas ? canvas.width + "x" + canvas.height : null,
    gradient: document.querySelectorAll("#anonbuddy-skin-bg > div[data-wb-we-gradient]").length,
    videos: document.querySelectorAll("#anonbuddy-skin-bg > video").length,
    canvases: document.querySelectorAll("canvas").length,
    skins: document.querySelectorAll("[data-webwallgl]").length,
    visibility: document.visibilityState,
  });
})()`));

const shot = async (name) => {
  const r = await session.send("Page.captureScreenshot", { format: "png" }, { timeoutMs: 60000 });
  const file = join(SHOT_DIR, name + ".png");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log(`  截图 ${file}`);
  return file;
};

// 等"目标条目真的就绪"。不能用页面里的 waitReady —— 它只判断"存在实例"，
// 会在**上一个实例还没被释放**时立刻返回 true，于是所有断言都在错误的时刻采样。
const waitForScene = async (id, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await state();
    if (s.instance === true && s.renderId === id) return s;
    if (Date.now() > deadline) return s;
    await sleep(500);
  }
};

const waitRunning = async (want, timeoutMs = 12000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await state();
    const running = Boolean(s.stats && s.stats.running);
    if (running === want) return s;
    if (Date.now() > deadline) return s;
    await sleep(400);
  }
};

console.log(`\n===== WebWallGL 实测（端口 ${PORT}）=====\n`);
const base = await state();
console.log(`前置：页面可见性 ${base.visibility}   当前主题 ${base.active}`);

if (!base.wwglUrl) {
  console.log("\n[!] renderer 里的注入实例没有 wwglUrl —— 说明页面跑的是旧版注入脚本。");
  console.log("    先跑：node apply-now.mjs  （或 scripts/launch-and-skin.mjs）再来。");
  session.close();
  process.exit(2);
}
// 注入脚本改过之后页面里可能还是旧实例：缺新诊断接口就说明要重新注入
const hasDiagnostics = await evaluate("typeof window.__anonbuddySkin.we.setSound === 'function' && typeof window.__anonbuddySkin.we.wwglStats === 'function'");
if (hasDiagnostics !== true) {
  console.log("\n[!] 注入实例缺少新诊断接口（setSound / wwglStats）—— 页面里是旧版注入脚本。");
  console.log("    先跑：node apply-now.mjs  再来。");
  session.close();
  process.exit(2);
}
console.log(`        引擎地址 ${base.wwglUrl}`);
if (base.visibility !== "visible") {
  // 硬门：窗口隐藏时 rAF 不跑 → mount 永远不 resolve → 整套断言必然假失败。
  // 与其产出一堆误导性的 FAIL，不如直接拒绝运行（退出码 3 与断言失败区分开）。
  console.log("\n[!] 窗口当前不可见（visibilityState=" + base.visibility + "）：rAF 不跑 → mount 不会 resolve。");
  console.log("    请把 WorkBuddy 窗口切到前台（不要最小化 / 不要收进托盘）后重跑。");
  session.close();
  process.exit(3);
}

// ---- 0. 目标条目 ----
const items = JSON.parse(await evaluate("JSON.stringify(window.__anonbuddySkin.we.items())"));
const scenes = items.filter((x) => x.rawType === "scene" && x.pkgUrl).sort((a, b) => a.pkgBytes - b.pkgBytes);
console.log(`\nscene 条目 ${scenes.length} 条（带 pkg 的），体积 ${(scenes[0].pkgBytes / 1048576).toFixed(1)}MB ~ ${(scenes[scenes.length - 1].pkgBytes / 1048576).toFixed(1)}MB`);
const small = scenes[0];
const large = [...scenes].reverse().find((x) => x.pkgBytes / 1048576 <= LARGE_LIMIT_MB) ?? scenes[scenes.length - 1];
console.log(`  小包 ${small.id} ${(small.pkgBytes / 1048576).toFixed(1)}MB  ${small.title.slice(0, 40)}`);
console.log(`  大包 ${large.id} ${(large.pkgBytes / 1048576).toFixed(1)}MB  ${large.title.slice(0, 40)}`);

// ---- 1. 出画 ----
console.log("\n[1] 最小 scene：出画");
await evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(small.id)})`);
let s1 = await waitForScene(small.id, READY_TIMEOUT);
const ready = s1.instance === true && s1.renderId === small.id;
check("mount 首帧就绪（静态图被顶替的前提）", ready === true, JSON.stringify({ instance: s1.instance, renderId: s1.renderId }));
check("GL 实例已挂上且指向该条目", ready === true, JSON.stringify({ instance: s1.instance, renderId: s1.renderId }));
check("渲染容器进了背景图层", s1.sceneEls === 1, String(s1.sceneEls));
check("容器已淡入（opacity=1）", String(s1.sceneOpacity) === "1", String(s1.sceneOpacity));
check("canvas 有真实尺寸", /^\d+x\d+$/.test(String(s1.canvasSize)) && !/^0x/.test(String(s1.canvasSize)), String(s1.canvasSize));
check("场景装配信息非空（info 有 width/layerCount）", Boolean(s1.stats && s1.stats.info && s1.stats.info.width), JSON.stringify(s1.stats && s1.stats.info));
if (ready) {
  s1 = await waitRunning(true, 12000);
  check("渲染循环在跑（fps>0）", Number(s1.stats?.fps) > 0 && s1.stats?.running === true, JSON.stringify(s1.stats));
  check("无多余 WebGL 层（skins=1）", s1.skins === 1, String(s1.skins));
  await shot("1-small-" + small.id);
}

// ---- 2. 切换：旧实例必须被销毁 ----
console.log("\n[2] 切到更大的 scene：旧实例销毁 + 不叠加");
await evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(large.id)})`);
const s2 = await waitForScene(large.id, READY_TIMEOUT);
const ready2 = s2.instance === true && s2.renderId === large.id;
check("第二个 scene 也渲染就绪", ready2 === true, JSON.stringify({ instance: s2.instance, renderId: s2.renderId }));
check("世代号自增（说明确实走过释放）", Number(s2.generation) > Number(s1.generation), `${s1.generation} -> ${s2.generation}`);
check("渲染容器仍然只有 1 个（不叠层）", s2.sceneEls === 1, String(s2.sceneEls));
check("WebGL 层仍然只有 1 个（旧上下文已释放）", s2.skins === 1, String(s2.skins));
check("实例指向新条目", s2.renderId === large.id, String(s2.renderId));
if (ready2) {
  const s2r = await waitRunning(true, 15000);
  check("大包也在正常出帧", Number(s2r.stats?.fps) > 0, JSON.stringify(s2r.stats));
  await shot("2-large-" + large.id);
}

// ---- 3/4. 暂停与恢复 ----
console.log("\n[3] 暂停 / 恢复：走实例 API，不重建");
await evaluate("window.__anonbuddySkin.we.setPaused(true)");
const s3 = await waitRunning(false, 8000);
check("暂停状态已生效", s3.paused === true, String(s3.paused));
check("暂停后渲染循环停转", Boolean(s3.stats) && s3.stats.running === false, JSON.stringify(s3.stats));
const genBeforeResume = s3.generation;
await evaluate("window.__anonbuddySkin.we.setPaused(false)");
const s4 = await waitRunning(true, 15000);
check("恢复后重新开始渲染", Boolean(s4.stats) && s4.stats.running === true, JSON.stringify(s4.stats));
check("恢复没有重建实例（世代号未变）", Number(s4.generation) === Number(genBeforeResume), `${genBeforeResume} -> ${s4.generation}`);

// ---- 5. 音量 ----
console.log("\n[5] 音量与静音：推给 GL 的音频通道");
await evaluate("window.__anonbuddySkin.we.setSound(true)");
await evaluate("window.__anonbuddySkin.we.setVolume(45)");
const s5 = await state();
check("声音开关 + 音量已落值", s5.sound === true && s5.volume === 45, JSON.stringify({ sound: s5.sound, volume: s5.volume }));
check("音量变化没有打断渲染", s5.instance === true && s5.renderId === large.id, JSON.stringify({ instance: s5.instance, renderId: s5.renderId }));
await evaluate("window.__anonbuddySkin.we.setVolume(0)");

// ---- 6. 离开主题：GL 必须被收掉 ----
console.log("\n[6] 离开 WE 主题：GL 与容器一起收掉");
await evaluate(`window.__anonbuddySkin.setTheme(${JSON.stringify(value("--plain-theme", "aisu"))})`);
await sleep(1500);
const s6 = await state();
check("scene 容器已移除", s6.sceneEls === 0, String(s6.sceneEls));
check("GL 实例已销毁", s6.instance === false && s6.renderId === null, JSON.stringify({ instance: s6.instance, renderId: s6.renderId }));
check("没有残留的 canvas / 渲染层", s6.canvases <= base.canvases && s6.skins === 0, JSON.stringify({ canvases: s6.canvases, skins: s6.skins }));
check("渐变兜底层也清掉了", s6.gradient === 0, String(s6.gradient));

// ---- 7. 反复 apply 幂等 ----
console.log("\n[7] 反复 apply 同一 scene：不能叠渲染循环 / 不能漏 GL 上下文");
for (let i = 0; i < 3; i += 1) await evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(small.id)})`);
const s7 = await waitForScene(small.id, READY_TIMEOUT);
const s7r = await waitRunning(true, 12000);
check("连点 3 次后仍然渲染成功", s7.instance === true && s7.renderId === small.id, JSON.stringify({ instance: s7.instance, renderId: s7.renderId }));
check("只有 1 个渲染容器", s7.sceneEls === 1, String(s7.sceneEls));
check("只有 1 个 WebGL 层（没有叠加循环）", s7.skins === 1, String(s7.skins));
check("连点之后仍在出帧（没有叠循环把 GPU 拖死）", Number(s7r.stats?.fps) > 0, JSON.stringify(s7r.stats));
check("全页 canvas 数没有增长", s7.canvases <= base.canvases + 1, `${base.canvases} -> ${s7.canvases}`);
check("没有留下 <video> 残留", s7.videos === 0, String(s7.videos));
await shot("7-after-3-applies");

// ---- 收尾 ----
if (RESTORE) {
  console.log("\n[收尾] 还原成进入前的主题与状态");
  const target = base.active;
  // ⚠️ we.active() 返回的是**条目 id**（"3028473503"），不是主题 id（"we-3028473503"）。
  //    拿它去 setTheme 两个分支都不匹配，收尾就静默失效 —— 而且如果前一步恰好留下同一个
  //    壁纸，断言还会"假通过"。1.0.5 实测在国内版跑满 31 项时才暴露出来。
  const weIds = new Set(items.map((x) => x.id));
  if (target && weIds.has(target)) {
    await evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(target)})`);
  } else if (target && target.startsWith("we-") && weIds.has(target.slice(3))) {
    await evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(target.slice(3))})`);
  } else if (target) {
    await evaluate(`window.__anonbuddySkin.setTheme(${JSON.stringify(target)})`);
  } else {
    await evaluate("window.__anonbuddySkin.clearTheme()");
  }
  await evaluate(`window.__anonbuddySkin.we.setPaused(${base.paused === true})`);
  await evaluate(`window.__anonbuddySkin.we.setSound(${base.sound === true})`);
  if (typeof base.volume === "number") await evaluate(`window.__anonbuddySkin.we.setVolume(${base.volume})`);
  await sleep(800);
  const sEnd = await state();
  check("收尾：主题已还原", sEnd.active === base.active, `${base.active} -> ${sEnd.active}`);
} else {
  console.log("\n[收尾] --no-restore：保留当前选中的壁纸");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n===== 汇总（端口 ${PORT}）=====`);
console.log(`  PASS=${results.length - failed.length}  FAIL=${failed.length}  共 ${results.length} 项`);
if (failed.length) {
  console.log("  失败项：");
  for (const f of failed) console.log(`    - ${f.label}  -> ${f.detail}`);
  console.log("  [!] 渲染相关失败请先确认窗口可见（visibilityState=visible）再判断；");
  console.log("      降级链会留在静态贴图上，界面不受影响 —— 失败不等于界面坏了。");
}
session.close();
process.exit(failed.length ? 1 : 0);
