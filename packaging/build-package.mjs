#!/usr/bin/env node
// 构建发布包：dist/chihayaanon-skin-<版本>-<edition>.zip
//
// 两个 edition 的区别
// -------------------
// WorkBuddy 有两条产品线，启动器必须知道自己在伺候哪一个：
//
//     edition   主程序            数据目录          默认 CDP 端口
//     cn        WorkBuddy.exe     ~/.workbuddy      9334
//     intl      WorkBuddyAI.exe   ~/.workbuddy-ai   9333
//
// （名字和目录来自各自构建的 product.json：win32ExecutableName / dataFolderName / isOversea）
//
// 插件代码两边完全一样，两个包只是把主程序名和端口预先钉死，免得同时装了两个
// 版本的人换错对象。不带偏好时引擎仍然会自动识别任意一边。
//
// 为什么要有这个脚本
// ------------------
// 1.0.0 那个包是临时拼出来的，44 个条目**全部**用反斜杠当路径分隔符。APPNOTE
// 4.4.17.1 要求正斜杠，严格按规范解压的工具会把 "dir\file" 当成一个又长又平的
// 文件名，目录结构直接丢掉。所以打包必须走这里：写盘前后都检查，不给反斜杠留活路。
//
// 用法：
//     node packaging/build-package.mjs                 # 两个 edition，版本取 package.json
//     node packaging/build-package.mjs --version 1.0.2
//     node packaging/build-package.mjs --edition cn    # 只出一个
//     node packaging/build-package.mjs --keep-stage    # 保留中间目录，便于排查

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createZip, verifyZipNames } from "./zip.mjs";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(REPO, "dist");

const EDITIONS = {
  cn: { exe: "WorkBuddy.exe", port: 9334, label: "国内版", site: "workbuddy.cn" },
  intl: { exe: "WorkBuddyAI.exe", port: 9333, label: "国际版", site: "workbuddy.ai" },
};

// scripts/ 只发运行时用到的那几个。仓库里还有测试和探针，不该进发布包。
// 注意：只剩两个 .ps1（setup-autoskin 要操作 .lnk 的 COM 接口）和一个 .vbs
// （快捷方式静默启动）；其余启动逻辑全在 Node 里。
const SCRIPTS = [
  "launch-and-skin.mjs",  // 带端口启动 + 注入，一步到位
  "skin-guard.mjs",       // 常驻守护：新渲染进程一出生就注入（5.6.x 起设置是独立窗口）
  "find-workbuddy.mjs",   // 路径排查
  "watch-targets.mjs",    // 老的轮询版补注入，留作回退路径
  "autoskin-launch.vbs",  // 静默启动器，快捷方式走它才不会闪黑框
  "setup-autoskin.ps1",   // 把快捷方式/开机自启接到上面那个
  "workbuddy-path.ps1",   // 仅被 setup-autoskin.ps1 dot-source：.lnk 的 COM 接口在
                          // Node 里没有对等物，路径发现的主入口是
                          // src/platform/workbuddy-path.mjs，这份只为它服务
];

// vendor/ 是运行时依赖（WebWallGL 渲染库，scene 壁纸实时渲染用），必须进包：
// 用户装完即可用，不引运行期外网依赖。它由 scripts/sync-webwallgl.mjs 同步，不许就地改。
const TREES = ["src", "themes", "tools", "assets", "vendor"];
const ROOT_FILES = ["README.md", "package.json", "LICENSE", "SKILL.md", "apply-now.mjs"];

// 模板里的 \{name\} 会被替换。注意 .bat 里还有 %~dp0 这类百分号语法，不受影响。
const LAUNCH_BAT = `@echo off
chcp 65001 >nul
title AnonBuddy Skin - {label} WorkBuddy 换肤
cd /d "%~dp0"

echo.
echo   ============================================
echo     AnonBuddy Skin    {label} WorkBuddy 换肤
echo   ============================================
echo.
echo   这个包是给 {label}（{site}）准备的，
echo   会去找 {exe}、用 {port} 端口。
echo.
echo   皮肤是注入进渲染进程的，重启就没了，
echo   所以要带着调试端口把它启动起来，再把皮肤注进去。
echo.
echo   如果 WorkBuddy 已经开着，脚本会等你先退出它 --
echo     右键点右下角托盘的图标，选「退出」。
echo     点窗口右上角的 X 只会缩到托盘，不算真的退出。
echo.
pause

node "scripts\\launch-and-skin.mjs" --prefer {edition} --port {port} --theme last --timeout 300 --setup

if errorlevel 1 (
  echo.
  echo   [失败] 上面有报错信息，把它整段发给 AI 看看。
  echo.
  echo   如果提示"找不到 node"，说明 PATH 里没有 Node.js。
  echo   装一个 Node 20+ 再双击本文件即可（WorkBuddy 自带的那份只有它自己认得）。
) else (
  echo.
  echo   [OK] 皮肤已经注入，右上角那颗浮动按钮点开就能换主题。
  echo.
  echo   桌面图标、开始菜单和开机自启也一并接好了，
  echo   以后开机、双击图标就是自带皮肤的，不用再跑别的命令。
  echo.
  echo   想撤销这些改动：
  echo     powershell -File scripts\\setup-autoskin.ps1 -Undo
)
echo.
echo   下次想让启动过程完全安静（不闪这个黑框），双击 一键换肤.vbs。
echo.
pause
`;

