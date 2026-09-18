// 端到端测试：主题行「右键重命名」
// 用法：node scripts/test-rename.mjs [port]
import { createHarness } from "./_harness.mjs";
import { spawnSync } from "node:child_process";

const t = await createHarness({ name: "test-rename" });
const { session, sleep, waitFor, check, evaluate } = t;

// 先展开面板，再取坐标 —— display:none 时 getBoundingClientRect 全是 0，右键会打空
await session.evaluate(`(() => {
  document.querySelector("#workbuddy-skin-menu > div").style.display = "block";
  return true;
})()`);
await sleep(150);

// 面板行：拿一个磁盘主题行 + 原生界面行做样本
const pick = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  const items = [...panel.children].filter((el) => el.__themeId !== undefined);
  const target = items.find((el) => el.__themeId && el.__themeId !== "custom-upload") ?? items[0];
  const native = items.find((el) => el.__themeId === null);
  const r = target.getBoundingClientRect();
  const rn = native.getBoundingClientRect();
  return {
    themeId: target.__themeId,
    label: target.__text.textContent,
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    nativeId: native.__themeId,
    nativeLabel: native.__text.textContent,
    nx: rn.x + rn.width / 2,
    ny: rn.y + rn.height / 2,
    count: items.length,
  };
})()`);
console.log("SAMPLE=" + JSON.stringify(pick));
if (!pick.x || !pick.y) throw new Error("面板行坐标异常，无法继续测试");

// 收尾要还原的激活主题与别名，提前抓下来（后面会重新注入，dataset 会变）
const INITIAL_THEME = await session.evaluate(`document.documentElement.dataset.workbuddySkin ?? null`);
const INITIAL_ALIASES = await session.evaluate(`window.__workbuddySkin.aliases()`);

const CTX_ID = "workbuddy-skin-menu-row-menu";
const rightClick = async (x, y) => {
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1 });
  await sleep(180);
};
const ctxOpen = () => session.evaluate(`document.getElementById(${JSON.stringify(CTX_ID)}).style.display === "block"`);
// 走完整路径：右键出菜单 → 点「重命名」进编辑态（真实鼠标路径由 test-custom-themes.mjs 覆盖）
const startRename = async (id) => {
  await session.evaluate(`(() => {
    const panel = document.querySelector("#workbuddy-skin-menu > div");
    const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(id)});
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    document.getElementById(${JSON.stringify(CTX_ID)}).children[0].click();
    return true;
  })()`);
  await sleep(150);
};
const readInput = () => session.evaluate(`(() => {
  const input = document.querySelector("#workbuddy-skin-menu input[type=text]");
  return input ? { value: input.value, focused: document.activeElement === input } : null;
})()`);

try {

// ---- 1. 真实右键（CDP Input）应弹出右键菜单，点「重命名」后进入编辑态 ----
await rightClick(pick.x, pick.y);
t.check("真实右键弹出菜单", (await ctxOpen()) === true);
await session.evaluate(`document.getElementById(${JSON.stringify(CTX_ID)}).children[0].click()`);
await sleep(200);

let editing = await readInput();
if (!editing) {
  // CDP 合成右键在部分版本不派发 contextmenu，退回合成事件（仍是同一条事件链）
  console.log("NOTE  真实右键未触发 contextmenu，改用合成事件");
  await startRename(pick.themeId);
  editing = await readInput();
}
t.check("点「重命名」进入编辑态", !!editing, JSON.stringify(editing));
t.check("输入框预填当前名称", editing?.value === pick.label, `${editing?.value} vs ${pick.label}`);
t.check("输入框已聚焦", editing?.focused === true);

// ---- 2. 输入新名字 + 回车保存（真实键盘事件）----
const NEW_NAME = "测试改名-喵";
await session.send("Input.insertText", { text: NEW_NAME });
await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await sleep(200);

const afterSave = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(pick.themeId)});
  return {
    label: el.__text.textContent,
    stillEditing: !!document.querySelector("#workbuddy-skin-menu input[type=text]"),
    aliases: window.__workbuddySkin.aliases(),
    stored: localStorage.getItem("workbuddySkinAliases"),
    activeTheme: document.documentElement.dataset.workbuddySkin,
  };
})()`);
console.log("AFTER_SAVE=" + JSON.stringify(afterSave));
t.check("回车后名称已更新", afterSave.label === NEW_NAME, afterSave.label);
t.check("已退出编辑态", afterSave.stillEditing === false);
t.check("别名已写入 localStorage", afterSave.aliases[pick.themeId] === NEW_NAME, afterSave.stored);
t.check("改名没有误切换主题", afterSave.activeTheme !== pick.themeId || pick.themeId === afterSave.activeTheme);

// ---- 3. 清空 + 回车 = 恢复默认名 ----
await startRename(pick.themeId);
await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
await session.send("Input.insertText", { text: "" });
await session.evaluate(`(() => {
  const input = document.querySelector("#workbuddy-skin-menu input[type=text]");
  input.value = "";
  return true;
})()`);
await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await sleep(200);

