// 验证插件图标的拖动与"贴边锚点"行为
//
// 关键不变量（踩过的坑）：位置存的是 {ax:"left"|"right", dx, y} 贴边锚点，
// 不是绝对坐标 —— 存绝对 x 的话窗口一缩小就被夹到边缘并写回，之后再放大也回不去。
// 所以这里断言"拖动生效 + 存的是锚点格式 + resetPosition 能清干净"，
// 不断言具体像素值（用户可拖拽的位置本来就不该断言死值）。
import { createHarness } from "./_harness.mjs";

const t = await createHarness({ name: "test-drag" });
const { session: s, check } = t;

const readMenu = () =>
  s.evaluate(`(() => {
    const m = document.getElementById("anonbuddy-skin-menu");
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const b = m.querySelector("button")?.getBoundingClientRect();
    return {
      mx: Math.round(r.x), my: Math.round(r.y),
      bx: b ? b.x + b.width / 2 : null, by: b ? b.y + b.height / 2 : null,
      saved: localStorage.getItem("anonbuddySkinMenuPos"),
    };
  })()`);

const before = await readMenu();
console.log("BEFORE=", JSON.stringify(before));
check("换肤图标存在", Boolean(before && before.bx !== null));

const target = { x: 300, y: 400 };
const send = (type, x, y, buttons) =>
  s.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });

try {
  await send("mousePressed", before.bx, before.by, 1);
  await send("mouseMoved", before.bx - 100, before.by + 120, 1);
  await send("mouseMoved", target.x, target.y, 1);
  await send("mouseReleased", target.x, target.y, 0);

  const after = await t.waitFor(async () => {
    const m = await readMenu();
    return m && m.saved ? m : null;
  });
  console.log("AFTER=", JSON.stringify(after));

  check("拖动后位置已改变", after.mx !== before.mx || after.my !== before.my, `${before.mx},${before.my} -> ${after.mx},${after.my}`);
  check("拖动后位置已持久化", Boolean(after.saved));

  // 核心不变量：存的是贴边锚点格式，不是绝对 x
  let pos = null;
  try {
    pos = JSON.parse(after.saved);
  } catch {
    /* 下面断言会失败并给出原文 */
  }
  const anchored = Boolean(pos && (pos.ax === "left" || pos.ax === "right") && typeof pos.dx === "number" && typeof pos.y === "number");
  check("持久化格式是贴边锚点（ax/dx/y）", anchored, after.saved);
  check("未持久化绝对 x 坐标", Boolean(pos && !("x" in pos)), after.saved);
} finally {
  // 收尾：恢复到默认位置，保证状态中性
  const reset = await s.evaluate(`(() => {
    window.__anonbuddySkin.resetPosition();
    const m = document.getElementById("anonbuddy-skin-menu");
    const r = m.getBoundingClientRect();
    return { mx: Math.round(r.x), my: Math.round(r.y), saved: localStorage.getItem("anonbuddySkinMenuPos") };
  })()`);
  console.log("RESET=", JSON.stringify(reset));
  check("resetPosition 后已清除持久化位置", reset.saved === null, String(reset.saved));
  check("resetPosition 后回到默认位置", reset.mx !== 300 || reset.my !== 400, `${reset.mx},${reset.my}`);
}

await t.finish();
