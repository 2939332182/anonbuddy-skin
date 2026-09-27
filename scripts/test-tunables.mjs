// 回归测试：两个外观调节项 —— 侧边栏毛玻璃强度 / 背景图模糊程度（各 1..100）。
// 用法：node scripts/test-tunables.mjs [port]
//
// 背景（2026-09-20，两个真实 bug 换来的）：
//
// ① **计算样式对了，画面却完全没变。**
//    最初只断言 getComputedStyle(...).filter === "blur(30px)" —— 断言全绿，
//    但背景图根本看不见：hero 被放在负 z-index 的图层里，而 body 当时还挂着不透明底色。
//    html 有原生白底 → body 的背景不再"上交给画布"，而是作为普通元素背景在绘制顺序
//    第 3 步绘制，**晚于**负 z-index 图层的第 2 步 → 把图层整个盖住。
//    教训：涉及"看不看得见"的改动，必须断言**真实像素**，不能只断言计算样式。
//    所以下面第 8 节直接比截图字节数。
//
// ② **拖动卡顿。** 两个值原来写在 html 的自定义属性上，实测在 html 上
//    style.setProperty 写**任何**自定义属性（哪怕没人用）都会触发全文档样式重算
//    （本机 2269 个元素 ≈ 23ms/次 → 拖动只有 ~40fps）。
//    改成写"真实元素的内联 style"（背景图层）/ "消费它的元素自身"（侧边栏）后是 0ms。
//    所以下面第 9 节把同步开销也钉住。

import { createHarness } from "./_harness.mjs";

const t = await createHarness({ name: "test-tunables" });
const { evaluate, sleep, check, waitFor } = t;

await t.applyLast();

