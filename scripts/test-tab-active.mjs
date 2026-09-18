// 验证侧边栏导航按钮的 active 强调色
// 注意：这些按钮带 transition，必须在过渡结束后再读 getComputedStyle，
// 否则拿到的是动画中间值（会看起来像"规则没生效"）。
// 收尾：临时加的 .active 类一定会移除，不污染界面状态。
import { createHarness } from "./_harness.mjs";

const t = await createHarness({ name: "test-tab-active" });
const { session, check } = t;
const LABEL = process.argv[3] || "自动化";

const expr = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = [...document.querySelectorAll(".conversation-list-tab-button")]
    .find((b) => (b.textContent || "").includes(${JSON.stringify(LABEL)}));
  if (!btn) return "NOT_FOUND";
  const read = () => {
    const cs = getComputedStyle(btn);
    return { bg: cs.backgroundColor, weight: cs.fontWeight };
  };

  const before = read();

  btn.classList.add("active");
  await wait(500);
  const active = read();

  btn.classList.remove("active");
  await wait(500);
  const restored = read();

  // 行内 !important 应压不住皮肤的 active 规则（皮肤规则权重更高）
  btn.style.setProperty("background", "rgba(25, 201, 229, 0.26)", "important");
  await wait(500);
  const inlineImportant = read();
  btn.style.removeProperty("background");

  return { label: ${JSON.stringify(LABEL)}, before, active, restored, inlineImportant };
})()`;

const r = await session.evaluate(expr);
console.log("探针结果:", JSON.stringify(r, null, 1));

if (r === "NOT_FOUND") {
  t.check(`找到导航按钮「${LABEL}」`, false, "未找到，可能页面不在预期状态");
} else {
  // 把 rgba()/color(srgb ...) 都归一成 alpha，判断"上色了没有"
  // （color-mix() 输出 color(srgb r g b / a) 形式，只认 rgba 会假阴性）
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

  t.check("默认未选中时按钮透明", alpha(r.before.bg) === 0, r.before.bg);
  t.check("加 .active 后按钮上色", alpha(r.active.bg) > 0, r.active.bg);
  t.check("active 态字重加粗", Number(r.active.weight) > Number(r.before.weight), `${r.before.weight} -> ${r.active.weight}`);
  t.check("移除 .active 后恢复透明", alpha(r.restored.bg) === 0, r.restored.bg);
  t.check("移除 .active 后字重复原", r.restored.weight === r.before.weight, r.restored.weight);
  // 皮肤规则要能压过行内 !important，否则宿主脚本一注入就破坏主题一致性
  t.check("皮肤 active 规则不被行内 !important 覆盖", alpha(r.inlineImportant.bg) > 0, r.inlineImportant.bg);
}

await t.finish();
