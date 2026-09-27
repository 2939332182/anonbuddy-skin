// 回归测试：Wallpaper Engine 壁纸当主题（方案 A：file:// 直读）。
// 用法：node scripts/test-we.mjs [port]
//
// 背景见 docs/WE-INTEGRATION.md。核心结论：
//   渲染进程本身就是 file:// 页面，可以直接 <video src="file:///…"> 播本机文件（实测），
//   所以零拷贝、零存储、不碰 localStorage 配额。
//
// 本测试锁住这几件事（都是主人明确要求或踩过的坑）：
//   · 面板里有 WE 分组，且**明确标注「仅本机、不可分享」**
//   · 点一个视频壁纸 → 背景图层里出现 <video>，**默认自动播放**
//   · 悬浮小图标旁 + 面板里各有一个暂停键，两处都能控制播放，状态互相同步
//   · 静态条目（scene 退化来的 preview）不挂 <video>
//   · **切到普通主题必须把视频释放掉**（幂等红线：不能留下在后台解码的旧视频）
//
// ⚠️ 本测试跑完必须切回普通主题：背景层留着 <video> 时
//    Page.captureScreenshot 会卡住（实测），会连带把用截图做断言的 test-tunables 拖挂。

import { fileURLToPath } from "node:url";

import { createHarness } from "./_harness.mjs";
import { pickBestTexture, readCachedHero, readImageSize, resolveRepkg, sweepStrayRaw } from "../src/we-extract.mjs";

const t = await createHarness({ name: "test-we" });
const { evaluate, sleep, check, waitFor } = t;

await t.applyLast();

const openSettings = async () => {
  if (await evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`)) return true;
  await evaluate(`document.querySelector(".user-menu-trigger")?.click()`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-track-id="settings_system_entry"]')?.click()`);
  return (
    (await waitFor(() => evaluate(`Boolean(document.querySelector(".settings-modal-overlay"))`), {
      waitMs: 6000, stepMs: 200,
    })) === true
  );
};