// 先把两个值显式还原成默认：它们存在 localStorage 里，上一次运行可能留下别的值。
// （测试必须自带前置状态，不能依赖"上次跑到哪"—— 这是本项目测试的老规矩。）
await evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  sk.tunables.set("sidebarBlur", 100);
  sk.tunables.set("bgBlur", 1);
  return true;
})()`);
await sleep(300);

const openSettings = async () => {
  if (await evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`)) return true;
  await evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
  return (
    (await waitFor(() => evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`), {
      waitMs: 6000, stepMs: 200,
    })) === true
  );
};

const readAll = () => evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  const layer = document.getElementById(sk.tunables.layerId);
  const sidebar = document.querySelector("[data-view-id=sidebar]");
  const lcs = layer ? getComputedStyle(layer) : null;
  return {
    values: sk.tunables.get(),
    vars: sk.tunables.cssVars(),
    spec: sk.tunables.spec(),
    sidebarFilter: sidebar ? getComputedStyle(sidebar).backdropFilter : null,
    layerFilter: lcs ? lcs.filter : null,
    layerInset: lcs ? lcs.inset : null,
    layerBg: lcs ? lcs.backgroundImage : null,
    layerBgColor: lcs ? lcs.backgroundColor : null,
    layerPos: lcs ? lcs.position : null,
    layerZ: lcs ? lcs.zIndex : null,
    layerCount: document.querySelectorAll("#" + sk.tunables.layerId).length,
    stored: localStorage.getItem(sk.tunables.key),
    dark: /vscode-dark/.test(document.body.className),
  };
})()`);

// ---- 1. 背景图层结构（hero 挪进独立层后必须还在，且不能被盖住）----
const base = await readAll();
check("背景图层节点存在（真实节点，不是伪元素）", base.vars.layerPresent === true, JSON.stringify(base.vars));
check("背景图层是固定定位", base.layerPos === "fixed", String(base.layerPos));
check("背景图层压在内容之下（z-index:-1）", base.layerZ === "-1", String(base.layerZ));
check(
  "背景图层带 hero 图与遮罩（挪图层没把背景弄丢）",
  /url\(/.test(base.layerBg ?? "") && (base.layerBg?.match(/gradient/g) ?? []).length >= 2,
  `url 数=${(base.layerBg?.match(/url\(/g) ?? []).length} gradient 数=${(base.layerBg?.match(/gradient/g) ?? []).length}`,
);
check(
  "背景图层自带主题底色（body 已透明，底色必须由这一层提供）",
  /^rgb\(/.test(base.layerBgColor ?? ""),
  String(base.layerBgColor),
);
check("背景图层只有一个（重复 apply 不叠层）", base.layerCount === 1, String(base.layerCount));

// ---- 2. 规格与默认值 ----
const spec = base.spec;
check("对外暴露两个调节项", Array.isArray(spec) && spec.length === 2, JSON.stringify(spec));
check(
  "默认值与「没这功能之前」的观感一致（侧边栏 100→24px，背景 1≈0）",
  base.values.sidebarBlur === 100 && base.values.bgBlur === 1 &&
    base.vars.sidebarVar === "blur(24px) saturate(1.15)" && base.vars.bgFilter === "none",
  JSON.stringify({ v: base.values, vars: base.vars }),
);

// ---- 3. 面板里真的有滑块，且 range 是 1..100 ----
const settingsOpen = await openSettings();
check("能打开设置弹窗（滑块断言的前提）", settingsOpen === true, String(settingsOpen));
const paneInfo = await evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  if (!sk.settings.open()) return null;
  const pane = sk.settings.pane();
  const inputs = [...pane.querySelectorAll('input[type="range"][data-wb-tunable]')].map((el) => ({
    key: el.dataset.wbTunable, min: el.min, max: el.max, step: el.step, value: el.value,
  }));
  return { inputs };
})()`);
check("面板里有两个滑块", paneInfo?.inputs?.length === 2, JSON.stringify(paneInfo));
check(
  "两个滑块的取值范围都是 1..100",
  (paneInfo?.inputs ?? []).every((i) => i.min === "1" && i.max === "100" && i.step === "1"),
  JSON.stringify(paneInfo?.inputs),
);

// ---- 4. 拖动滑块（真实 input 事件）→ 渲染状态跟着变 ----
await evaluate(`(() => {
  const el = document.querySelector('[data-wb-tunable="sidebarBlur"]');
  el.value = "50";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`);
await sleep(300);
const dragged = await readAll();
check("拖滑块能改到值（不是只有 API 能改）", dragged.values.sidebarBlur === 50, JSON.stringify(dragged.values));
check(
  "值按系数换算并作用到侧边栏",
  dragged.vars.sidebarVar === "blur(12px) saturate(1.15)" && /blur\(12px\)/.test(dragged.sidebarFilter ?? ""),
  `var=${dragged.vars.sidebarVar} filter=${dragged.sidebarFilter}`,
);
check("拖动后落盘（松手才写）", JSON.parse(dragged.stored ?? "{}").sidebarBlur === 50, String(dragged.stored));

// ---- 5. 背景模糊：0 附近不挂 filter，拉高才挂 ----
await evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 1); return true; })()`);
await sleep(250);
const blurOff = await readAll();
check(
  "背景模糊≈0 时不挂 filter（不白建全屏合成层）",
  blurOff.layerFilter === "none" && blurOff.vars.bgInset === "0px",
  `filter=${blurOff.layerFilter} inset=${blurOff.vars.bgInset}`,
);

await evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 60); return true; })()`);
await sleep(250);
const blurOn = await readAll();
check("拉高背景模糊后 filter 真的挂上", blurOn.layerFilter === "blur(18px)", `filter=${blurOn.layerFilter}`);
check(
  "图层随模糊量外扩，避免视口边缘露出透明边",
  blurOn.vars.bgInset === "-36px",
  `inset=${blurOn.vars.bgInset}（应为 -2×18px）`,
);

// ---- 6. 边界与非法输入 ----
const edges = await evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  return {
    low: sk.tunables.set("bgBlur", -50),
    high: sk.tunables.set("bgBlur", 9999),
    nan: sk.tunables.set("bgBlur", "abc"),
    unknown: sk.tunables.set("nope", 50),
    minVar: (() => { sk.tunables.set("sidebarBlur", 1); return sk.tunables.cssVars().sidebarVar; })(),
    maxVar: (() => { sk.tunables.set("sidebarBlur", 100); return sk.tunables.cssVars().sidebarVar; })(),
  };
})()`);
check("低于下限被 clamp 到 1", edges.low === 1, String(edges.low));
check("高于上限被 clamp 到 100", edges.high === 100, String(edges.high));
check("非法输入回落到默认值", edges.nan === 1, String(edges.nan));
check("未知键不产生副作用", edges.unknown === null, String(edges.unknown));
check("最小值 1 → 0.24px", edges.minVar === "blur(0.24px) saturate(1.15)", edges.minVar);
check("最大值 100 → 24px", edges.maxVar === "blur(24px) saturate(1.15)", edges.maxVar);

// ---- 7. 深浅背景下都要正常 ----
const perTheme = [];
for (const [themeId, expectDark] of [["aisu", false], ["wuthering-echo", true]]) {
  await evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 50); window.__anonbuddySkin.tunables.set("sidebarBlur", 40); window.__anonbuddySkin.setTheme(${JSON.stringify(themeId)}); return true; })()`);
  await sleep(1000);
  perTheme.push({ themeId, expectDark, s: await readAll() });
}
for (const { themeId, expectDark, s } of perTheme) {
  const label = expectDark ? "深色" : "浅色";
  check(`${label}主题（${themeId}）下背景图层仍带 hero 图`, /url\(/.test(s.layerBg ?? ""), String(s.layerBg).slice(0, 60));
  check(`${label}主题下侧边栏毛玻璃跟随调节值`, /blur\(9\.6px\)/.test(s.sidebarFilter ?? ""), s.sidebarFilter);
  check(`${label}主题下背景模糊跟随调节值`, s.layerFilter === "blur(15px)", `filter=${s.layerFilter}`);
  check(`${label}主题下深浅类名与预期一致`, s.dark === expectDark, `dark=${s.dark}`);
}

// ---- 8. 像素级验证（**关键**：只断言计算样式会「空跑」）----
// 真实照片 / 模糊后的照片 / 纯色底，PNG 压缩后的体积差异极大 —— 既便宜又灵敏。
const shotBytes = async () => {
  const png = await t.send("Page.captureScreenshot", { format: "png" });
  return Buffer.from(png.data, "base64").length;
};
const setHideLayer = (hide) => evaluate(`(() => {
  const id = "wb-test-hide-bg";
  document.getElementById(id)?.remove();
  if (!${hide}) return true;
  const st = document.createElement("style");
  st.id = id;
  st.textContent = "#anonbuddy-skin-bg{display:none !important}";
  document.head.appendChild(st);
  return true;
})()`);

await evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 1); window.__anonbuddySkin.tunables.set("sidebarBlur", 100); return true; })()`);
await sleep(600);
const sharpBytes = await shotBytes();
await setHideLayer(true);
await sleep(500);
const hiddenBytes = await shotBytes();
await setHideLayer(false);
await sleep(500);

