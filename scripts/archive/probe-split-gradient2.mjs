// 验证：用"固定背景尺寸 + 按字偏移"能否让拆字后的渐变跨字连续
// 用法：node scripts/probe-split-gradient2.mjs [port]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

const result = await session.evaluate(`(() => {
  const host = document.createElement("div");
  host.id = "grad-probe2";
  host.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;background:#fff;padding:20px;font:600 40px/56px 'PingFang SC',sans-serif;";
  document.body.appendChild(host);

  const TEXT = "探索未至之境";
  const GRAD = "linear-gradient(100deg,#8a4030,#ffd0c0 44%,#8a4030)";

  // 参考：整串不拆
  const ref = document.createElement("div");
  const rs = document.createElement("span");
  rs.textContent = TEXT;
  rs.style.cssText = "background-image:" + GRAD + ";-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;";
  ref.appendChild(rs);
  host.appendChild(ref);

  // 实验：逐字 + 固定背景尺寸 + 按字偏移
  const wrap = document.createElement("div");
  const outer = document.createElement("span");
  outer.style.cssText = "display:inline-block;position:relative;";
  const inner = document.createElement("span");
  inner.style.cssText = "display:inline-block;";

  const chars = [...TEXT];
  const spans = [];
  for (const ch of chars) {
    const s = document.createElement("span");
    s.textContent = ch;
    s.style.cssText = "display:inline-block;background-image:" + GRAD + ";-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;background-repeat:no-repeat;";
    inner.appendChild(s);
    spans.push(s);
  }
  outer.appendChild(inner);
  wrap.appendChild(outer);
  host.appendChild(wrap);

  // 量出总宽，然后给每个字设 background-size = 总宽，position-x = -该字左偏移
  const total = inner.getBoundingClientRect().width;
  const innerLeft = inner.getBoundingClientRect().left;
  const detail = [];
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    const offset = r.left - innerLeft;
    s.style.backgroundSize = total + "px 100%";
    s.style.backgroundPosition = (-offset) + "px 0";
    detail.push({ ch: s.textContent, offset: Math.round(offset*10)/10, w: Math.round(r.width*10)/10 });
  }

  const out = {
    totalWidth: Math.round(total*10)/10,
    chars: detail,
    // 逐字检查最终 bgSize/bgPos
    final: spans.map((s) => {
      const cs = getComputedStyle(s);
      return { ch: s.textContent, bgSize: cs.backgroundSize, bgPos: cs.backgroundPosition };
    }),
  };
  // 先留着 host 供截图，稍后由调用方删除
  window.__gradProbeHost = host;
  return JSON.stringify(out, null, 2);
})()`);

console.log("===== 固定背景尺寸 + 按字偏移 =====");
console.log(result);

// 截图对比
const box = await session.evaluate(`(() => {
  const h = document.getElementById("grad-probe2");
  const r = h.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
})()`);
const shot = await session.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
const { writeFile, mkdir } = await import("node:fs/promises");
await mkdir("outputs/verify-title", { recursive: true });
await writeFile("outputs/verify-title/gradient-compare.png", Buffer.from(shot.data, "base64"));
console.log("\n截图: outputs/verify-title/gradient-compare.png（上=整串基线，下=逐字+偏移）");

// 清理
await session.evaluate(`window.__gradProbeHost?.remove(); delete window.__gradProbeHost;`);

session.close();
