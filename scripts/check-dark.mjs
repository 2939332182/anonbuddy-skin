// 深色主题兼容性检查（纯页面内切换，不改持久状态）
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();

const probe = `(() => {
  const bg = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : "NONE"; };
  const body = getComputedStyle(document.body);
  return {
    theme: document.documentElement.dataset.anonbuddySkin,
    mode: document.body.dataset.vscodeThemeKind,
    glass: body.getPropertyValue("--wb-glass").trim().slice(0, 60),
    text: body.getPropertyValue("--wb-text").trim(),
    sidebar: bg("[data-view-id=sidebar]"),
    input: bg(".cr-input-container"),
    toolbarRight: bg(".cr-input-toolbar__right"),
  };
})()`;

console.log("LIGHT=" + JSON.stringify(await s.evaluate(probe)));
await s.evaluate(`window.__anonbuddySkin.setTheme("genshin-night")`);
console.log("DARK =" + JSON.stringify(await s.evaluate(probe)));
await s.evaluate(`window.__anonbuddySkin.setTheme("aisu")`);
console.log("BACK =" + JSON.stringify(await s.evaluate(probe)));
s.close();
