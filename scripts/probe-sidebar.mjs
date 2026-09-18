// 探查侧边栏"空间/任务"列表项的结构与配色
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();

const expr = `(() => {
  const side = document.querySelector("[data-view-id=sidebar]");
  if (!side) return "NO_SIDEBAR";
  const rows = [];
  const seen = new Set();
  for (const el of side.querySelectorAll("*")) {
    const cls = (el.className || "").toString();
    if (!/card|item|row|task|space|selected|header|folder|section/i.test(cls)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 16) continue;
    const key = cls + "|" + Math.round(r.y);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      t: el.tagName,
      cls: cls.slice(0, 200),
      bg: cs.backgroundColor,
      radius: cs.borderRadius,
      w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y),
      text: (el.textContent || "").trim().slice(0, 16),
    });
  }
  return rows.sort((a, b) => a.y - b.y).slice(0, 24);
})()`;

const r = await s.evaluate(expr);
if (typeof r === "string") { console.log(r); }
else for (const e of r) {
  console.log([e.t, e.cls, e.bg, e.w + "x" + e.h, "y=" + e.y, "r=" + e.radius, JSON.stringify(e.text)].join(" | "));
}
s.close();
