import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CdpSession, fetchRendererTargets, waitForRendererTargets } from "./cdp-client.mjs";
import { buildSkinCss } from "./skin-css.mjs";
import { buildSkinMenuScript, CSS_SENTINELS } from "./skin-menu.mjs";

const STYLE_ID = "workbuddy-skin-style";
const MENU_ID = "workbuddy-skin-menu";
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };

// 插件图标：把素材丢进 assets/ 即可自动启用（文件名 menu-icon.* 或 icon.*，png/jpg/webp/gif/svg 都行）。
// 找不到就退回默认的 🎨 emoji。
const ICON_DIR = fileURLToPath(new URL("../assets", import.meta.url));
const ICON_BASENAMES = ["menu-icon", "icon"];

async function readMenuIcon() {
  for (const base of ICON_BASENAMES) {
    for (const [ext, mime] of Object.entries(MIME)) {
      try {
        const bytes = await readFile(join(ICON_DIR, base + ext));
        return `data:${mime};base64,${bytes.toString("base64")}`;
      } catch { /* 这个候选不存在，试下一个 */ }
    }
  }
  return null;
}

async function evaluateTargets(targets, expression, Session) {
  const values = [];
  for (const target of targets) {
    const session = new Session(target.webSocketDebuggerUrl);
    try {
      await session.open();
      values.push(await session.evaluate(expression));
    } finally {
      session.close();
    }
  }
  return values;
}

async function themeEntry(loadedTheme) {
  const bytes = await readFile(loadedTheme.heroPath);
  const mime = MIME[extname(loadedTheme.heroPath).toLowerCase()];
  if (!mime) throw new Error("不支持的 hero 图片类型");
  const heroDataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  return {
    id: loadedTheme.manifest.id,
    name: loadedTheme.manifest.name,
    accent: loadedTheme.manifest.colors?.accent,
    surface: loadedTheme.manifest.colors?.surface,
    css: buildSkinCss({ theme: loadedTheme.manifest, heroDataUrl }),
  };
}

export async function applySkin({ loadedTheme, themes, port, activeId, restoreLast = false, deps = {} }) {
  const wait = deps.waitForRendererTargets ?? waitForRendererTargets;
  const Session = deps.Session ?? CdpSession;
  const menuThemes = themes?.length ? themes : [loadedTheme];
  const entries = [];
  for (const theme of menuThemes) entries.push(await themeEntry(theme));
  const themeId = activeId ?? loadedTheme.manifest.id;
  // 自定义上传主题的客户端 CSS 模板：哨兵值占位，页面内替换，和内置主题同一套模板
  const cssTemplate = buildSkinCss({
    theme: {
      id: CSS_SENTINELS.id,
      name: "custom",
      colors: {
        accent: CSS_SENTINELS.accent,
        secondary: CSS_SENTINELS.secondary,
        surface: CSS_SENTINELS.surface,
        text: CSS_SENTINELS.text,
      },
      copy: null,
    },
    heroDataUrl: CSS_SENTINELS.hero,
  });
  const expression = buildSkinMenuScript({
    entries,
    activeId: themeId,
    styleId: STYLE_ID,
    menuId: MENU_ID,
    cssTemplate,
    restoreLast,
    iconDataUrl: await readMenuIcon(),
  });
  const targets = await wait(port, {
    timeoutMs: deps.waitTimeoutMs ?? 20_000,
    pollMs: deps.pollMs ?? 500,
  });
  const values = await evaluateTargets(targets, expression, Session);
  return {
    applied: values.length,
    themeId,
    restoreLast,
    menuThemes: entries.map(({ id }) => id),
    targets: targets.map(({ id }) => id),
  };
}

export async function removeSkin({ port, deps = {} }) {
  const fetchTargets = deps.fetchRendererTargets ?? fetchRendererTargets;
  const Session = deps.Session ?? CdpSession;
  // 注入脚本改了侧边栏应用名和欢迎页主标题，还把主标题拆成了逐字节点，
  // 卸载时要一起还原（copy.restore 会先停观察器再合并节点，顺序不能反），
  // 否则暂停皮肤后文案和 DOM 结构会留着 —— 用户会以为皮肤没卸载干净。
  const expression = `(() => {
    window.__workbuddySkin?.copy?.restore?.();
    document.getElementById(${JSON.stringify(STYLE_ID)})?.remove();
    document.getElementById(${JSON.stringify(MENU_ID)})?.remove();
    delete document.documentElement.dataset.workbuddySkin;
    delete window.__workbuddySkin;
    return true;
  })()`;
  const targets = await fetchTargets(port);
  const values = await evaluateTargets(targets, expression, Session);
  return { removed: values.length };
}

export async function skinStatus({ port, deps = {} }) {
  const fetchTargets = deps.fetchRendererTargets ?? fetchRendererTargets;
  const Session = deps.Session ?? CdpSession;
  const expression = `(() => ({
    installed: Boolean(document.getElementById(${JSON.stringify(STYLE_ID)})),
    menu: Boolean(document.getElementById(${JSON.stringify(MENU_ID)})),
    themeId: document.documentElement.dataset.workbuddySkin ?? null
  }))()`;
  const targets = await fetchTargets(port);
  return evaluateTargets(targets, expression, Session);
}
