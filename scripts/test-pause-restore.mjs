// 验证 pause（卸载皮肤）后：文案还原、逐字拆分合并回去、观察器与定时器清理干净
// 用法：node scripts/test-pause-restore.mjs [port]
// 会临时 pause + 重新 apply，收尾放 try/finally 保证状态还原。
import {
  createHarness,
  probeSkinState,
  NATIVE_TITLES,
  NATIVE_BRAND,
  SKIN_TITLE,
  SKIN_BRAND,
} from "./_harness.mjs";

const t = await createHarness({ name: "test-pause-restore" });

await t.gotoHome();
await t.waitFor(async () => (await probeSkinState(t.session)).charCount > 1, { waitMs: 6000 });

const before = await probeSkinState(t.session);
console.log("装皮肤时:", JSON.stringify({ title: before.titleText, chars: before.charCount, brand: before.brandText }));

// 还原目标：用户当前主题（通常是 localStorage 里的 custom-*）
const restoreThemeId = before.themeId;

try {
  // ---- pause ----
  await t.removeSkin();
  // 等"还原完成"这个条件成立，而不是死等固定时长
  const paused = await t.waitFor(async () => {
    const s = await probeSkinState(t.session);
    return s.charCount === 0 && s.titleText !== SKIN_TITLE ? s : null;
  });
  console.log("\npause 后:", JSON.stringify({ title: paused.titleText, chars: paused.charCount, brand: paused.brandText }));

  t.check("pause 后样式表已移除", !paused.hasStyle);
  t.check("pause 后菜单已移除", !paused.hasMenu);
  t.check("pause 后注入 API 已清理", !paused.hasApi);
  t.check("pause 后逐字节点已合并回文本", paused.charCount === 0, `残留 ${paused.charCount} 个字节点`);
  // 原生文案有两个变体（半角/全角逗号），中英混排时用哪个由 i18n 决定 —— 断言"回到原生之一"即可
  t.check("pause 后标题文案还原为原生", NATIVE_TITLES.includes(paused.titleText), paused.titleText);
  t.check("pause 后侧边栏应用名还原为原生", paused.brandText === NATIVE_BRAND, paused.brandText);
  t.check("pause 后 h1 内不再是逐字 <i>", !(paused.titleHTML ?? "").includes("<i"), (paused.titleHTML ?? "").slice(0, 120));
} finally {
  // ---- 恢复：走 --theme last 正常恢复路径 ----
  await t.applyLast();
  const restored = await t.waitFor(async () => {
    const s = await probeSkinState(t.session);
    return s.charCount > 1 && s.titleText === SKIN_TITLE && s.themeId === restoreThemeId ? s : null;
  });
  console.log("\n恢复后:", JSON.stringify({
    title: restored.titleText, chars: restored.charCount,
    brand: restored.brandText, theme: restored.themeId,
  }));

  t.check("恢复后逐字拆分重新生效", restored.charCount > 1, `${restored.charCount} 个字节点`);
  t.check("恢复后标题文案为新文案", restored.titleText === SKIN_TITLE, restored.titleText);
  t.check("恢复后侧边栏应用名恢复", restored.brandText === SKIN_BRAND, restored.brandText);
  t.check("恢复后主题回到用户原主题", restored.themeId === restoreThemeId, `${restored.themeId} vs ${restoreThemeId}`);
}

await t.finish();
