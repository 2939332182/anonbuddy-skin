// 注入脚本的装配器 —— 正文在 src/inject/ 下
//
// 这里原来是一个 2752 行 / 142 KB 的巨型模板字符串，改任何一处都得在几百行里
// 靠肉眼找位置，也没法单独给某一屏加高亮。现在正文按功能拆成 11 个分片，
// 本文件只负责三件事：
//   1. 校验入参、拼出 payload
//   2. 按固定顺序把分片读回来、拼成完整脚本
//   3. 在开头塞进 payload
//
// ⚠️ src/inject/*.js 不是 ES 模块，是被拼起来丢给 renderer 执行的普通脚本：
//    只能读，不要 import。分片顺序即声明顺序，后面的分片依赖前面声明的函数和常量，
//    调换顺序会在 renderer 里抛 ReferenceError（而且解析期看不出来）。
//
// 改完分片务必跑：node scripts/lint-menu.mjs
// （语法 + Node 作用域泄漏 + 关键实现点名，三样都会查）

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "inject");

const SCRIPT_PARTS = [
  "01-bootstrap.js",         // 幂等收尾、通用工具
  "02-aliases.js",           // 主题别名（右键重命名）
  "03-context-menu.js",      // 行右键菜单
  "04-appearance.js",        // 与 WorkBuddy 自带外观联动 + 反向护栏
  "05-theme-memory.js",      // 记住上次主题 / 开机默认主题
  "06-custom-image.js",      // 自定义图片：压缩、取色、持久化
  "07-wallpaper-engine.js",  // Wallpaper Engine 壁纸
  "08-copy-typewriter.js",   // 文案替换 + 逐字拆分
  "09-tunables-icon.js",     // 悬浮球位置/拖动、外观调节项、背景媒体层
  "10-settings-pane.js",     // 设置面板集成
  "11-settings-fallback.js", // 设置界面可读性兜底 + window.__anonbuddySkin
];

let cachedScript = null;

/**
 * 分片只读一次。
 *
 * 两处收尾都不能省：
 *  1. 行尾规范化。源文件是 CRLF，但 ECMAScript 规定**模板字面量里的 <CR><LF>
 *     会被当成一个 LINE FEED**，所以拆分前那段内联模板求值出来是纯 LF。改成
 *     readFileSync 读分片之后没有这层规范化了，必须手动对齐 —— 否则注入到
 *     renderer 的字节会从 LF 变成 CRLF，就不再和拆分前等价了。
 *  2. 去掉末尾换行。每个分片文件自己收尾留了一个换行让文件好看，拼进来会多出
 *     一个空行，原版模板尾部没有。
 */
