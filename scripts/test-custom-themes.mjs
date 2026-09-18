// 端到端测试：行右键菜单（重命名 / 删除）+ 多个自定义主题共存
// 用法：node scripts/test-custom-themes.mjs [port]
// 注意：全程只新增/删除测试自己造的主题，绝不碰用户已有的自定义主题与别名。

import { createHarness } from "./_harness.mjs";
const t = await createHarness({ name: "test-custom-themes" });
const MENU_ID = "workbuddy-skin-menu";
const CTX_ID = `${MENU_ID}-row-menu`;

const { session, sleep, waitFor, check } = t;

const evaluate = t.evaluate;

const openPanel = () => evaluate(`(() => { document.querySelector("#${MENU_ID} > div").style.display = "block"; return true; })()`);
const rightClick = async (x, y) => {
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1 });
  await sleep(180);
};
const leftClick = async (x, y) => {
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(180);
};
const pressEsc = async () => {
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(150);
};
const rowRect = (id) => evaluate(`(() => {
  const panel = document.querySelector("#${MENU_ID} > div");
  const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(id)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: el.__text.textContent };
})()`);
const ctxState = () => evaluate(`(() => {
  const menu = document.getElementById(${JSON.stringify(CTX_ID)});
  return { open: menu.style.display === "block", items: [...menu.children].map((el) => el.textContent) };
})()`);
const ctxItemRect = (index) => evaluate(`(() => {
  const el = document.getElementById(${JSON.stringify(CTX_ID)}).children[${index}];
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
const customState = () => evaluate(`(() => ({
  api: window.__workbuddySkin.customThemes(),
  stored: JSON.parse(localStorage.getItem("workbuddyCustomThemes") ?? "[]").map((t) => t.id),
  aliases: window.__workbuddySkin.aliases(),
  active: document.documentElement.dataset.workbuddySkin,
}))()`);

const initial = await customState();
console.log("INITIAL=" + JSON.stringify({ ids: initial.stored, active: initial.active }));
const firstCustom = initial.api[0]?.id;
if (!firstCustom) throw new Error("当前没有任何自定义主题，无法测试");
let tempId = null;
let diskTheme = null;   // 动态取，别硬编码主题 id（主题会增删）

try {
  await openPanel();
  await sleep(150);
  diskTheme = await evaluate(`(() => {
    const panel = document.querySelector("#${MENU_ID} > div");
    const customIds = window.__workbuddySkin.customThemes().map((t) => t.id);
    const el = [...panel.children].find((n) => n.__themeId && !customIds.includes(n.__themeId));
    return el ? el.__themeId : null;
  })()`);
  if (!diskTheme) throw new Error("面板里没有磁盘主题可用于测试");
  console.log("DISK_THEME=" + diskTheme);

  // ---- 1. 自定义主题行：右键菜单有两项 ----
  const customRow = await rowRect(firstCustom);
  await rightClick(customRow.x, customRow.y);
  let ctx = await ctxState();
  t.check("自定义行右键弹出菜单", ctx.open === true);
  t.check("菜单含「重命名」与「删除」", JSON.stringify(ctx.items) === JSON.stringify(["重命名", "删除"]), JSON.stringify(ctx.items));

  // ---- 2. Esc 关闭 ----
  await pressEsc();
  t.check("Esc 关闭右键菜单", (await ctxState()).open === false);

  // ---- 3. 磁盘主题行：只有「重命名」 ----
  const diskRow = await rowRect(diskTheme);
  await rightClick(diskRow.x, diskRow.y);
  ctx = await ctxState();
  t.check("磁盘主题行菜单只有「重命名」", JSON.stringify(ctx.items) === JSON.stringify(["重命名"]), JSON.stringify(ctx.items));

  // ---- 4. 菜单里点「重命名」→ 进入编辑态 ----
  const renameItem = await ctxItemRect(0);
  await leftClick(renameItem.x, renameItem.y);
  const editing = await evaluate(`(() => {
    const input = document.querySelector("#${MENU_ID} input[type=text]");
    return input ? { value: input.value, focused: document.activeElement === input } : null;
  })()`);
  t.check("点「重命名」进入编辑态", !!editing && editing.focused === true, JSON.stringify(editing));
  t.check("编辑态预填当前名称", editing?.value === diskRow.label, `${editing?.value} vs ${diskRow.label}`);
  await pressEsc();

  // ---- 5. 删除需要两次点击，第一次不落盘 ----
  await rightClick(customRow.x, customRow.y);
  const deleteItem = await ctxItemRect(1);
  await leftClick(deleteItem.x, deleteItem.y);
  ctx = await ctxState();
  t.check("首次点删除变成确认提示", ctx.items[1] === "再点一次确认删除", JSON.stringify(ctx.items));
  t.check("首次点删除不真的删", (await customState()).stored.length === initial.stored.length);

  // ---- 6. 点菜单外面关掉菜单（且不误删）——用 🎨 按钮做安全的外部点击目标 ----
  const buttonRect = await evaluate(`(() => {
    const r = document.querySelector("#${MENU_ID} button").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await leftClick(buttonRect.x, buttonRect.y);
  t.check("点外部关闭菜单", (await ctxState()).open === false);
  t.check("点外部不触发删除", (await customState()).stored.length === initial.stored.length);
  await openPanel();
  await sleep(150);

  // ---- 7. 新增自定义主题：旧的必须全部保留 ----
  const added = await evaluate(`(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 40;
    const ctx2 = canvas.getContext("2d");
    const grad = ctx2.createLinearGradient(0, 0, 64, 40);
    grad.addColorStop(0, "#ff7ad9"); grad.addColorStop(1, "#2fd6c8");
    ctx2.fillStyle = grad; ctx2.fillRect(0, 0, 64, 40);
    await window.__workbuddySkin.importFromDataUrl(canvas.toDataURL("image/png"), "测试新图");
    return window.__workbuddySkin.customThemes();
  })()`);
  tempId = added[added.length - 1].id;
  console.log("AFTER_ADD=" + JSON.stringify(added.map((t) => t.id)));
  t.check("新增后总数 +1", added.length === initial.api.length + 1, String(added.length));
  t.check("原有自定义主题一个不少", initial.api.every((t) => added.some((n) => n.id === t.id)));
  const afterAdd = await customState();
  t.check("新主题已落盘", afterAdd.stored.includes(tempId));
  t.check("新主题成为当前主题", afterAdd.active === tempId, String(afterAdd.active));

  // ---- 8. 新主题有自己的行，且行尾不再挂 × ----
  await openPanel();
  await sleep(150);
  t.check("新主题在面板里出现", !!(await rowRect(tempId)));
  const rowChildren = await evaluate(`(() => {
    const panel = document.querySelector("#${MENU_ID} > div");
    const el = [...panel.children].find((n) => n.__themeId === ${JSON.stringify(tempId)});
    return { children: el.children.length, hasDel: !!el.querySelector("[title*='删除']") };
  })()`);
  t.check("行内不再挂删除按钮（省宽度）", rowChildren.children === 2 && rowChildren.hasDel === false, JSON.stringify(rowChildren));

  // ---- 9. 给临时主题起别名，再通过右键菜单删除它（别名应一并清理）----
  await evaluate(`window.__workbuddySkin.renameTheme(${JSON.stringify(tempId)}, "临时别名")`);
  t.check("临时主题别名已写入", (await customState()).aliases[tempId] === "临时别名");

  const tempRow = await rowRect(tempId);
  await rightClick(tempRow.x, tempRow.y);
  const delTemp = await ctxItemRect(1);
  await leftClick(delTemp.x, delTemp.y);
  await leftClick(delTemp.x, delTemp.y);
  await sleep(200);
  const afterDelete = await customState();
  console.log("AFTER_DELETE=" + JSON.stringify({ ids: afterDelete.stored, active: afterDelete.active }));
  t.check("删除后总数回到原值", afterDelete.stored.length === initial.stored.length, `${afterDelete.stored.length} vs ${initial.stored.length}`);
  t.check("删除后从 localStorage 移除", !afterDelete.stored.includes(tempId));
  t.check("删除后从面板移除", (await rowRect(tempId)) === null);
  t.check("删除别名一并清理", afterDelete.aliases[tempId] === undefined, JSON.stringify(afterDelete.aliases));
  t.check("删的是当前主题 → 回到原生界面", afterDelete.active === undefined || afterDelete.active === null, String(afterDelete.active));
  t.check("用户的原有主题仍在", initial.stored.every((id) => afterDelete.stored.includes(id)));
  tempId = null;

  // ---- 10. 删不存在的 id 返回 false ----
  t.check("删除不存在的主题返回 false", (await evaluate(`window.__workbuddySkin.deleteCustomTheme("no-such-theme")`)) === false);
} finally {
  // 收尾：清掉可能残留的测试主题与别名，还原用户的激活主题
  await evaluate(`(() => {
    if (${JSON.stringify(tempId)} !== null) window.__workbuddySkin.deleteCustomTheme(${JSON.stringify(tempId)});
    const wantAliases = ${JSON.stringify(initial.aliases)};
    for (const id of Object.keys(window.__workbuddySkin.aliases())) {
      window.__workbuddySkin.renameTheme(id === "__native__" ? null : id, "");
    }
    for (const [id, name] of Object.entries(wantAliases)) {
      window.__workbuddySkin.renameTheme(id === "__native__" ? null : id, name);
    }
    document.querySelector("#${MENU_ID} > div").style.display = "none";
    document.getElementById(${JSON.stringify(CTX_ID)}).style.display = "none";
    if (${JSON.stringify(initial.active)} !== null) window.__workbuddySkin.setTheme(${JSON.stringify(initial.active)});
    return true;
  })()`);
  const final = await customState();
  console.log(`FINAL ids=${JSON.stringify(final.stored)} active=${final.active} aliases=${JSON.stringify(final.aliases)}`);
  t.check("收尾：自定义主题数量与初始一致", final.stored.length === initial.stored.length);
  t.check("收尾：别名表与初始一致", JSON.stringify(final.aliases) === JSON.stringify(initial.aliases), JSON.stringify(final.aliases));
  session.close();
}


await t.finish();
