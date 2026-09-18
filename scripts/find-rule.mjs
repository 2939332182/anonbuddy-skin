// 遍历文档内所有 <style> 元素的 cssRules，找出命中某个元素（如 #root）的规则。
// file:// 页面的外部样式表跨源读不了，但页面自己注入的 <style> 是同一文档，cssRules 可读。
// 用法：node scripts/find-rule.mjs "#root" [属性名] [port]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const [selector, propArg = "", portArg = "9333"] = process.argv.slice(2);
if (!selector) {
  console.error('用法：node scripts/find-rule.mjs "#root" [属性名] [port]');
  process.exit(1);
}

const session = new CdpSession((await fetchRendererTargets(Number(portArg)))[0].webSocketDebuggerUrl);
await session.open();

const out = await session.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { error: "元素不存在" };
  const hits = [];
  for (const styleEl of document.querySelectorAll("style")) {
    let rules;
    try { rules = styleEl.sheet ? [...styleEl.sheet.cssRules] : []; } catch (e) { continue; }
    const walk = (list, mediaText) => {
      for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) { walk([...rule.cssRules], rule.conditionText || rule.media?.mediaText || mediaText); continue; }
        if (!rule.selectorText) continue;
        let matches = false;
        try { matches = el.matches(rule.selectorText); } catch { matches = false; }
        if (!matches) continue;
        const prop = ${JSON.stringify(propArg)};
        const decls = [];
        for (let i = 0; i < rule.style.length; i += 1) {
          const name = rule.style[i];
          if (prop && name !== prop) continue;
          decls.push(name + ": " + rule.style.getPropertyValue(name) + (rule.style.getPropertyPriority(name) ? " !important" : ""));
        }
        if (!decls.length) continue;
        hits.push({
          sheetId: styleEl.id || "(anonymous style)",
          media: mediaText || null,
          selector: rule.selectorText,
          decls,
        });
      }
    };
    walk(rules, "");
  }
  return { matched: hits.length, hits };
})()`);

console.log(JSON.stringify(out, null, 2));
session.close();