function readInjectedScript() {
  if (cachedScript === null) {
    const joined = SCRIPT_PARTS.map((name) => readFileSync(join(INJECT_DIR, name), "utf8")).join("");
    const normalized = joined.replace(/\r\n?/g, "\n");
    cachedScript = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  }
  return cachedScript;
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const DEFAULT_ACCENT = "#24c9d7";
// 插件图标：允许的图片 data URL（png/jpeg/webp/gif/svg）
const ICON_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i;

// 客户端 CSS 由 Node 端模板加哨兵生成，替换后与内置主题同源，避免两套模板漂移
export const CSS_SENTINELS = {
  id: "workbuddy-custom-sentinel-id",
  hero: "data:image/png;base64,WORKBUDDYHEROSENTINEL",
  accent: "#010203",
  secondary: "#040506",
  surface: "#070809",
  text: "#0a0b0c",
};

export function buildSkinMenuScript({ entries, activeId, styleId, menuId, cssTemplate = "", restoreLast = false, iconDataUrl = null, weItems = [], weRepkgAvailable = false, activeHint = null, reportBinding = null }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("皮肤菜单至少需要一个主题");
  }
  const themes = entries.map((entry) => {
    if (!entry?.id || typeof entry.css !== "string") throw new Error("主题条目缺少 id 或 css");
    return {
      id: String(entry.id),
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : String(entry.id),
      accent: HEX_COLOR.test(entry.accent ?? "") ? entry.accent : DEFAULT_ACCENT,
      surface: typeof entry.surface === "string" ? entry.surface : "#ffffff",
      css: entry.css,
    };
  });
  if (activeId !== null && !themes.some((theme) => theme.id === activeId)) {
    throw new Error(`当前主题不在菜单列表中：${activeId}`);
  }
  const payload = JSON.stringify({
    styleId,
    menuId,
    activeId,
    restoreLast: Boolean(restoreLast),
    themes,
    cssTemplate,
    // 插件图标（可选）：给了就贴图，没给就用默认的 🎨 emoji
    icon: ICON_DATA_URL.test(iconDataUrl ?? "") ? iconDataUrl : null,
    sentinels: CSS_SENTINELS,
    // Wallpaper Engine 壁纸目录（本机路径，方案 A：file:// 直读）。
    // 只含 id/标题/类型/体积/两个 file:// URL，几 KB —— 不传媒体字节。
    weItems: Array.isArray(weItems) ? weItems.filter((x) => x && typeof x.id === "string" && typeof x.fileUrl === "string") : [],
    // 装了 RePKG 就能把 scene 的静态图从 1K 缩略图升级到 4K 原图（见 we-extract.mjs）
    weRepkgAvailable: Boolean(weRepkgAvailable),
    // 旧版单主题：id 固定 custom-upload，键 workbuddyCustomTheme（首次运行会迁移进 customListKey）
    customId: "custom-upload",
    storageKey: "workbuddyCustomTheme",
    customListKey: "workbuddyCustomThemes",
    // 外部状态文档（%LOCALAPPDATA%\AnonBuddySkin\state.json）里记着的"上次皮肤"。
    // 它是 Node 侧写入的旁路状态：常驻守护在新窗口诞生前就得决定用哪套主题，
    // 那时它还连不上任何渲染进程。渲染进程优先信它，它没记录、或者记录的皮肤
    // 已经不存在（自定义主题被删）时，才回退到 localStorage 的 LAST_KEY。
    activeHint: typeof activeHint === "string" && activeHint.length > 0 ? activeHint : null,
    // 常驻守护用 Runtime.addBinding 注册的上报通道名。一次性注入（cli apply）时是 null，
    // 脚本里取不到函数就静默跳过 —— 状态文档在那种路径下由守护自己补记。
    reportBinding: typeof reportBinding === "string" && reportBinding.length > 0 ? reportBinding : null,
    // 设置面板集成：往「功能」分组插一个入口，右侧内容区渲染我们的面板
    pluginName: "ChihayaAnon 插件",
    // 分组名直写中文即可：这个对象字面量在 Node 侧构造、再作为 payload 传进 renderer，
    // 并不在模板字符串里，所以不需要（也不能）写成双反斜杠的 \uXXXX ——
    // 写成 "\\u529f\\u80fd" 会被解析成 12 个字符的字面量，和分组标题 "功能" 永不相等，
    // 于是主匹配失效、只能落到兜底分组上（旧版恰好 groups[1] 就是「功能」，所以没暴露）。
    settingsNavGroup: "功能",
    settingsNavSelector: ".settings-navigation__group",
    // 设置弹窗的根容器。5.6.x 把设置从「主窗口内弹层」改成了「独立窗口」：
    // 外层类名随之由 .settings-modal-overlay 变成 .settings-modal--window，
    // 内层（.settings-navigation / .settings-modal__content / __panel）两版完全一致。
    // 所以这里不写死单一类名，改为按候选逐个试。
    // settingsOverlaySelector 保留下来给测试与外部脚本用，取值是两版都存在的内层容器。
    settingsRootSelectors: [".settings-modal-overlay", ".settings-modal--window", ".settings-modal"],
    settingsOverlaySelector: ".settings-modal",
    // ⚠️ 必须走 payload 传进去：DEFAULT_ACCENT 是**模块作用域**常量（本文件第 2 行），
    // 而下面返回的整段脚本是模板字符串，在 renderer 里 eval，读不到 Node 侧作用域。
    // 直接写 DEFAULT_ACCENT 会抛 ReferenceError（2026-09-19 踩过，见 scripts/lint-menu.mjs 的泄漏体检）。
    defaultAccent: DEFAULT_ACCENT,
  });

  // 头尾保持一字不差：正文分片是从原模板求值后的产物逐字节切出来的，拼接结果与拆分前完全等价。
  //
  // 外面多包一层"等 body"的守卫，是为了常驻守护那条路径（2026-09-29 实测踩坑）：
  // 守护用 Page.addScriptToEvaluateOnNewDocument 把这段脚本注册在**文档创建点**上，
  // 而那一刻 <head> 和 <body> 都还没被解析出来。正文两头都依赖它们 ——
  // 开头 `document.head.appendChild(style)`，中段 `document.body.appendChild(root)`。
  // 直接跑必然抛 TypeError，皮肤根本长不出来。
  // 症状极具迷惑性：注册调用返回成功、日志里没有任何错误，重载后却什么都没有；
  // 换成 30 字节的探针 `window.__x=1` 却能稳稳活过重载 —— 说明问题不在注册机制，
  // 在执行时机。而且只等 head 也不够：等到 head 就往下跑，会在 appendChild(body)
  // 那一行再炸一次（实测现象是 style 元素建出来了、菜单和主题都没了）。
  // 等 body：body 出现意味着 head 必然已在，一次等到位，且那时页面还没渲染出内容，
  // 首屏依然是带皮肤的。cli apply 那条路径（Runtime.evaluate）跑在早已加载完的文档上，
  // body 必然存在，走的是同一个直接分支，行为与改动前完全一致。
  return `(() => {\n  const data = ${payload};\n  const bootSkin = () => {\n${readInjectedScript()}\n  };\n  if (document.body) { bootSkin(); return; }\n  const bootWatch = new MutationObserver(() => {\n    if (!document.body) return;\n    bootWatch.disconnect();\n    bootSkin();\n  });\n  bootWatch.observe(document.documentElement || document, { childList: true, subtree: true });\n})()`;
}
