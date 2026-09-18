// 回归测试：窗口非最大化下的三处布局问题
// 用法：node scripts/test-window-layout.mjs [port]
//   1. 左上角标题与顶栏重叠 —— #root 丢了 30px 顶栏偏移（含兜底）
//   2. 空间栏与列表项重叠 —— sticky 行背景被设成透明，滚动内容穿透
//   3. 插件图标位置偏移 —— 绝对坐标被夹死后回不去
// 全程只读 + 临时改禁用状态/视口尺寸，收尾一律还原。

import { createHarness } from "./_harness.mjs";
const t = await createHarness({ name: "test-window-layout" });
const { session, sleep, waitFor, check } = t;

const evaluate = t.evaluate;

const OVERRIDE_ID = "workbuddy-desktop-layout-overrides";
const initial = await evaluate(`(() => {
  const root = document.getElementById("root");
  const label = document.querySelector("[data-view-id=sidebar] .conversation-section-label");
  const btn = document.getElementById("workbuddy-skin-menu").getBoundingClientRect();
  return {
    viewport: [innerWidth, innerHeight],
    rootMarginTop: getComputedStyle(root).marginTop,
    labelBg: label ? getComputedStyle(label).backgroundColor : null,
    storedPos: localStorage.getItem("workbuddySkinMenuPos"),
    btnRightGap: Math.round(innerWidth - btn.right),
    overrideExists: !!document.getElementById(${JSON.stringify(OVERRIDE_ID)}),
  };
})()`);
console.log("INITIAL=" + JSON.stringify(initial));

// 若初始没有存过坐标，测试中途会自己拖一次生成锚点，收尾时要清掉还原成默认
let hadStoredPos = initial.storedPos !== null;

try {
  // ---- 1. 顶栏偏移 ----
  t.check("顶栏存在（30px 自绘标题栏）", initial.overrideExists === true);
  t.check("正常状态下 #root 有 30px 顶栏偏移", initial.rootMarginTop === "30px", initial.rootMarginTop);

  // 极端情况：WorkBuddy 那条覆盖规则缺失/未生效时，皮肤自带的兜底要顶住
  await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(OVERRIDE_ID)}); if (el) el.disabled = true; return true; })()`);
  await sleep(200);
  const fallback = await evaluate(`getComputedStyle(document.getElementById("root")).marginTop`);
  t.check("覆盖规则失效时皮肤兜底仍保持 30px", fallback === "30px", fallback);
  await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(OVERRIDE_ID)}); if (el) el.disabled = false; return true; })()`);

  // ---- 2. sticky 行必须能遮住滚动内容 ----
  const sticky = await evaluate(`(() => {
    const pick = (sel) => {
      const el = document.querySelector("[data-view-id=sidebar] " + sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { position: cs.position, bg: cs.backgroundColor, img: cs.backgroundImage === "none" ? "none" : "gradient" };
    };
    return { label: pick(".conversation-section-label"), workspace: pick("[class*='_headerTopPadding_']") };
  })()`);
  const alphaOf = (v) => {
    const c = String(v);
    let m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (m) { const p = m[1].split(",").map((x) => x.trim()); return p.length > 3 ? Number(p[3]) : 1; }
    m = /^color\(srgb\s+[\d.]+\s+[\d.]+\s+[\d.]+\s*\/\s*([\d.]+)\)$/.exec(c);
    if (m) return Number(m[1]);
    return c === "transparent" ? 0 : 1;
  };
  for (const [name, v] of [["空间分组标题", sticky.label], ["工作区行", sticky.workspace]]) {
    if (!v) { console.log(`SKIP  ${name}当前未挂载`); continue; }
    t.check(`${name}是 sticky（必须能遮挡）`, v.position === "sticky", v.position);
    t.check(`${name}底色不透明（否则滚动内容穿透）`, alphaOf(v.bg) >= 0.95, v.bg);
  }

  // ---- 3. 图标位置跟着窗口边跑 ----
  // 注意：不断言具体数值（用户可能把图标拖到任意位置），
  // 只断言"贴边距离在窗口尺寸变化时保持不变" —— 这才是锚点存储要保证的不变量。
  //
  // 若当前是"从未拖动过"的默认状态（localStorage 里没有坐标），先自己拖一次生成锚点，
  // 不能让测试依赖前置状态 —— 否则任何清过位置的操作（用户点重置 / test-drag 收尾）
  // 都会让这条断言假报失败。收尾时会一并还原。
  if (!hadStoredPos) {
    await evaluate(`(() => {
      const btn = document.querySelector("#workbuddy-skin-menu button");
      const r = btn.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const opts = { bubbles: true, clientX: cx, clientY: cy, button: 0, pointerId: 1 };
      btn.dispatchEvent(new PointerEvent("pointerdown", opts));
      opts.clientX = cx - 160; opts.clientY = cy + 120;
      btn.dispatchEvent(new PointerEvent("pointermove", opts));
      btn.dispatchEvent(new PointerEvent("pointerup", opts));
      return true;
    })()`);
    await sleep(300);
  }
  const storedPos = await evaluate(`localStorage.getItem("workbuddySkinMenuPos")`);
  const anchorGap = await evaluate(`(() => { const b = document.getElementById("workbuddy-skin-menu").getBoundingClientRect(); return Math.round(innerWidth - b.right); })()`);
  let parsed = null;
  try { parsed = JSON.parse(storedPos ?? "null"); } catch {}
  t.check("图标坐标已迁移成贴边锚点格式", parsed !== null && Number.isFinite(parsed.dx) && (parsed.ax === "left" || parsed.ax === "right"), storedPos);
  const parseGap = parsed?.ax === "left" ? parsed.dx : parsed?.dx;
  t.check("当前贴边距离与存储的锚点一致", anchorGap === parseGap, `${anchorGap} vs dx=${parseGap}`);
  const refGap = anchorGap;

  for (const [w, h] of [[1920, 1040], [1000, 700]]) {
    await session.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const gap = await evaluate(`(() => { const b = document.getElementById("workbuddy-skin-menu").getBoundingClientRect(); return Math.round(innerWidth - b.right); })()`);
    t.check(`模拟 ${w}×${h} 时贴边距离不变（锚点生效）`, gap === refGap, `${gap} vs ${refGap}`);
  }
} finally {
  await session.send("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(OVERRIDE_ID)});
    if (el) el.disabled = false;
    const scroller = document.querySelector("[data-view-id=sidebar] .conversation-list-content");
    if (scroller) scroller.scrollTop = 170;
    ${hadStoredPos ? "" : `try { localStorage.removeItem("workbuddySkinMenuPos"); } catch {}
    window.__workbuddySkin?.resetPosition?.();`}
    return true;
  })()`);
  await sleep(300);
  const final = await evaluate(`(() => {
    const b = document.getElementById("workbuddy-skin-menu").getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      rootMarginTop: getComputedStyle(document.getElementById("root")).marginTop,
      btnRightGap: Math.round(innerWidth - b.right),
    };
  })()`);
  console.log("FINAL=" + JSON.stringify(final));
  t.check("收尾：视口还原", JSON.stringify(final.viewport) === JSON.stringify(initial.viewport), JSON.stringify(final.viewport));
  t.check("收尾：#root 偏移正常", final.rootMarginTop === "30px", final.rootMarginTop);
  t.check("收尾：图标贴边距离还原", final.btnRightGap === initial.btnRightGap, `${final.btnRightGap} vs ${initial.btnRightGap}`);
  session.close();
}


await t.finish();
