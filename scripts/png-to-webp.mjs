// 通过 WorkBuddy renderer 的 Chromium 把 PNG 编码为 webp（sips 不支持 webp 写入）
import { readFileSync, writeFileSync } from "node:fs";

const CDP = process.env.WB_CDP_URL ?? "http://127.0.0.1:9333";
const inPath = process.argv[2];
const outPath = process.argv[3];

const pngB64 = readFileSync(inPath).toString("base64");
const dataUrl = `data:image/png;base64,${pngB64}`;

const targets = (await (await fetch(`${CDP}/json/list`)).json()).filter(
  (t) => t.type === "page" && t.url.includes("renderer/index.html"),
);
if (!targets.length) throw new Error("未找到 WorkBuddy renderer，请先以 CDP 模式启动 WorkBuddy");

const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");

const expr = `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(dataUrl)};
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toDataURL("image/webp", 0.92);
})()`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
ws.close();

if (r.result?.exceptionDetails) throw new Error("转换失败: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
const webpDataUrl = r.result.result.value;
if (!webpDataUrl || !webpDataUrl.startsWith("data:image/webp")) throw new Error("未得到 webp 数据");
const b64 = webpDataUrl.replace(/^data:image\/webp;base64,/, "");
writeFileSync(outPath, Buffer.from(b64, "base64"));
const inSize = readFileSync(inPath).length;
const outSize = readFileSync(outPath).length;
console.log(`PNG ${inSize}B -> webp ${outSize}B (${Math.round((1 - outSize / inSize) * 100)}% smaller)`);
