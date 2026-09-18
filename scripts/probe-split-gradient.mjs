// 验证：逐字拆分后，渐变是否每个字都重新开始（那样会变成"每字一色块"而不是整行渐变）
// 用法：node scripts/probe-split-gradient.mjs [port]
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

// 在页面里注入一个对照实验容器：同一串文字，两种拆法
const result = await session.evaluate(`(() => {
  const host = document.createElement("div");
  host.id = "grad-probe";
  host.style.cssText = "position:fixed;left:-9999px;top:0;font:600 29px/42px 'PingFang SC',sans-serif;letter-spacing:.1em;";
  document.body.appendChild(host);

  const mk = (label, build) => {
    const box = document.createElement("div");
    const t = document.createElement("div");
    t.textContent = label;
    box.appendChild(t);
    build(box);
    host.appendChild(box);
    return box;
  };

  // A：不拆，整串一个 span（基线）
  mk("A整串", (box) => {
    const s = document.createElement("span");
    s.textContent = "探索未至之境";
    s.style.cssText = "background-image:linear-gradient(100deg,#8a4030,#ffd0c0 44%,#8a4030);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;";
    box.appendChild(s);
  });

  // B：拆成逐字 span，每个字各自声明渐变
  mk("B逐字各自声明", (box) => {
    const wrap = document.createElement("span");
    for (const ch of "探索未至之境") {
      const s = document.createElement("span");
      s.textContent = ch;
      s.style.cssText = "background-image:linear-gradient(100deg,#8a4030,#ffd0c0 44%,#8a4030);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;";
      wrap.appendChild(s);
    }
    box.appendChild(wrap);
  });

  // C：拆成逐字 span，外层声明渐变，内层 background-image:inherit
  mk("C逐字继承", (box) => {
    const wrap = document.createElement("span");
    wrap.style.cssText = "background-image:linear-gradient(100deg,#8a4030,#ffd0c0 44%,#8a4030);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;";
    for (const ch of "探索未至之境") {
      const s = document.createElement("span");
      s.textContent = ch;
      s.style.cssText = "background-image:inherit;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;";
      wrap.appendChild(s);
    }
    box.appendChild(wrap);
  });

  // 检查每个字 span 的实际背景尺寸/位置
  const out = {};
  for (const box of host.children) {
    const chars = box.querySelectorAll("span span");
    out[box.firstChild.textContent] = [...chars].map((c) => {
      const cs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      return { ch: c.textContent, w: Math.round(r.width * 10) / 10, bgSize: cs.backgroundSize, bgPos: cs.backgroundPosition };
    });
  }
  host.remove();
  return JSON.stringify(out, null, 2);
})()`);

console.log("===== 渐变背景盒子尺寸对比 =====");
console.log(result);

session.close();
