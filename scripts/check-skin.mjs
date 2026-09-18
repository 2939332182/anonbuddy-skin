// 综合诊断：注入的规则是否生效 + 仍未覆盖的不透明元素
import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";
const PORT = Number(process.argv[2] || 9333);
const MIN_AREA = Number(process.argv[3] || 20000);
const targets = await fetchRendererTargets(PORT);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();

const expr = `(() => {
  const alpha = (c) => {
    if (!c || c === "transparent") return 0;
    let m = /rgba?\\(\\s*([\\d.]+)[,\\/\\s]+([\\d.]+)[,\\/\\s]+([\\d.]+)(?:[,/\\s]+([\\d.]+%?))?\\s*\\)/.exec(c);
    if (m) return m[4] === undefined ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    m = /color\\(\\s*srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*(?:\\/\\s*([\\d.]+%?))?\\s*\\)/.exec(c);
    if (m) return m[4] === undefined ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    if (c.indexOf("color(") === 0) return 1;
    return 0;
  };
  const rows = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (alpha(cs.backgroundColor) < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < ${MIN_AREA}) continue;
    if (el.closest("#workbuddy-skin-menu")) continue;
    rows.push({ t: el.tagName, id: el.id || "", c: (el.className || "").toString().slice(0, 40),
      bg: cs.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) });
  }
  rows.sort((a, b) => b.w * b.h - a.w * a.h);
  const style = document.getElementById("workbuddy-skin-style");
  const css = style ? style.textContent : "";
  const probe = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).backgroundColor : "NO_ELEMENT";
  };
  return {
    theme: document.documentElement.dataset.workbuddySkin ?? null,
    styleExists: !!style,
    cssLength: css.length,
    hasToolbarRule: css.includes("cr-input-toolbar__right"),
    hasInputRule: css.includes("cr-input-container"),
    hasWindowControlsRule: css.includes("workbuddy-window-controls"),
    hasTabActiveRule: css.includes("conversation-list-tab-button.active"),
    hasTabBaseRule: css.includes(".conversation-list-tab-button {"),
    inputContainer: probe(".cr-input-container"),
    toolbarRight: probe(".cr-input-toolbar__right"),
    todoMenuActive: getComputedStyle(document.body).getPropertyValue("--wb-todo-menu-bg-active").trim(),
    todoMenuHover: getComputedStyle(document.body).getPropertyValue("--wb-todo-menu-bg-hover").trim(),
    opaque: rows.slice(0, 20),
  };
})()`;

const r = await s.evaluate(expr);
console.log("theme=" + r.theme + " styleExists=" + r.styleExists + " cssLen=" + r.cssLength);
console.log("rules: toolbar=" + r.hasToolbarRule + " input=" + r.hasInputRule + " winControls=" + r.hasWindowControlsRule + " tabActive=" + r.hasTabActiveRule + " tabBase=" + r.hasTabBaseRule);
console.log("inputContainer=" + r.inputContainer);
console.log("toolbarRight=" + r.toolbarRight);
console.log("todoMenu: active=" + r.todoMenuActive + "  hover=" + r.todoMenuHover);
console.log("--- opaque (area>=" + MIN_AREA + ") ---");
for (const e of r.opaque) console.log([e.t, e.id, e.c, e.bg, e.w + "x" + e.h, "x=" + e.x, "y=" + e.y].join(" | "));
s.close();
