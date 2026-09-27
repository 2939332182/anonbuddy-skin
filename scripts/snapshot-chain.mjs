// 抓取侧边栏到 <html> 的完整祖先链计算样式，用于"装皮肤 / 不装皮肤"差分定位布局变化。
// 用法：node scripts/snapshot-chain.mjs <输出文件> [port]
import { writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const [outFile, portArg = "9333"] = process.argv.slice(2);
if (!outFile) {
  console.error("用法：node scripts/snapshot-chain.mjs <输出文件> [port]");
  process.exit(1);
}

const session = new CdpSession((await fetchRendererTargets(Number(portArg)))[0].webSocketDebuggerUrl);
await session.open();

const data = await session.evaluate(`(() => {
  const PROPS = ["position", "top", "left", "marginTop", "marginLeft", "paddingTop", "paddingLeft",
    "height", "minHeight", "width", "display", "overflow", "transform", "translate", "zIndex",
    "boxSizing", "borderTopWidth", "gridTemplateRows", "flexDirection", "inset"];
  const snap = (el) => {
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const style = {};
    for (const p of PROPS) style[p] = cs[p];
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || "").slice(0, 60),
      rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      style,
    };
  };
  const chain = [];
  let el = document.querySelector("[data-view-id=sidebar]");
  while (el) { chain.push(snap(el)); el = el.parentElement; }
  const bar = document.querySelector(".codebuddy-menubar")?.parentElement;
  return {
    viewport: [innerWidth, innerHeight],
    skinElement: !!document.getElementById("anonbuddy-skin-style"),
    skinLen: (document.getElementById("anonbuddy-skin-style")?.textContent || "").length,
    chain,
    titlebar: bar ? snap(bar) : null,
  };
})()`);

await writeFile(outFile, JSON.stringify(data, null, 2));
console.log(`WROTE ${outFile}  viewport=${JSON.stringify(data.viewport)}  chainLen=${data.chain.length}`);
session.close();
