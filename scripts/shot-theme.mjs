// 临时切换主题并截图
import { writeFileSync, mkdirSync } from "node:fs";
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
const PORT = Number(process.argv[2] || 9333);
const THEME = process.argv[3] || "miku-light";
const OUT = "D:/workbuddy-skin-studio/outputs/verify-20260912";
const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();
await s.evaluate(`window.__workbuddySkin.setTheme(${JSON.stringify(THEME)})`);
await new Promise((r) => setTimeout(r, 800));
mkdirSync(OUT, { recursive: true });
const shot = await s.send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 600, y: 60, width: 1000, height: 600, scale: 1 },
});
writeFileSync(`${OUT}/theme-${THEME}.png`, Buffer.from(shot.data, "base64"));
console.log("saved " + OUT + "/theme-" + THEME + ".png");
s.close();
