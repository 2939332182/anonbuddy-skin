import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CdpSession, fetchRendererTargets, waitForRendererTargets } from "./cdp-client.mjs";
import { REPORT_BINDING } from "./constants.mjs";
import { readActiveId } from "./active-state.mjs";
import { buildSkinCss } from "./skin-css.mjs";
import { buildSkinMenuScript, CSS_SENTINELS } from "./skin-menu.mjs";
import { scanAll as scanWeLibrary, toFileUrl } from "./we-library.mjs";
import { readCachedHero, resolveCacheRoot, resolveRepkg } from "./we-extract.mjs";

const STYLE_ID = "anonbuddy-skin-style";
const MENU_ID = "anonbuddy-skin-menu";
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

/**
 * 组装注入载荷 —— 只产出脚本文本，不连任何 CDP。
 *
 * 抽出来的原因：常驻守护（skin-guard.mjs）必须在一个渲染进程**诞生之前**
 * 就拿到脚本文本（用来 Page.addScriptToEvaluateOnNewDocument），那一刻它
 * 既不知道有几个 target、也没连上任何 target。
 */
export async function buildInjectionPayload({ loadedTheme, themes, activeId, restoreLast = false, weItems = null, warmWeCache = false, deps = {} }) {
  const menuThemes = themes?.length ? themes : [loadedTheme];
  const entries = [];
  for (const theme of menuThemes) entries.push(await themeEntry(theme));
  const themeId = activeId ?? loadedTheme.manifest.id;

  // WE 壁纸目录（只读盘点，只传路径不传字节）。
  // ⚠️ 放在这里而不是 cli.mjs：applySkin 是**所有**注入路径的汇合点 ——
  //    测试的 applyLast() 是直接调它的，只挂在 CLI 上会漏（踩过：目录变 0 条）。
  // 扫描失败不阻塞换肤，只是面板里少一组。
  let resolvedWe = weItems;
  let weMeta = null;
  if (!Array.isArray(resolvedWe)) {
    try {
      const scanned = await (deps.scanWeLibrary ?? scanWeLibrary)();
      const toUrl = deps.toFileUrl ?? toFileUrl;
      const cacheRoot = (deps.resolveCacheRoot ?? resolveCacheRoot)();
      const repkgPath = (deps.resolveRepkg ?? resolveRepkg)({
        sourceRoot: join(dirname(fileURLToPath(import.meta.url)), ".."),
      });
      // scene 条目：如果用户跑过 we-extract，就把解出来的原始贴图（通常 4K）当 hero 用；
      // 没跑过就继续用创意工坊缩略图（1024x1024）。这一步只读缓存，不触发解包。
      const readHero = deps.readCachedHero ?? readCachedHero;
      resolvedWe = await Promise.all(scanned.items.map(async (item) => {
        const cached = item.pkgPath ? await readHero(item.id, cacheRoot) : null;
        return {
          id: item.id,
          title: item.title,
          kind: item.kind,
          rawType: item.rawType,
          rating: item.rating,
          manual: Boolean(item.manual),
          sizeMB: Math.round((item.size / 1048576) * 10) / 10,
          fileUrl: toUrl(item.path),
          previewUrl: item.previewPath ? toUrl(item.previewPath) : null,
          // 高清贴图：只有 scene 条目、且用户跑过 we-extract 才有
          heroUrl: cached ? toUrl(cached.heroPath) : null,
          heroSize: cached ? cached.size : null,
          // 能不能升级：装了 RePKG 且是 scene 条目
          canExtract: Boolean(repkgPath && item.pkgPath),
        };
      }));
      weMeta = { repkgPath, cacheRoot };

      // 内置了 RePKG，所以可以"后台预热"：把还没解过的 scene 壁纸丢给一个**脱离的**子进程去解，
      // 不阻塞本次换肤（apply 必须尽快把皮肤注入进去）。
      // ⚠️ 默认关闭（warmWeCache=false），只有真实入口 cli apply 才打开 ——
      //    测试是直接调 applySkin 的，不能让它们偷偷起后台进程、写几百 MB 缓存。
      const pending = resolvedWe.filter((x) => x.canExtract && !x.heroUrl).length;
      if (warmWeCache && repkgPath && pending > 0 && !process.env.WORKBUDDY_WE_NO_WARM) {
        try {
          const cli = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");
          const child = spawn(process.execPath, [cli, "we-extract"], {
            detached: true, stdio: "ignore", windowsHide: true,
          });
          child.unref();
        } catch {
          /* 预热失败不影响换肤 */
        }
      }
    } catch (error) {
      process.stderr.write("WE 盘点失败：" + error.message + "\n");
      resolvedWe = [];
    }
  }
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
  // 外部状态文档记着的"上次皮肤"。常驻守护要在新窗口诞生前就决定首屏用哪套主题，
  // 那时它连不上任何渲染进程，只能读这个。读不到（首次运行）就给 null，
  // 渲染进程会退回自己的 localStorage。
  let activeHint = null;
  try {
    activeHint = deps.readActiveId ? deps.readActiveId() : readActiveId();
  } catch {
    /* 状态文档读不了不影响换肤，渲染进程照旧用 localStorage */
  }

  const expression = buildSkinMenuScript({
    entries,
    activeId: themeId,
    styleId: STYLE_ID,
    menuId: MENU_ID,
    cssTemplate,
    restoreLast,
    iconDataUrl: await readMenuIcon(),
    // Wallpaper Engine 壁纸目录（只含路径与标题，几 KB）。渲染层用它渲染"WE 壁纸"分组。
    // ⚠️ 只传路径不传字节：渲染进程本身是 file:// 页面，可以直接 <video src="file:///…">（已实测）。
    weItems: resolvedWe,
    // RePKG 是否可用（面板据此提示可以升级到 4K）
    weRepkgAvailable: Boolean(weMeta && weMeta.repkgPath),
    // 外部状态文档里的当前皮肤 + 守护挂的上报通道名（见 active-state.mjs / skin-guard.mjs）
    activeHint,
    reportBinding: REPORT_BINDING,
  });
  return {
    expression,
    themeId,
    restoreLast,
    menuThemes: entries.map(({ id }) => id),
  };
}

export async function applySkin({ loadedTheme, themes, port, activeId, restoreLast = false, weItems = null, warmWeCache = false, deps = {} }) {
  const wait = deps.waitForRendererTargets ?? waitForRendererTargets;
  const Session = deps.Session ?? CdpSession;
  const payload = await buildInjectionPayload({
    loadedTheme, themes, activeId, restoreLast, weItems, warmWeCache, deps,
  });
  const targets = await wait(port, {
    timeoutMs: deps.waitTimeoutMs ?? 20_000,
    pollMs: deps.pollMs ?? 500,
  });
  const values = await evaluateTargets(targets, payload.expression, Session);
  return {
    applied: values.length,
    themeId: payload.themeId,
    restoreLast: payload.restoreLast,
    menuThemes: payload.menuThemes,
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
    window.__anonbuddySkin?.copy?.restore?.();
    document.getElementById(${JSON.stringify(STYLE_ID)})?.remove();
    document.getElementById(${JSON.stringify(MENU_ID)})?.remove();
    delete document.documentElement.dataset.anonbuddySkin;
    delete window.__anonbuddySkin;
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
    themeId: document.documentElement.dataset.anonbuddySkin ?? null
  }))()`;
  const targets = await fetchTargets(port);
  return evaluateTargets(targets, expression, Session);
}