const readState = () => evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  const video = sk.we.videoEl();
  const toggle = sk.we.toggleBtn();
  return {
    items: sk.we.items(),
    active: sk.we.active(),
    paused: sk.we.paused(),
    theme: document.documentElement.dataset.anonbuddySkin ?? null,
    hasVideo: Boolean(video),
    videoCount: document.querySelectorAll("#anonbuddy-skin-bg > video").length,
    video: sk.we.videoState(),
    toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
    toggleText: toggle ? toggle.textContent : null,
    storedWe: localStorage.getItem(sk.we.themeKey),
    storedPaused: localStorage.getItem(sk.we.pausedKey),
    bgImage: (() => { const l = document.getElementById("anonbuddy-skin-bg"); return l ? getComputedStyle(l).backgroundImage : null; })(),
  };
})()`);

// ---- 0. Node 侧：RePKG 解包模块的纯逻辑（不依赖渲染层）----
// 方案 B：RePKG 随仓库分发（MIT、NativeAOT 单文件、不需要 .NET 运行时）。
check(
  "仓库里内置了 RePKG（tools/repkg/RePKG.exe）",
  typeof resolveRepkg({ sourceRoot: process.cwd() }) === "string",
  String(resolveRepkg({ sourceRoot: process.cwd() })),
);
check(
  "找不到时返回 null（功能自动关闭，不抛异常）",
  resolveRepkg({ sourceRoot: "Z:/definitely-not-here" }) === null,
  String(resolveRepkg({ sourceRoot: "Z:/definitely-not-here" })),
);
const previewFiles = (await evaluate(`JSON.stringify(window.__anonbuddySkin.we.items().map((x) => x.previewUrl).filter(Boolean))`))
  ? JSON.parse(await evaluate(`JSON.stringify(window.__anonbuddySkin.we.items().map((x) => x.previewUrl).filter(Boolean))`))
  : [];
const previewPaths = previewFiles.slice(0, 4).map((u) => {
  try { return fileURLToPath(u); } catch { return null; }
}).filter(Boolean);
if (previewPaths.length >= 2) {
  const sizes = [];
  for (const file of previewPaths) sizes.push(await readImageSize(file));
  check("零依赖读出图片尺寸（只读文件头）", sizes.every((x) => x && x.width > 0 && x.height > 0), JSON.stringify(sizes));
  const best = await pickBestTexture(previewPaths);
  const maxArea = Math.max(...sizes.map((x) => x.width * x.height));
  check(
    "主图挑选：优先面积最大的那张",
    Boolean(best) && best.area >= maxArea * 0.5,
    JSON.stringify(best && { w: best.width, h: best.height, area: best.area }),
  );
} else {
  check("能取到预览图做尺寸解析（该组断言的前提）", false, `previewPaths=${previewPaths.length}`);
}
check("没解过包时读缓存返回 null", (await readCachedHero("0", "Z:/nope")) === null, "应返回 null");
check("残留清理在空目录上是安全空操作", (await sweepStrayRaw("Z:/nope")) === 0, "应返回 0");

// ---- 1. 目录进来了 ----
const base = await readState();
check("渲染层收到了 WE 壁纸目录", Array.isArray(base.items), typeof base.items);
const videoItems = base.items.filter((x) => x.kind === "video");
const staticItems = base.items.filter((x) => x.kind !== "video");
console.log(`   目录：共 ${base.items.length} 条（动效 ${videoItems.length} / 静态 ${staticItems.length}）`);
check(
  "每条都带 file:// 直读地址（方案 A 的核心）",
  base.items.length === 0 || base.items.every((x) => typeof x.fileUrl === "string" && x.fileUrl.startsWith("file:///")),
  JSON.stringify(base.items.slice(0, 2)),
);
check(
  "路径里的中文/空格被百分号编码（否则 file:// 取不到）",
  base.items.every((x) => !/[\s]/.test(x.fileUrl)),
  JSON.stringify(base.items.filter((x) => /[\s]/.test(x.fileUrl)).slice(0, 2)),
);

// ---- 2. 面板里的 WE 分组与「仅本机」标注 ----
const settingsOpen = await openSettings();
check("能打开设置弹窗（面板断言的前提）", settingsOpen === true, String(settingsOpen));
const paneInfo = await evaluate(`(() => {
  const sk = window.__anonbuddySkin;
  if (!sk.settings.open()) return null;
  const pane = sk.settings.pane();
  const text = pane.textContent || "";
  return {
    hasNote: text.includes("仅本机"),
    hasNoShare: text.includes("不可分享"),
    noteColor: (() => {
      const el = [...pane.querySelectorAll("div")].find((n) => (n.textContent || "").includes("仅本机"));
      return el ? getComputedStyle(el).color : null;
    })(),
    cells: pane.querySelectorAll("[data-wb-we-item]").length,
    paneToggle: pane.querySelector("[data-wb-we-pane-toggle]")?.textContent ?? null,
    groupTitle: text.includes("Wallpaper Engine"),
  };
})()`);
check("面板里有 Wallpaper Engine 分组", paneInfo?.groupTitle === true, JSON.stringify(paneInfo));
check("面板上标注了「仅本机」", paneInfo?.hasNote === true, JSON.stringify(paneInfo));
check("面板上标注了「不可分享」", paneInfo?.hasNoShare === true, JSON.stringify(paneInfo));
check(
  "当前页的条目都在面板里有格子（分页：每页 9 个）",
  paneInfo?.cells === Math.min(9, base.items.length),
  `cells=${paneInfo?.cells} items=${base.items.length}`,
);
check("面板里有暂停/播放键", typeof paneInfo?.paneToggle === "string" && paneInfo.paneToggle.length > 0, String(paneInfo?.paneToggle));

// ---- 3. 静态条目：只换背景图，不挂 video ----
if (staticItems.length) {
  await evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(staticItems[0].id)})`);
  await sleep(1500);
  const st = await readState();
  check("应用静态条目后主题 id 正确", st.theme === "we-" + staticItems[0].id, String(st.theme));
  check("静态条目不挂 <video>", st.hasVideo === false && st.videoCount === 0, JSON.stringify({ hasVideo: st.hasVideo }));
  check(
    "静态条目的预览图进了背景图层",
    typeof st.bgImage === "string" && st.bgImage.includes("file:///"),
    String(st.bgImage).slice(-70),
  );
  check("静态条目下不显示悬浮暂停键", st.toggleDisplay === "none", String(st.toggleDisplay));
} else {
  check("本机有静态 WE 条目（该组断言的前提）", false, "一条都没有");
}

