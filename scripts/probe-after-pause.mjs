import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
const PORT = Number(process.argv[2] || 9333);
const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();
const r = await session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  return {
    i: document.querySelectorAll(".wb-home-header__title span > i").length,
    title: h1?.textContent ?? null,
    h1HTML: h1?.outerHTML?.slice(0, 300) ?? null,
    brand: document.querySelector(".logo-workbuddy-title")?.textContent ?? null,
    hasStyle: Boolean(document.getElementById("workbuddy-skin-style")),
    theme: document.documentElement.dataset.workbuddySkin ?? null,
  };
})()`);
console.log(JSON.stringify(r, null, 2));
session.close();
