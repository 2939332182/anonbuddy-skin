// 生成修复验证截图
import { writeFileSync, mkdirSync } from "node:fs";
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const OUT = "D:/anonbuddy-skin/outputs/verify-20260912";
mkdirSync(OUT, { recursive: true });

const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();

const shots = [
  ["input", { x: 580, y: 870, width: 1080, height: 170, scale: 1.5 }],
  ["sidebar", { x: 0, y: 30, width: 300, height: 620, scale: 1.5 }],
];

for (const [name, clip] of shots) {
  const shot = await s.send("Page.captureScreenshot", { format: "png", clip });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log("saved " + file);
}
s.close();
