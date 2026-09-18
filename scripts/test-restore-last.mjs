// 端到端测试：记住上次使用的主题（apply --theme last）
// 用法：node scripts/test-restore-last.mjs [port]
// 覆盖：菜单里选磁盘主题 / 自定义主题 / 原生界面后重启，以及记录失效时的兜底。
import { createHarness } from "./_harness.mjs";
import { spawnSync } from "node:child_process";

const t = await createHarness({ name: "test-restore-last" });
const MENU_ID = "workbuddy-skin-menu";
const CTX_ID = `${MENU_ID}-row-menu`;

const { session, sleep, waitFor, check } = t;

const evaluate = t.evaluate;

const openPanel = () => evaluate(`(() => { document.querySelector("#${MENU_ID} > div").style.display = "block"; return true; })()`);
const leftClick = async (x, y) => {
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(200);
};
const rowRect = (id) => evaluate(`(() => {
  const panel = document.querySelector("#${MENU_ID} > div");
  const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(id)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: el.__text.textContent };
})()`);
const state = () => evaluate(`(() => ({
  active: document.documentElement.dataset.workbuddySkin ?? null,
  lastTheme: window.__workbuddySkin.lastTheme(),
  storedLast: localStorage.getItem("workbuddySkinLastTheme"),
  customs: window.__workbuddySkin.customThemes().map((t) => t.id),
  aliases: window.__workbuddySkin.aliases(),
}))()`);
// 模拟 WorkBuddy 重启后的自动换肤
const reapply = (theme) => {
  const result = spawnSync(process.execPath, ["src/cli.mjs", "apply", "--port", String(t.port), "--theme", theme], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `apply ${theme} 失败`);
  return JSON.parse(result.stdout);
};
const clickRow = async (id) => {
  await openPanel();
  await sleep(150);
  const rect = await rowRect(id);
  if (!rect) throw new Error(`找不到行：${id}`);
  await leftClick(rect.x, rect.y);
};

const initial = await state();
console.log("INITIAL=" + JSON.stringify(initial));
const DISK = "genshin-dawn";
const custom = initial.customs[0];
if (!custom) throw new Error("需要至少一个自定义主题才能测试");

try {
  // ---- 1. 菜单里选磁盘主题 → 记下来 ----
  await clickRow(DISK);
  t.check("选磁盘主题后 lastTheme 已记录", (await state()).lastTheme === DISK, String((await state()).lastTheme));

  // ---- 2. 重启（apply --theme last）→ 恢复 ----
  let applied = reapply("last");
  t.check("last 模式注入成功", applied.applied === 1 && applied.restoreLast === true, JSON.stringify(applied));
  await sleep(200);
  t.check("重启后恢复磁盘主题", (await state()).active === DISK, String((await state()).active));

  // ---- 3. 菜单里选自定义主题 → 重启后也能恢复（本轮核心） ----
  await clickRow(custom);
  t.check("选自定义主题后 lastTheme 已记录", (await state()).lastTheme === custom, String((await state()).lastTheme));
  applied = reapply("last");
  t.check("last 模式兜底主题是磁盘主题（自定义主题不在磁盘上）", applied.themeId !== custom, applied.themeId);
  await sleep(200);
  const restoredCustom = await state();
  t.check("重启后恢复自定义主题", restoredCustom.active === custom, String(restoredCustom.active));

  // ---- 4. 选「原生界面」→ 重启后保持原生（但菜单仍在） ----
  await clickRow(null);
  t.check("选原生后 lastTheme 记为 native", (await state()).lastTheme === "__native__", String((await state()).lastTheme));
  reapply("last");
  await sleep(200);
  const native = await state();
  t.check("重启后保持原生界面", native.active === null, String(native.active));
  t.check("原生界面下菜单依然注入", (await evaluate(`!!document.getElementById("${MENU_ID}")`)) === true);

  // ---- 5. 记录失效（比如自定义主题被删）→ 退回默认主题 ----
  await evaluate(`localStorage.setItem("workbuddySkinLastTheme", "custom-已被删除")`);
  reapply("last");
  await sleep(200);
  const stale = await state();
  t.check("记录失效时退回默认主题", stale.active === "miku-488137", String(stale.active));
  t.check("失效记录被覆盖成实际生效的主题", stale.lastTheme === "miku-488137", String(stale.lastTheme));

  // ---- 6. 显式指定主题时不受 last 影响 ----
  reapply("wuthering-echo");
  await sleep(200);
  t.check("显式 --theme 仍然强制生效", (await state()).active === "wuthering-echo", String((await state()).active));
  reapply("last");
  await sleep(200);
  t.check("last 会跟着显式切换更新", (await state()).active === "wuthering-echo");
} finally {
  // 收尾：恢复用户原本的激活主题与别名，并把页面交回给 lastTheme 机制
  await evaluate(`(() => {
    const wantAliases = ${JSON.stringify(initial.aliases)};
    for (const id of Object.keys(window.__workbuddySkin.aliases())) {
      window.__workbuddySkin.renameTheme(id === "__native__" ? null : id, "");
    }
    for (const [id, name] of Object.entries(wantAliases)) {
      window.__workbuddySkin.renameTheme(id === "__native__" ? null : id, name);
    }
    return true;
  })()`);
  if (initial.lastTheme) await evaluate(`localStorage.setItem("workbuddySkinLastTheme", ${JSON.stringify(initial.lastTheme)})`);
  reapply("last");
  await sleep(200);
  if (initial.active) await evaluate(`window.__workbuddySkin.setTheme(${JSON.stringify(initial.active)})`);
  await evaluate(`(() => {
    document.querySelector("#${MENU_ID} > div").style.display = "none";
    document.getElementById(${JSON.stringify(CTX_ID)}).style.display = "none";
    return true;
  })()`);
  const final = await state();
  console.log("FINAL=" + JSON.stringify(final));
  t.check("收尾：激活主题恢复", final.active === initial.active, `${final.active} vs ${initial.active}`);
  t.check("收尾：自定义主题数量不变", final.customs.length === initial.customs.length);
  t.check("收尾：别名表恢复", JSON.stringify(final.aliases) === JSON.stringify(initial.aliases), JSON.stringify(final.aliases));
}

await t.finish();
