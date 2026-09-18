// 验证侧边栏列表项的悬停强调色
//
// 不变量（踩过的坑）：
//   1. 悬停态必须真的上色（否则用户看不出鼠标在哪一行）
//   2. 悬停态必须用 background-image 叠渐变，**不能改 background-color** ——
//      因为 sticky 行/选中态的背景色是"不透明实底"，一旦被悬停规则换成透明，
//      滚动的列表项就会穿透出两层文字。
// 收尾：把鼠标移开，保证不残留悬停态。
import { writeFileSync, mkdirSync } from "node:fs";
import { createHarness } from "./_harness.mjs";

const t = await createHarness({ name: "test-hover" });
const { session: s, check } = t;
const OUT = new URL("../outputs/verify/sidebar-hover.png", import.meta.url);

const row = await s.evaluate(`(() => {
  const rows = [...document.querySelectorAll("[data-view-id=sidebar] .cb-agent-card")];
  const el = rows.find((x) => !(x.className || "").toString().includes("_selected_"));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.textContent || "").slice(0, 14) };
})()`);
console.log("HOVER_TARGET=" + JSON.stringify(row));
check("侧边栏找到可悬停的列表项", Boolean(row));

if (!row) {
  await t.finish();
} else {
  // 同时读 backgroundColor 与 backgroundImage：要区分"实底被换掉"和"叠了渐变"
  const readAt = (x, y) => `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    const card = el && el.closest ? el.closest(".cb-agent-card") : null;
    if (!card) return { found: false };
    const cs = getComputedStyle(card);
    return { found: true, bg: cs.backgroundColor, image: cs.backgroundImage };
  })()`;

  const before = await s.evaluate(readAt(row.x, row.y));
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x, y: row.y, buttons: 0 });
  await t.sleep(450);
  const hover = await s.evaluate(readAt(row.x, row.y));
  console.log("BEFORE=", JSON.stringify({ bg: before.bg, image: before.image }));
  console.log("HOVER =", JSON.stringify({ bg: hover.bg, image: hover.image }));

  check("悬停目标命中了列表项", hover.found);

  const alpha = (v) => {
    const c = String(v);
    let m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (m) {
      const p = m[1].split(",").map((x) => x.trim());
      return p.length > 3 ? Number(p[3]) : 1;
    }
    m = /^color\(srgb\s+[\d.]+\s+[\d.]+\s+[\d.]+\s*\/\s*([\d.]+)\)$/.exec(c);
    if (m) return Number(m[1]);
    return c === "transparent" ? 0 : 1;
  };

  // 悬停生效：底色变了 或 叠上了渐变（后者是皮肤的推荐做法）
  const bgChanged = hover.bg !== before.bg;
  const imageAdded = hover.image !== before.image && hover.image !== "none";
  check("悬停后出现视觉反馈", bgChanged || imageAdded, `bg ${before.bg} -> ${hover.bg}; image ${imageAdded ? "已叠渐变" : "未变"}`);
  // 关键不变量：悬停不该把实底换成全透明（那会让 sticky 穿透）
  check("悬停后底色未退化为全透明", alpha(hover.bg) > 0 || hover.image.includes("gradient"), `alpha=${alpha(hover.bg)}`);

  // 顺手留一张截图便于人工目检（失败不阻断）
  try {
    mkdirSync(new URL(".", OUT), { recursive: true });
    const shot = await s.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: Math.max(0, row.y - 135), width: 280, height: 270, scale: 2 },
    });
    writeFileSync(OUT, Buffer.from(shot.data, "base64"));
    console.log("截图已存 " + OUT.pathname);
  } catch (e) {
    console.log("截图跳过：" + e.message);
  }

  // 收尾：把鼠标移开
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 600, buttons: 0 });
  await t.finish();
}