check(
  "背景图层真的画出来了（不是被 body 底色之类盖住）",
  sharpBytes > hiddenBytes * 1.5,
  `显示=${sharpBytes} 隐藏=${hiddenBytes} 比值=${(sharpBytes / hiddenBytes).toFixed(2)}（被盖住时比值会接近 1）`,
);

await evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 100); return true; })()`);
await sleep(800);
const blurredBytes = await shotBytes();
check(
  "拖到最大模糊时画面确实变了（像素级，不只是计算样式）",
  blurredBytes < sharpBytes * 0.8,
  `清晰=${sharpBytes} 模糊=${blurredBytes}（模糊降低高频细节，PNG 会明显变小）`,
);

const clipBytes = async (x, y, w, h) => {
  const png = await t.send("Page.captureScreenshot", { format: "png", clip: { x, y, width: w, height: h, scale: 1 } });
  return Buffer.from(png.data, "base64").length;
};
await evaluate(`(() => { window.__anonbuddySkin.tunables.set("bgBlur", 1); window.__anonbuddySkin.tunables.set("sidebarBlur", 1); return true; })()`);
await sleep(700);
const glassSharp = await clipBytes(0, 300, 200, 260);
await evaluate(`(() => { window.__anonbuddySkin.tunables.set("sidebarBlur", 100); return true; })()`);
await sleep(700);
const glassBlur = await clipBytes(0, 300, 200, 260);
check(
  "侧边栏毛玻璃在画面上真的起作用（局部像素对照）",
  glassSharp !== glassBlur,
  `毛玻璃 1 → ${glassSharp} 字节 / 毛玻璃 100 → ${glassBlur} 字节`,
);

// ---- 9. 拖动流畅度 ----
// ⚠️ 必须测**真实拖动路径**：拖滑块只触发 input 事件 → applyTunables（写内联样式）。
//    走 tunables.set() 是不对的 —— 它还会写 localStorage（同步 IO），那是"松手落盘"的代价，
//    不是拖动中的代价，会得出虚高的数字（实测 28ms vs 真实 0ms）。
// 门槛给得比较松（中位 < 20ms）：这是"能不能丝滑"的底线，不是性能竞赛。
// 反证记录：把两个值改回写在 html 的自定义属性上 → 真实拖动路径也会涨到 20ms+，本条会红。
const dragPerf = await evaluate(`(() => {
  const el = document.querySelector('[data-wb-tunable="bgBlur"]');
  const el2 = document.querySelector('[data-wb-tunable="sidebarBlur"]');
  const times = [];
  for (let v = 1; v <= 100; v += 4) {
    const t0 = performance.now();
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el2.value = String(v);
    el2.dispatchEvent(new Event("input", { bubbles: true }));
    void document.body.offsetWidth; // 强制样式重算 + 布局，测真实代价
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    n: times.length,
    median: Math.round(times[Math.floor(times.length / 2)] * 10) / 10,
    worst: Math.round(times[times.length - 1] * 10) / 10,
  };
})()`);
check(
  "拖动时每次更新的同步开销可接受（中位 < 20ms）",
  dragPerf.median < 20,
  JSON.stringify(dragPerf),
);

// ---- 收尾：还原默认值 + 关掉面板 ----
await evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  sk.tunables.set("sidebarBlur", 100);
  sk.tunables.set("bgBlur", 1);
  sk.settings.close();
  return true;
})()`);
await sleep(300);
const restored = await readAll();
check("收尾：调节项已还原默认", restored.values.sidebarBlur === 100 && restored.values.bgBlur === 1, JSON.stringify(restored.values));
check("收尾：背景模糊已摘掉 filter", restored.layerFilter === "none", String(restored.layerFilter));

// 设置弹窗是全屏遮罩，留着会让后面依赖"点/悬停侧边栏"的测试全部命不中目标 —— 必须关掉并断言已关
for (const type of ["keyDown", "keyUp"]) {
  await t.send("Input.dispatchKeyEvent", {
    type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  });
}
await sleep(300);
check("收尾：设置弹窗已关闭", (await evaluate(`!document.querySelector(".settings-modal-overlay")`)) === true);

await t.finish();
