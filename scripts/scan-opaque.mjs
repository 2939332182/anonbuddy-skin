// 临时诊断：扫描全屏未被换肤覆盖的不透明背景元素
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
const PORT = Number(process.argv[2] || 9333);
const MIN_AREA = Number(process.argv[3] || 20000);
const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();
const expr = `(() => {
  const alpha = (c) => {
    if (!c || c === "transparent") return 0;
    let m = /rgba?\\(\\s*([\\d.]+)[,\\/\\s]+([\\d.]+)[,\\/\\s]+([\\d.]+)(?:[,/\\s]+([\\d.]+%?))?\\s*\\)/.exec(c);
    if (m) return m[4] === undefined ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    m = /color\\(\\s*srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*(?:\\/\\s*([\\d.]+%?))?\\s*\\)/.exec(c);
    if (m) return m[4] === undefined ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    if (c.indexOf("color(") === 0) return 1;
    return 0;
  };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (alpha(cs.backgroundColor) < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < ${MIN_AREA}) continue;
    if (el.closest("#workbuddy-skin-menu")) continue;
    out.push({ t: el.tagName, id: el.id||"", c: (el.className||"").toString().slice(0,38),
      bg: cs.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) });
  }
  out.sort((a,b) => b.w*b.h - a.w*a.h);
  return out.slice(0, 25);
})()`;
const rows = await s.evaluate(expr);
for (const e of rows) console.log([e.t, e.id, e.c, e.bg, e.w + "x" + e.h, "x=" + e.x, "y=" + e.y].join(" | "));
s.close();
