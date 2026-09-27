import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";
const s = new CdpSession((await fetchRendererTargets(Number(process.argv[2]||9333)))[0].webSocketDebuggerUrl);
await s.open();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log("条目数:", await s.evaluate(`window.__anonbuddySkin.we.items().length`));
const vids = await s.evaluate(`JSON.stringify(window.__anonbuddySkin.we.items().filter(x=>x.kind==='video').map(x=>x.id))`);
console.log("视频条目:", vids);
// 应用一个视频壁纸
const first = JSON.parse(vids)[2];
await s.evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(first)})`);
await sleep(4000);
console.log("应用后:", await s.evaluate(`JSON.stringify({
  active: window.__anonbuddySkin.we.active(),
  theme: document.documentElement.dataset.anonbuddySkin,
  video: window.__anonbuddySkin.we.videoState(),
  paused: window.__anonbuddySkin.we.paused(),
  toggleShown: (() => { const b = window.__anonbuddySkin.we.toggleBtn(); return b ? getComputedStyle(b).display : null; })(),
})`));
// 暂停
await s.evaluate(`window.__anonbuddySkin.we.setPaused(true)`);
await sleep(600);
console.log("暂停后:", await s.evaluate(`JSON.stringify({ paused: window.__anonbuddySkin.we.paused(), videoPaused: window.__anonbuddySkin.we.videoEl()?.paused })`));
await s.evaluate(`window.__anonbuddySkin.we.setPaused(false)`);
await sleep(800);
console.log("恢复播放:", await s.evaluate(`JSON.stringify({ paused: window.__anonbuddySkin.we.paused(), videoPaused: window.__anonbuddySkin.we.videoEl()?.paused })`));
s.close();