// 一键换肤.bat 的静默孪生兄弟。
// .bat 必须留着 —— 它带完整说明和 pause，正是首次安装或出问题时需要的东西；
// 但双击 .bat 必然闪一次控制台，这是 .bat 的固有属性。这个文件存在的意义是：
// 日常使用（以及被绑定的桌面图标）完全不出窗口。
const LAUNCH_VBS = `' AnonBuddy Skin - silent entry point.
'
' Double-click this file instead of the .bat when you would rather not see a
' console window. It does the same thing: start WorkBuddy with the CDP port open,
' wait for the renderer, inject the skin, then wire the desktop icon, Start Menu
' entry and autostart value to this same flow.
'
' The .bat file is still shipped on purpose: it prints the full explanation and
' pauses at the end, which is what you want the first time around, or when
' something goes wrong.
'
' Keep this file ASCII-only.

Option Explicit

Dim shell, fso, here, target, cmd

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
target = fso.BuildPath(here, "scripts\\autoskin-launch.vbs")

If Not fso.FileExists(target) Then
  MsgBox "scripts\\autoskin-launch.vbs is missing next to this launcher:" & vbCrLf & target, _
         16, "AnonBuddy Skin"
  WScript.Quit 1
End If

cmd = """" & target & """ --prefer {edition} --port {port} --theme last --timeout 300 --setup"

' 0 = hidden window, False = do not wait for it to finish.
shell.Run cmd, 0, False
`;

const RESTORE_BAT = `@echo off
chcp 65001 >nul
title AnonBuddy Skin - 还原
cd /d "%~dp0"

echo.
echo   正在把 WorkBuddy 还原成官方界面...
echo.
pause

node "src\\cli.mjs" pause

echo.
echo   [OK] 已还原。
echo.
echo   注意：这一步只卸皮肤。桌面图标和开机自启还接着换肤流程，
echo   下次开机、双击图标仍会带上皮肤。想连那些一起还原：
echo     powershell -File scripts\\setup-autoskin.ps1 -Undo
echo.
pause
`;

const README_TXT = `========================================
  AnonBuddy Skin    WorkBuddy 换肤
========================================

这个包是给「{label}」用的
--------------------------------------

WorkBuddy 有两条产品线，装出来的东西不一样：

  国际版（workbuddy.ai）    主程序 WorkBuddyAI.exe  数据目录 .workbuddy-ai
  国内版（workbuddy.cn）    主程序 WorkBuddy.exe    数据目录 .workbuddy

你手上这个包对应的是 {label}（{site}），
启动时会去找 {exe}，用 {port} 号端口。

如果你装的是另一个版本，去 Releases 页面下载另一个包就行：
两个包的插件代码完全一样，只是启动器预设不同。

怎么用
------

双击  一键换肤.bat

就这样。第一次跑会重启一次 WorkBuddy，
重启完之后去右上角找那颗浮动按钮，
点开就能换主题。

不想要了
--------

双击  一键还原.bat

官方文件从头到尾没被改过，
卸载工具直接删掉这个文件夹就行。

开机自动带皮肤
--------------

跑一次：

  powershell -ExecutionPolicy Bypass -File scripts\\setup-autoskin.ps1 -Prefer {edition}

它会把桌面快捷方式、开始菜单和开机自启项都改成"带端口启动 + 自动注入"，
以后开机、双击图标都是带皮肤的。卸载用 -Undo。

设置页里为什么会有换肤入口
--------------------------

启动器会拉起一个常驻守护盯着 WorkBuddy 新开的窗口（比如设置是独立窗口）：
它在新窗口刚创建、还没加载出内容的时候就完成注入，所以设置页里也能看到换肤入口，
打开的一瞬间就是带皮肤的。不想让它常驻，给启动器加 --no-watch。

如果报错
--------

1) 说找不到 Node.js

   这个工具需要 Node 运行时。WorkBuddy 自带一份：
     国际版  %USERPROFILE%\\.workbuddy-ai\\binaries\\node\\versions\\
     国内版  %USERPROFILE%\\.workbuddy\\binaries\\node\\versions\\
   两个位置它都会找。如果都是空的，先把 WorkBuddy 正常启动一次，
   它会把 Node 解压出来。然后再双击一次。

2) 说找不到 WorkBuddy

   它会自动认国际版（WorkBuddyAI.exe）和国内版（WorkBuddy.exe）
   两种安装，还会读注册表里的安装位置。如果还是没找到，跑：
     node scripts\\find-workbuddy.mjs
   它会列出所有试过的候选路径和命中的那一个。

里面都有什么
------------

  src\\        插件本体（注入脚本，纯 JavaScript）
  themes\\     五款内置主题
  tools\\      解包工具 RePKG（MIT 许可）
  vendor\\     WebWallGL 渲染库（MIT 许可），场景壁纸实时渲染用
  scripts\\    启动 / 还原 / 查找 / 自动化脚本
  README.md   完整说明（想深入了解看这个）

版权
----

代码：MIT
内置主题的背景图来自 Wallpaper Engine 创意工坊，
版权归各自作者，仅作展示。
`;

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );

