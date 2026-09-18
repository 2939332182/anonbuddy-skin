// 在页面所有样式表中搜索匹配指定选择器的规则
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
const PORT = Number(process.argv[2] || 9333);
const NEEDLE = process.argv[3] || "conversation-list-tab-button";
const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();

const expr = `(() => {
  const allSheets = [];
  const seen = new Set();
  const addSheets = (root) => {
    for (const list of [root.styleSheets, root.adoptedStyleSheets]) {
      if (!list) continue;
      for (const sh of list) { if (!seen.has(sh)) { seen.add(sh); allSheets.push(sh); } }
    }
  };
  const walkDom = (node) => {
    for (const el of node.querySelectorAll("*")) {
      if (el.shadowRoot) { addSheets(el.shadowRoot); walkDom(el.shadowRoot); }
    }
  };
  addSheets(document);
  walkDom(document);

  let ruleCount = 0;
  const out = [];
  for (const sheet of allSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    if (!rules) continue;
    const walk = (list, media) => {
      for (const rule of list) {
        if (rule.cssRules) {
          walk(rule.cssRules, (media ? media + " | " : "") + (rule.conditionText || (rule.media && rule.media.mediaText) || ""));
          continue;
        }
        if (!rule.selectorText) continue;
        ruleCount++;
        if (!rule.selectorText.includes(${JSON.stringify(NEEDLE)})) continue;
        out.push({ media: media || "", sel: rule.selectorText, css: rule.style.cssText.slice(0, 200) });
      }
    };
    walk(rules, "");
  }
  return { sheets: allSheets.length, ruleCount, hits: out.slice(0, 40) };
})()`;

const r = await s.evaluate(expr);
console.log("sheets=" + r.sheets + "  totalRules=" + r.ruleCount + "  hits=" + r.hits.length);
for (const e of r.hits) console.log((e.media ? "[" + e.media + "] " : "") + e.sel + "  { " + e.css + " }");
s.close();