// ---- 4. 视频条目：默认自动播放 ----
if (videoItems.length) {
  const pick = videoItems.reduce((a, b) => (a.sizeMB <= b.sizeMB ? a : b)); // 挑最小的，跑得快
  await evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(pick.id)})`);
  // 大视频加载要时间，等到真正能播（readyState >= 2）
  const loaded = await waitFor(
    () => evaluate(`(() => { const v = window.__anonbuddySkin.we.videoEl(); return Boolean(v && v.readyState >= 2 && v.videoWidth > 0); })()`),
    { waitMs: 20000, stepMs: 500 },
  );
  await sleep(800);
  const st = await readState();
  check("视频壁纸在背景图层里创建了 <video>", st.hasVideo === true, JSON.stringify({ hasVideo: st.hasVideo }));
  check("视频真的解码出来了（有尺寸）", loaded === true, JSON.stringify(st.video));
  check("视频是循环 + 静音 + inline（自动播放的前提）", st.video?.loop === true && st.video?.muted === true && st.video?.playsInline === true, JSON.stringify(st.video));
  check("src 是本机 file:// 直读地址（零拷贝）", String(st.video?.src ?? "").startsWith("file:///"), String(st.video?.src).slice(0, 80));
  check("**默认自动播放**（没被暂停）", st.video?.paused === false && st.paused === false, JSON.stringify({ videoPaused: st.video?.paused, paused: st.paused }));
  check("悬浮小图标旁的暂停键出现了", st.toggleDisplay === "block", String(st.toggleDisplay));
  check("主题 id 记成 we-<条目ID>", st.theme === "we-" + pick.id, String(st.theme));
  check("选中项已落盘（重启能恢复）", st.storedWe === pick.id, String(st.storedWe));

  // ---- 5. 面板里的暂停键 ----
  const panePause = await evaluate(`(() => {
    const el = document.querySelector("[data-wb-we-pane-toggle]");
    if (!el) return null;
    const before = el.textContent;
    el.click();
    return { before, after: el.textContent, videoPaused: window.__anonbuddySkin.we.videoEl()?.paused };
  })()`);
  await sleep(500);
  const paused = await readState();
  check("点面板里的暂停键能暂停视频", panePause?.videoPaused === true && paused.paused === true, JSON.stringify({ panePause, paused: paused.paused }));
  check("面板键的文案跟着变", panePause?.after === "继续播放", String(panePause?.after));
  check("暂停状态落盘", paused.storedPaused === "1", String(paused.storedPaused));

  // ---- 6. 悬浮小图标旁的暂停键 ----
  const floatResume = await evaluate(`(() => {
    const el = window.__anonbuddySkin.we.toggleBtn();
    if (!el) return null;
    el.click();
    return { text: el.textContent };
  })()`);
  await sleep(600);
  const resumed = await readState();
  check("点悬浮键能恢复播放", resumed.paused === false && resumed.video?.paused === false, JSON.stringify({ paused: resumed.paused, videoPaused: resumed.video?.paused }));
  check("两处按钮状态同步（面板键也跟着回到「暂停播放」）", (await evaluate(`document.querySelector("[data-wb-we-pane-toggle]")?.textContent`)) === "暂停播放", String(floatResume?.text));

  // ---- 7. 切到普通主题必须释放视频（幂等红线）----
  await evaluate(`window.__anonbuddySkin.setTheme("aisu")`);
  await sleep(1200);
  const afterLeave = await readState();
  check("切到普通主题后 <video> 被移除", afterLeave.videoCount === 0 && afterLeave.hasVideo === false, JSON.stringify({ videoCount: afterLeave.videoCount }));
  check("切走后 WE 选中态清空", afterLeave.active === null, String(afterLeave.active));
  check("切走后悬浮暂停键隐藏", afterLeave.toggleDisplay === "none", String(afterLeave.toggleDisplay));
  check("切走后落盘的 WE 主题也清了", afterLeave.storedWe === "", String(afterLeave.storedWe));

  // ---- 8. 反复应用不叠层（幂等）----
  for (let i = 0; i < 3; i += 1) {
    await evaluate(`window.__anonbuddySkin.we.apply(${JSON.stringify(pick.id)})`);
    await sleep(600);
  }
  const repeated = await readState();
  check("反复应用同一个 WE 壁纸只留一个 <video>（不叠层）", repeated.videoCount === 1, String(repeated.videoCount));
} else {
  check("本机有视频 WE 条目（该组断言的前提）", false, "一条都没有 —— 需要在装了 Wallpaper Engine 的机器上跑");
}

// ---- 收尾：切回普通主题 + 关面板 ----
// ⚠️ 必须切回：背景层留着 <video> 时 Page.captureScreenshot 会卡住，会拖挂 test-tunables。
await evaluate(`(() => {
  window.__anonbuddySkin.setTheme("aisu");
  window.__anonbuddySkin.settings.close();
  return true;
})()`);
await sleep(800);
const finalState = await readState();
check("收尾：背景层已无 <video>（否则截图类测试会被拖挂）", finalState.videoCount === 0, String(finalState.videoCount));
check("收尾：暂停状态已复位为播放", finalState.paused === false, String(finalState.paused));

for (const type of ["keyDown", "keyUp"]) {
  await t.send("Input.dispatchKeyEvent", {
    type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  });
}
await sleep(300);
check("收尾：设置弹窗已关闭", (await evaluate(`!document.querySelector(".settings-modal-overlay")`)) === true);

await t.finish();