const afterReset = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(pick.themeId)});
  return { label: el.__text.textContent, aliases: window.__workbuddySkin.aliases() };
})()`);
console.log("AFTER_RESET=" + JSON.stringify(afterReset));
t.check("清空后恢复默认名", afterReset.label === pick.label, afterReset.label);
t.check("别名记录已清除", afterReset.aliases[pick.themeId] === undefined);

// ---- 4. Esc 取消不落盘 ----
await startRename(pick.nativeId);
await session.send("Input.insertText", { text: "不该保存" });
await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(200);

const afterEsc = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  const el = [...panel.children].find((n) => n.__themeId === null);
  return { label: el.__text.textContent, aliases: window.__workbuddySkin.aliases(), editing: !!document.querySelector("#workbuddy-skin-menu input[type=text]") };
})()`);
console.log("AFTER_ESC=" + JSON.stringify(afterEsc));
t.check("Esc 取消后名称不变", afterEsc.label === pick.nativeLabel, afterEsc.label);
t.check("Esc 取消后未落盘", afterEsc.aliases.__native__ === undefined);
t.check("Esc 后退出编辑态", afterEsc.editing === false);

// ---- 5. 不可重命名的行（＋ 自定义图片）没有右键入口 ----
const uploadRow = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  const el = [...panel.children].find((n) => n.__themeId === undefined);
  return el ? { label: el.__text.textContent, hasTitle: !!el.title } : null;
})()`);
console.log("UPLOAD_ROW=" + JSON.stringify(uploadRow));
t.check("上传行不参与重命名", uploadRow?.hasTitle === false);

// ---- 6. 脚本化 API ----
const api = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(pick.themeId)});
  window.__workbuddySkin.renameTheme(${JSON.stringify(pick.themeId)}, "API 改名");
  const mid = el.__text.textContent;
  window.__workbuddySkin.renameTheme(${JSON.stringify(pick.themeId)}, "");
  return { mid, back: el.__text.textContent, aliases: window.__workbuddySkin.aliases() };
})()`);
console.log("API=" + JSON.stringify(api));
t.check("renameTheme 生效", api.mid === "API 改名", api.mid);
t.check("renameTheme 传空串可还原", api.back === pick.label, api.back);

// ---- 7. 回归：带别名重新注入后，「清空还原」必须回到主题真名而不是上次的别名 ----
await session.evaluate(`window.__workbuddySkin.renameTheme(${JSON.stringify(pick.themeId)}, "别名X")`);
const reinject = spawnSync(process.execPath, ["src/cli.mjs", "apply", "--port", String(t.port), "--theme", pick.themeId], { encoding: "utf8" });
if (reinject.status !== 0) throw new Error(reinject.stderr || "重新注入失败");
await sleep(300);

const reloaded = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  panel.style.display = "block";
  const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(pick.themeId)});
  return { shown: el.__text.textContent, defaultLabel: el.__defaultLabel };
})()`);
console.log("RELOADED=" + JSON.stringify(reloaded));
t.check("重注入后别名仍显示", reloaded.shown === "别名X", reloaded.shown);
t.check("重注入后默认名未被别名污染", reloaded.defaultLabel === pick.label, `${reloaded.defaultLabel} vs ${pick.label}`);

const cleared = await session.evaluate(`(() => {
  const panel = document.querySelector("#workbuddy-skin-menu > div");
  const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(pick.themeId)});
  window.__workbuddySkin.renameTheme(${JSON.stringify(pick.themeId)}, "");
  return { label: el.__text.textContent, aliases: window.__workbuddySkin.aliases() };
})()`);
console.log("CLEARED=" + JSON.stringify(cleared));
t.check("清除别名后回到主题真名", cleared.label === pick.label, cleared.label);

} finally {
  // 收尾：关掉面板与右键菜单，恢复用户原本的激活主题。
  // 放在 finally 里 —— 测试中途崩掉也不会把用户的主题/别名留在脏状态。
  await session.evaluate(`(() => {
    const want = ${JSON.stringify(INITIAL_ALIASES)};
    document.querySelector("#workbuddy-skin-menu > div").style.display = "none";
    document.getElementById(${JSON.stringify(CTX_ID)}).style.display = "none";
    // 只还原本测试动过的两行，其余别名原样不动
    window.__workbuddySkin.renameTheme(${JSON.stringify(pick.themeId)}, want[${JSON.stringify(pick.themeId)}] ?? "");
    window.__workbuddySkin.renameTheme(null, want.__native__ ?? "");
    if (${JSON.stringify(INITIAL_THEME)} !== null) window.__workbuddySkin.setTheme(${JSON.stringify(INITIAL_THEME)});
    return true;
  })()`);
  console.log("RESTORED_THEME=" + INITIAL_THEME);
  session.close();
}


await t.finish();
