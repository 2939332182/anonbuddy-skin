// 预览：临时给"自动化"加上 active 类截图，随后立即还原
import { writeFileSync, mkdirSync } from "node:fs";
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
const PORT = Number(process.argv[2] || 9333);
const OUT = "D:/anonbuddy-skin/outputs/verify-20260912";
const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();

const toggle = (add) => `(() => {
  const btn = [...document.querySelectorAll(".conversation-list-tab-button")]
    .find((b) => (b.textContent || "").includes("自动化"));
  if (btn) btn.classList.${add ? "add" : "remove"}("active");
  return !!btn;
})()`;

await s.evaluate(toggle(true));
await new Promise((r) => setTimeout(r, 700));

mkdirSync(OUT, { recursive: true });
const shot = await s.send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 0, y: 30, width: 280, height: 300, scale: 2 },
});
writeFileSync(OUT + "/sidebar-tabs.png", Buffer.from(shot.data, "base64"));
console.log("saved " + OUT + "/sidebar-tabs.png");

console.log("restored=" + await s.evaluate(toggle(false)));
s.close();
