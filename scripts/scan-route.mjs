// 导航到左上角某个入口（助理 / 自动化 / 更多 …），扫描主内容区里"面积大且不透明"的元素。
// 换肤遗漏基本都是这类容器：它们自带纯白/浅灰实底，会把背景图盖住。
// 用法：node scripts/scan-route.mjs <导航项文字> [port] [最小面积]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const [label, portArg = "9333", minAreaArg = "15000"] = process.argv.slice(2);
if (!label) {
  console.error("用法：node scripts/scan-route.mjs <导航项文字> [port] [最小面积]");
  process.exit(1);
}
const PORT = Number(portArg);
const MIN_AREA = Number(minAreaArg);

const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clicked = await session.evaluate(`(() => {
  const btn = [...document.querySelectorAll("[data-view-id=sidebar] .conversation-list-tab-button")]
    .find((el) => (el.textContent || "").trim() === ${JSON.stringify(label)});
  if (!btn) return false;
  btn.click();
  return true;
})()`);
if (!clicked) {
  console.error(`侧边栏里找不到「${label}」`);
  process.exit(1);
}
await sleep(1600);

// 关键：判断 alpha 必须同时支持 rgb()/rgba() 和 color(srgb r g b / a) 两种格式，
// color-mix() 输出的是后者，只认 rgba() 会产生假阴性。
const result = await session.evaluate(`(() => {
  const alphaOf = (value) => {
    const c = String(value);
    let m = /^rgba?\\(([^)]+)\\)$/.exec(c);
    if (m) { const p = m[1].split(",").map((v) => v.trim()); return p.length > 3 ? Number(p[3]) : 1; }
    m = /^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\/\\s*([\\d.]+)\\)$/.exec(c);
    if (m) return Number(m[4]);
    if (c === "transparent") return 0;
    return 1;
  };
  const main = document.querySelector("[data-view-id=main-content]");
  if (!main) return { error: "找不到 main-content" };
  const out = [];
  for (const el of main.querySelectorAll("*")) {
    const b = el.getBoundingClientRect();
    const area = b.width * b.height;
    if (area < ${MIN_AREA}) continue;
    const cs = getComputedStyle(el);
    if (alphaOf(cs.backgroundColor) < 0.45) continue;
    out.push({
      cls: String(el.className || el.tagName).slice(0, 66),
      w: Math.round(b.width), h: Math.round(b.height),
      bg: cs.backgroundColor,
    });
  }
  out.sort((a, b) => b.w * b.h - a.w * a.h);
  return {
    dataset: document.documentElement.dataset.workbuddySkin ?? null,
    total: out.length,
    top: out.slice(0, 14),
  };
})()`);

console.log(JSON.stringify(result, null, 2));
session.close();
