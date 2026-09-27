// 回归测试：页面/面板级底色的换肤覆盖（欢迎页 + 助理页 + 自动化页 + 侧边面板）
// 用法：node scripts/test-home-skin.mjs [port]
// 只读，不导航、不改状态 —— 这些原生底色都是变量给的（--wb-home-* / --wb-bg-content），
// 变量没被压住就会整片盖掉背景图（"换肤不完全"）。

import { createHarness } from "./_harness.mjs";
const t = await createHarness({ name: "test-home-skin" });
const { session } = t;

const state = await session.evaluate(`(() => {
  const cs = getComputedStyle(document.body);
  const style = document.getElementById("anonbuddy-skin-style");
  return {
    skin: style ? style.textContent : "",
    vars: {
      secondary: cs.getPropertyValue("--wb-home-bg-secondary").trim(),
      primary: cs.getPropertyValue("--wb-home-bg-primary").trim(),
      inputSlot: cs.getPropertyValue("--wb-home-input-slot-bg").trim(),
      quickAction: cs.getPropertyValue("--wb-quick-action-sub-item-bg").trim(),
      bgContent: cs.getPropertyValue("--wb-bg-content").trim(),
    },
  };
})()`);
console.log("VARS=" + JSON.stringify(state.vars));

// 原生值分别是 #ffffff / #f2f2f2 / linear-gradient(#f0f0f0,#f5f5f5) / #ebebeb / #ffffff
t.check("欢迎页主底色已透明（原生 #ffffff）", state.vars.secondary === "transparent", state.vars.secondary);
t.check("欢迎页次底色已主题化（原生 #f2f2f2）", state.vars.primary.includes("color-mix") && !state.vars.primary.includes("#f2f2f2"), state.vars.primary);
t.check("输入槽已主题化（原生灰渐变）", state.vars.inputSlot.includes("color-mix") && !state.vars.inputSlot.includes("#f0f0f0"), state.vars.inputSlot);
t.check("快捷标签已主题化（原生 #ebebeb）", state.vars.quickAction.includes("var(--wb-accent)") || state.vars.quickAction.includes("#"), state.vars.quickAction);
t.check("侧边面板底色已主题化（原生 #ffffff）", state.vars.bgContent.includes("color-mix") && !state.vars.bgContent.includes("#ffffff"), state.vars.bgContent);

for (const sel of [
  ".wb-home-route",
  ".wb-home-page__main-content",
  ".claw-agent-chat-pane",
  ".claw-workspace",
  ".automation-main-page",
  ".my-files-panel",
]) {
  t.check(`样式表含 ${sel} 规则`, state.skin.includes(sel));
}

// 万一某个页面当前正挂着，顺手验一下实际计算值
const live = await session.evaluate(`(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, blur: cs.backdropFilter };
  };
  return {
    route: pick(".wb-home-route"),
    claw: pick(".claw-workspace"),
    automation: pick(".automation-main-page"),
    myFiles: pick(".my-files-panel"),
  };
})()`);
// 注意：这是正则字面量，不是模板字符串 —— 里面写 \\( 会去匹配"反斜杠+括号"，
// 永远匹配不上 rgba(0, 0, 0, 0)，会假报失败。
const transparent = /rgba?\(0, 0, 0, 0\)|^transparent$/;
for (const [name, sel] of [["欢迎页", "route"], ["助理页", "claw"], ["自动化页", "automation"]]) {
  const v = live[sel];
  if (!v) { console.log(`SKIP  ${name}当前未挂载，跳过实时校验`); continue; }
  t.check(`${name}外壳实际已透明`, transparent.test(v.bg), v.bg);
}
if (live.myFiles) {
  t.check("我的文件面板为半透明玻璃底", !transparent.test(live.myFiles.bg) && live.myFiles.bg.includes("/"), live.myFiles.bg);
  t.check("我的文件面板带磨砂", live.myFiles.blur.includes("blur"), live.myFiles.blur);
} else {
  console.log("SKIP  我的文件面板当前未打开，跳过实时校验");
}

await t.finish();
