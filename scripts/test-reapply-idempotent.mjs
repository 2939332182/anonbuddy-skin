// 回归测试：反复 apply 不能泄漏旧实例。
// 背景（踩过的坑）：apply 每次都会 eval 一遍整段注入脚本，旧版本只删了 #workbuddy-skin-menu
// DOM 节点，却没停掉旧实例的 MutationObserver + 1.5s setInterval。于是每 apply 一次就多一个
// 活的旧实例，它们会持续把主标题拆成逐字节点 —— 表现是 pause 时已经合并好的文本被"拆回去"，
// 看起来像 restore 完全失效（第一次 pause 有效，之后全部无效）。
// 这个测试就是守住"重复注入后 pause 仍能彻底还原"。
// 收尾放 try/finally，保证状态中性。

import { createHarness, NATIVE_TITLES, SKIN_TITLE } from "./_harness.mjs";
import { applySkin } from "../src/injector.mjs";

const t = await createHarness({ name: "test-reapply-idempotent" });
const { session, sleep, waitFor, check } = t;

const probe = () => session.evaluate(`(() => {
  const h1 = document.querySelector(".wb-home-header__title");
  return {
    title: h1?.textContent?.trim() ?? null,
    chars: document.querySelectorAll(".wb-home-header__title span > i").length,
    brand: document.querySelector(".logo-workbuddy-title")?.textContent?.trim() ?? null,
    hasStyle: Boolean(document.getElementById("workbuddy-skin-style")),
    hasMenu: Boolean(document.getElementById("workbuddy-skin-menu")),
    hasApi: Boolean(window.__workbuddySkin),
    menuRoots: document.querySelectorAll("#workbuddy-skin-menu").length,
    styleEls: document.querySelectorAll("#workbuddy-skin-style").length,
    themeId: document.documentElement.dataset.workbuddySkin ?? null,
  };
})()`);

await session.evaluate(`(() => {
  [...document.querySelectorAll("[data-view-id=sidebar] button")]
    .find((b) => (b.textContent || "").trim().endsWith("新建任务"))?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1500));

const menuThemes = await t.loadMenuThemes();
const fallback = menuThemes.find((x) => x.manifest.id === "miku-488137") ?? menuThemes[0];

const before = await probe();
const restoreThemeId = before.themeId;

try {
  // 连续 apply 4 次 —— 每次都应幂等，不能叠加实例
  for (let i = 0; i < 4; i += 1) {
    await applySkin({
      loadedTheme: fallback, themes: menuThemes, port: t.port,
      activeId: fallback.manifest.id, restoreLast: true,
    });
    await waitFor(async () => {
      const s = await probe();
      return s.chars === 6 && s.hasStyle && s.hasMenu ? s : null;
    });
  }
  const afterReapply = await probe();
  console.log("\n4 次 apply 后:", JSON.stringify(afterReapply));
  t.check("重复 apply 未叠加菜单节点", afterReapply.menuRoots === 1, `${afterReapply.menuRoots} 个`);
  t.check("重复 apply 未叠加样式表", afterReapply.styleEls === 1, `${afterReapply.styleEls} 个`);
  t.check("重复 apply 后仍只有一份逐字节点", afterReapply.chars === 6, `${afterReapply.chars} 个`);

  // 关键：多次 apply 之后 pause 仍要能彻底还原（旧实例必须已全部停机）
  await t.removeSkin();
  // 等"还原完成"条件成立，而不是死等固定时长
  const paused = await waitFor(async () => {
    const s = await probe();
    return s.chars === 0 && NATIVE_TITLES.includes(s.title) && !s.hasStyle ? s : null;
  });
  console.log("pause 后:", JSON.stringify(paused));
  t.check("多次 apply 后 pause 仍能合并逐字节点", paused.chars === 0, `残留 ${paused.chars} 个`);
  t.check("多次 apply 后 pause 仍能还原标题", NATIVE_TITLES.includes(paused.title), paused.title);
  t.check("多次 apply 后 pause 仍能还原应用名", paused.brand === "WorkBuddy AI", paused.brand);
  t.check("多次 apply 后 pause 仍能移除样式表", !paused.hasStyle);
  t.check("多次 apply 后 pause 仍能移除菜单", !paused.hasMenu);
} finally {
  await t.applyLast();
  const restored = await waitFor(async () => {
    const s = await probe();
    return s.chars === 6 && s.themeId === restoreThemeId ? s : null;
  });
  console.log("收尾恢复:", JSON.stringify({ theme: restored.themeId, chars: restored.chars, title: restored.title }));
  t.check("收尾：主题回到用户原主题", restored.themeId === restoreThemeId, `${restored.themeId} vs ${restoreThemeId}`);
  t.check("收尾：逐字拆分重新生效", restored.chars === 6, `${restored.chars} 个`);
}

await t.finish();
