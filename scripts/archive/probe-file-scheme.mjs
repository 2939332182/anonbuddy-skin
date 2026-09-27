// 决定性探查：WorkBuddy 渲染进程能否直接加载本机 file:// 媒体（图片 / 视频）。
// 这决定了「WE 壁纸当皮肤」是走 file:// 直读、还是必须由 Node 端搬运字节。
// 用法：node scripts/archive/probe-file-scheme.mjs [port]
import { fetchRendererTargets, CdpSession } from "../../src/cdp-client.mjs";

const PORT = Number(process.argv[2] || 9333);
const session = new CdpSession((await fetchRendererTargets(PORT))[0].webSocketDebuggerUrl);
await session.open();

const IMG = "file:///D:/steam/steamapps/workshop/content/431960/2486007270/preview.jpg";
const VID = "file:///D:/steam/steamapps/workshop/content/431960/2847166295/20s%E6%85%A2_1.mp4";
const GIF = "file:///D:/steam/steamapps/workshop/content/431960/2847166295/preview.gif";

const result = await session.evaluate(`(async () => {
  const out = {
    href: location.href,
    protocol: location.protocol,
    origin: location.origin,
    // 关键：页面能不能发 file:// 请求
    canFetchFile: null,
  };
  try {
    await fetch(${JSON.stringify(IMG)});
    out.canFetchFile = "ok";
  } catch (e) { out.canFetchFile = String(e).slice(0, 120); }

  // 图片直读
  out.image = await new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve("timeout"), 4000);
    img.onload = () => { clearTimeout(t); resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(t); resolve({ ok: false, err: "onerror" }); };
    img.src = ${JSON.stringify(IMG)};
  });

  // GIF 直读
  out.gif = await new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve("timeout"), 4000);
    img.onload = () => { clearTimeout(t); resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(t); resolve({ ok: false, err: "onerror" }); };
    img.src = ${JSON.stringify(GIF)};
  });

  // 视频直读（只等元数据，不播完）
  out.video = await new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "metadata";
    const t = setTimeout(() => resolve("timeout"), 6000);
    v.onloadedmetadata = () => { clearTimeout(t); resolve({ ok: true, w: v.videoWidth, h: v.videoHeight, dur: Math.round(v.duration * 10) / 10 }); };
    v.onerror = () => { clearTimeout(t); resolve({ ok: false, err: (v.error && v.error.code) || "onerror" }); };
    v.src = ${JSON.stringify(VID)};
  });
  return out;
})()`);

console.log(JSON.stringify(result, null, 1));
session.close();