/** Windows 上 .bat / .txt 用 CRLF，和 Python 版保持一致 */
const crlf = (text) => text.replace(/\r?\n/g, "\r\n");

/** 递归收集目录下所有文件的绝对路径 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function copyTree(src, dst) {
  for (const file of walk(src)) {
    const target = join(dst, relative(REPO, file));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(file));
  }
}

function parseArgs(argv) {
  const args = { version: null, edition: null, keepStage: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--version") args.version = argv[++i];
    else if (a === "--edition") args.edition = argv[++i];
    else if (a === "--keep-stage") args.keepStage = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`无法识别的参数：${a}`);
  }
  return args;
}

function build(edition, version, keepStage) {
  const cfg = EDITIONS[edition];
  if (!cfg) throw new Error(`未知 edition：${edition}`);

  const root = `chihayaanon-skin-${version}-${edition}`;
  const stage = join(DIST, root);
  const out = join(DIST, `${root}.zip`);

  if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  for (const tree of TREES) copyTree(join(REPO, tree), stage);

  mkdirSync(join(stage, "scripts"), { recursive: true });
  for (const name of SCRIPTS) {
    writeFileSync(join(stage, "scripts", name), readFileSync(join(REPO, "scripts", name)));
  }

  for (const name of ROOT_FILES) {
    writeFileSync(join(stage, name), readFileSync(join(REPO, name)));
  }

  const vars = { edition, exe: cfg.exe, port: cfg.port, label: cfg.label, site: cfg.site };
  writeFileSync(join(stage, "一键换肤.bat"), crlf(fill(LAUNCH_BAT, vars)), "utf8");
  writeFileSync(join(stage, "一键换肤.vbs"), crlf(fill(LAUNCH_VBS, vars)), "utf8");
  writeFileSync(join(stage, "一键还原.bat"), crlf(RESTORE_BAT), "utf8");
  writeFileSync(join(stage, "使用说明.txt"), crlf(fill(README_TXT, vars)), "utf8");

  const files = walk(stage).sort();
  const entries = files.map((full) => ({
    name: posixJoin(root, relative(stage, full).split(sep).join("/")),
    data: readFileSync(full),
    // 与 Python 版一致：用源文件的 mtime，不用打包时刻
    date: statSync(full).mtime,
  }));

  if (existsSync(out)) rmSync(out, { force: true });
  const zipBuf = createZip(entries);
  writeFileSync(out, zipBuf);

  const sizeMb = (statSync(out).size / 1048576).toFixed(2);
  console.log(`built ${out}`);
  console.log(`  ${files.length} files, ${sizeMb} MB, edition=${edition} (${cfg.exe} / port ${cfg.port})`);

  const { names, backslashes } = verifyZipNames(zipBuf);
  if (names.length !== entries.length) {
    throw new Error(`中央目录条目数对不上：写出 ${entries.length}，读回 ${names.length}`);
  }
  if (backslashes.length) {
    throw new Error(`有 ${backslashes.length} 个条目用了反斜杠：${backslashes.slice(0, 3).join(", ")}`);
  }
  console.log(`  separator check OK (${names.length} entries, all forward slashes)`);

  if (!keepStage) rmSync(stage, { recursive: true, force: true });
}

/** 只做字符串拼接，避免在不同平台上引入 path 的分隔符差异 */
const posixJoin = (a, b) => (b ? `${a}/${b}` : a);

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法: node packaging/build-package.mjs [选项]

  --version <版本>   默认读 package.json 的 version
  --edition <名称>   ${Object.keys(EDITIONS).join(" / ")}，默认两个都出
  --keep-stage       保留中间目录 dist/<包名>/ 便于排查
  --help             显示本帮助`);
    return;
  }

  const version =
    args.version ??
    JSON.parse(readFileSync(join(REPO, "package.json"), "utf8").replace(/^\uFEFF/, "")).version;

  const targets = args.edition ? [args.edition] : Object.keys(EDITIONS).sort();
  for (const edition of targets) {
    build(edition, version, args.keepStage);
    console.log();
  }
}

main();
