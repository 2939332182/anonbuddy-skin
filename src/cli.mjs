#!/usr/bin/env node
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exeFromRegistry } from "./asar-path.mjs";
import { DEFAULT_CDP_PORT, DEFAULT_THEME_ID, EXPECTED_BUNDLE_ID, RENDERER_URL_HINT, resolveStudioPaths } from "./constants.mjs";
import { applySkin, removeSkin, skinStatus } from "./injector.mjs";
import { loadTheme } from "./theme-schema.mjs";
import { createSingleImageTheme, listThemes } from "./theme-store.mjs";
import { scanAll as scanWeLibrary, toFileUrl } from "./we-library.mjs";
import { extractSceneTexture, resolveCacheRoot, resolveRepkg, sweepStrayRaw } from "./we-extract.mjs";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function options(argv) {
  const result = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`无法识别的参数：${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} 缺少值`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function portFrom(value) {
  const port = value === undefined ? DEFAULT_CDP_PORT : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port 必须是 1024 到 65535 的整数");
  return port;
}

function defaults(overrides) {
  const paths = resolveStudioPaths();
  return {
    bundledThemesRoot: join(sourceRoot, "themes"),
    userThemesRoot: paths.userThemesRoot,
    loadTheme,
    listThemes,
    createSingleImageTheme,
    scanWeLibrary,
    toFileUrl,
    extractSceneTexture,
    resolveRepkg,
    resolveCacheRoot,
    sweepStrayRaw,
    applySkin,
    removeSkin,
    skinStatus,
    ...overrides,
  };
}

export async function runCli(argv, overrides = {}) {
  const command = argv[0] ?? "help";
  const args = options(argv);
  const deps = defaults(overrides);
  const roots = [deps.bundledThemesRoot, deps.userThemesRoot];

  if (command === "help") {
    return {
      commands: [
        "list",
        "create --image PATH --name NAME",
        "apply [--theme ID|last] [--port 9333]",
        "pause",
        "status",
        "doctor",
        "we",
        "we-extract [--limit N]",
      ],
      notes: {
        we: "只读盘点本机 Wallpaper Engine 壁纸库（Steam 创意工坊 431960）",
        "we-extract": "用外部 RePKG 把 scene 壁纸解成原始贴图（缓存到用户目录）。需先把 RePKG.exe 放到 tools/repkg/ 或设 WORKBUDDY_REPKG",
        "apply --theme last": "恢复用户上次在 🎨 菜单里选用的主题（含自定义上传的主题）；没选过则用默认主题",
      },
    };
  }
  if (command === "list") return deps.listThemes({ roots });
  if (command === "create") {
    if (!args.image) throw new Error("create 需要 --image");
    if (!args.name) throw new Error("create 需要 --name");
    return deps.createSingleImageTheme({ imagePath: args.image, name: args.name, storeRoot: deps.userThemesRoot });
  }
  if (command === "apply") {
    const requested = args.theme ?? DEFAULT_THEME_ID;
    // `--theme last`：真正用哪个主题交给 renderer 决定（它才知道用户最后在菜单里选了什么，
    // 包括只存在于 localStorage 的自定义主题）。这里只挑一个兜底主题，用于构建菜单与 CSS 模板。
    const restoreLast = requested === "last";
    const themes = await deps.listThemes({ roots });
    if (themes.length === 0) throw new Error("没有可用主题");
    const activeId = restoreLast
      ? (themes.some((theme) => theme.id === DEFAULT_THEME_ID) ? DEFAULT_THEME_ID : themes[0].id)
      : requested;
    const selected = themes.find((theme) => theme.id === activeId);
    if (!selected) throw new Error(`找不到主题：${activeId}`);
    const loadedTheme = await deps.loadTheme(selected.path);
    const menuThemes = [];
    for (const theme of themes) {
      if (theme.id === activeId) {
        menuThemes.push(loadedTheme);
        continue;
      }
      try {
        menuThemes.push(await deps.loadTheme(theme.path));
      } catch {
        // 坏主题不阻塞换肤，只是不进菜单
      }
    }
    // WE 壁纸盘点由 applySkin 内部负责（所有注入路径的汇合点），这里不再重复扫一遍。
    // warmWeCache：真实入口才开后台上预热（把未解过的 scene 壁纸丢给脱离的子进程），测试不会走到这里。
    return deps.applySkin({ loadedTheme, themes: menuThemes, port: portFrom(args.port), activeId, restoreLast, warmWeCache: true });
  }
  if (command === "pause" || command === "restore") {
    return deps.removeSkin({ port: portFrom(args.port) });
  }
  if (command === "status") return deps.skinStatus({ port: portFrom(args.port) });
  // `we list`：只读盘点本机 Wallpaper Engine 壁纸库（不复制、不读取媒体字节）。
  // 详见 docs/WE-INTEGRATION.md —— 渲染进程是 file:// 页面，可直接播本机文件，无需搬运。
  // 用外部 RePKG 把 scene 壁纸解成原始贴图（一次性、带缓存）。
  // scene 的**动效**拿不到（RePKG 不执行着色器），这里只是把静态兜底从 1K 缩略图升级到 4K 原图。
  if (command === "we-extract") {
    const repkgPath = deps.resolveRepkg({ sourceRoot });
    if (!repkgPath) {
      throw new Error("没找到 RePKG。请设 WORKBUDDY_REPKG 指向 RePKG.exe，或把它放到 tools/repkg/");
    }
    const cacheRoot = deps.resolveCacheRoot();
    // 先扫掉历史残留（解包中间产物可能上 GB）
    const swept = await deps.sweepStrayRaw(cacheRoot);
    const { items } = await deps.scanWeLibrary();
    const targets = items.filter((item) => item.pkgPath);
    const limit = args.limit ? Math.max(1, Number(args.limit)) : targets.length;
    const results = [];
    for (const item of targets.slice(0, limit)) {
      try {
        const done = await deps.extractSceneTexture({
          itemId: item.id, pkgPath: item.pkgPath, cacheRoot, repkgPath,
        });
        results.push({ id: item.id, title: item.title, ok: Boolean(done), from: done?.from ?? null, size: done?.size ?? null });
      } catch (error) {
        results.push({ id: item.id, title: item.title, ok: false, error: error.message });
      }
    }
    return {
      repkgPath,
      cacheRoot,
      sceneTotal: targets.length,
      sweptStrayRaw: swept,
      extracted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }
  // ⚠️ 不能写成 `we list`：options() 只接受 --key value，位置参数会直接报错。
  if (command === "we") {
    const { dirs, items } = await deps.scanWeLibrary();
    return {
      workshopDirs: dirs,
      counts: {
        total: items.length,
        video: items.filter((x) => x.kind === "video").length,
        preview: items.filter((x) => x.kind === "preview").length,
      },
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        rawType: item.rawType,
        sizeMB: Math.round((item.size / 1048576) * 10) / 10,
        fileUrl: deps.toFileUrl(item.path),
        previewUrl: item.previewPath ? deps.toFileUrl(item.previewPath) : null,
      })),
    };
  }
  if (command === "doctor") {
    const exists = async (path) => access(path).then(() => true, () => false);
    if (process.platform === "win32") {
      // 注册表项排在环境变量之后：WORKBUDDY_EXE 会指向已卸载的旧盘（换盘重装后极易过期），
      // 而卸载项跟着真实安装位置走。它既是候选，也是"环境变量是否过期"的判据。
      const registryExe = exeFromRegistry();
      const candidates = [
        process.env.WORKBUDDY_EXE,
        registryExe,
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "workbuddy", "WorkBuddy.exe"),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "workbuddy", "WorkBuddy.exe"),
        process.env.ProgramFiles && join(process.env.ProgramFiles, "WorkBuddy", "WorkBuddy.exe"),
        process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "WorkBuddy", "WorkBuddy.exe"),
      ].filter(Boolean);
      let app = null;
      for (const c of candidates) {
        if (await exists(c)) { app = c; break; }
      }
      return {
        platform: "win32",
        app,
        appFound: !!app,
        source: !app
          ? null
          : app === process.env.WORKBUDDY_EXE
            ? "env:WORKBUDDY_EXE"
            : app === registryExe
              ? "registry:uninstall"
              : "common-install-path",
        candidates,
        cdpPort: DEFAULT_CDP_PORT,
        rendererHint: RENDERER_URL_HINT,
        installRoot: resolveStudioPaths().installRoot,
      };
    }
    const app = "/Applications/WorkBuddy.app";
    return {
      platform: "darwin",
      app,
      appFound: await exists(app),
      bundleId: EXPECTED_BUNDLE_ID,
      cdpPort: DEFAULT_CDP_PORT,
      rendererHint: RENDERER_URL_HINT,
      installRoot: resolveStudioPaths().installRoot,
    };
  }
  throw new Error(`未知命令：${command}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`AnonBuddy Skin：${error.message}\n`);
      process.exitCode = 1;
    });
}
