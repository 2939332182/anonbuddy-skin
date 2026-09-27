#!/usr/bin/env python3
"""Build the release zips: dist/chihayaanon-skin-<version>-<edition>.zip

Why two editions
----------------
WorkBuddy ships as two product lines that differ in ways the launcher has to
know about:

    edition   executable       data dir        default CDP port
    cn        WorkBuddy.exe    ~/.workbuddy    9334
    intl      WorkBuddyAI.exe  ~/.workbuddy-ai 9333

(name and directory come from each build's own product.json:
 win32ExecutableName / dataFolderName / isOversea.)

The plugin code is identical for both -- the packaged launchers just pin the
right executable and port up front, so a user who has both installed cannot end
up skinning the wrong one by accident. The engine still auto-detects either
build when no preference is given.

Why this script exists at all
-----------------------------
The 1.0.0 package was built ad hoc and every one of its 44 entries used a
backslash as the path separator. ZIP APPNOTE 4.4.17.1 says "All slashes MUST be
forward slashes '/' as opposed to backwards slashes '\\'", and strict
extractors read "dir\\file" as one flat filename, so the directory tree is lost
on those platforms. Python's zipfile always writes forward slashes and sets the
UTF-8 name flag for non-ASCII names, so building through this script keeps both
right -- and it re-checks the result before exiting.

Usage:
    python packaging/build-package.py                 # both editions, package.json version
    python packaging/build-package.py --version 1.0.2
    python packaging/build-package.py --edition cn    # just one
"""

import argparse
import json
import os
import posixpath
import shutil
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(REPO, "dist")

EDITIONS = {
    "cn": {
        "exe": "WorkBuddy.exe",
        "port": 9334,
        "label": "国内版",
        "site": "workbuddy.cn",
    },
    "intl": {
        "exe": "WorkBuddyAI.exe",
        "port": 9333,
        "label": "国际版",
        "site": "workbuddy.ai",
    },
}

# scripts/ ships only the runtime pieces. The repo tree also holds tests, probes
# and archive/, none of which belong in a runtime package.
SCRIPTS = [
    "apply.ps1",
    "apply.command",
    "pause.ps1",
    "pause.command",
    "workbuddy-path.ps1",
    "find-workbuddy.ps1",
    "launch-and-skin.ps1",   # start with CDP + inject, in one step
    "autoskin-launch.vbs",   # silent wrapper so shortcuts show no console
    "setup-autoskin.ps1",    # bind shortcuts / auto-start to the above
    "watch-targets.mjs",     # re-inject windows opened later (e.g. Settings in 5.6.x)
]
TREES = ["src", "themes", "tools", "assets"]
ROOT_FILES = ["README.md", "package.json", "LICENSE", "SKILL.md", "apply-now.mjs"]

LAUNCH_BAT = """@echo off
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

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\\launch-and-skin.ps1" -Prefer {edition} -Port {port} -Theme last -TimeoutSeconds 300

if errorlevel 1 (
  echo.
  echo   [失败] 上面有报错信息，把它整段发给 AI 看看。
) else (
  echo.
  echo   [OK] 皮肤已经注入，右上角那颗浮动按钮点开就能换主题。
  echo.
  echo   以后想开机就带皮肤：跑一次
  echo     powershell -File scripts\\setup-autoskin.ps1 -Prefer {edition}
  echo   它会把桌面图标和开机自启都接到这套启动流程上。
)
echo.
pause
"""

RESTORE_BAT = """@echo off
chcp 65001 >nul
title AnonBuddy Skin - 还原
cd /d "%~dp0"

echo.
echo   正在把 WorkBuddy 还原成官方界面...
echo.
pause

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\\pause.ps1"

echo.
echo   [OK] 已还原。
echo.
pause
"""

README_TXT = """========================================
  AnonBuddy Skin    WorkBuddy 换肤
========================================

这个包是给「{label}」用的
--------------------------------------

WorkBuddy 有两条件产品线，装出来的东西不一样：

  国际版（workbuddy.ai）    主程序 WorkBuddyAI.exe  数据目录 .workbuddy-ai
  国内版（workbuddy.cn）    主程序 WorkBuddy.exe    数据目录 .workbuddy

你手上这个包对应的是 {label}（{site}），
启动时会去找 {exe}，用 {port} 号端口。

如果你装的是另一个版本，去 Releases 页面下载另一个包就行：
两个包的插件代码完全一样，只是启动器预设不同。

怎么用
------

Windows：双击  一键换肤.bat
macOS  ：双击  一键换肤.command

就这样。第一次跑会重启一次 WorkBuddy，
重启完之后去右上角找那颗浮动按钮，
点开就能换主题。

不想要了
--------

Windows：双击  一键还原.bat

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

启动器会顺带盯着 WorkBuddy 新开的窗口（比如设置是独立窗口），
新窗口一出现就自动补一次注入，所以设置页里也能看到换肤入口。
不想让它常驻，启动时加 -NoWatch。

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
     scripts\\find-workbuddy.ps1
   它会列出所有试过的路径和命中的那一个。

里面都有什么
------------

  src\\        插件本体（注入脚本，纯 JavaScript）
  themes\\     五款内置主题
  tools\\      解包工具 RePKG（MIT 许可）
  scripts\\    启动 / 还原 / 查找 / 自动化脚本
  README.md   完整说明（想深入了解看这个）

版权
----

代码：MIT
内置主题的背景图来自 Wallpaper Engine 创意工坊，
版权归各自作者，仅作展示。
"""


def copy_tree(src, dst):
    for dirpath, _, filenames in os.walk(src):
        for name in filenames:
            s = os.path.join(dirpath, name)
            t = os.path.join(dst, os.path.relpath(s, REPO))
            os.makedirs(os.path.dirname(t), exist_ok=True)
            shutil.copy2(s, t)


def build(edition, version, keep_stage):
    cfg = EDITIONS[edition]
    root = f"chihayaanon-skin-{version}-{edition}"
    stage = os.path.join(DIST, root)
    out = os.path.join(DIST, f"{root}.zip")

    if os.path.exists(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)

    for tree in TREES:
        copy_tree(os.path.join(REPO, tree), stage)

    os.makedirs(os.path.join(stage, "scripts"), exist_ok=True)
    for name in SCRIPTS:
        shutil.copy2(os.path.join(REPO, "scripts", name), os.path.join(stage, "scripts", name))

    for name in ROOT_FILES:
        shutil.copy2(os.path.join(REPO, name), os.path.join(stage, name))

    # edition-specific wrappers
    fmt = dict(edition=edition, exe=cfg["exe"], port=cfg["port"],
               label=cfg["label"], site=cfg["site"])
    with open(os.path.join(stage, "一键换肤.bat"), "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(LAUNCH_BAT.format(**fmt))
    with open(os.path.join(stage, "一键还原.bat"), "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(RESTORE_BAT)
    with open(os.path.join(stage, "使用说明.txt"), "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(README_TXT.format(**fmt))
    # macOS launcher is shared; keep shipping the repo copy
    shutil.copy2(os.path.join(REPO, "scripts", "apply.command"),
                 os.path.join(stage, "一键换肤.command"))

    files = sorted(
        os.path.join(dirpath, name)
        for dirpath, _, filenames in os.walk(stage)
        for name in filenames
    )
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for full in files:
            rel = os.path.relpath(full, stage).replace(os.sep, "/")
            archive.write(full, posixpath.join(root, rel))

    size = os.path.getsize(out) / 1048576
    print(f"built {out}")
    print(f"  {len(files)} files, {size:.2f} MB, edition={edition} ({cfg['exe']} / port {cfg['port']})")

    with zipfile.ZipFile(out) as archive:
        names = archive.namelist()
        bad = [n for n in names if "\\" in n]
        if bad:
            raise SystemExit(f"ERROR: {len(bad)} entries use backslashes as separators")
        print(f"  separator check OK ({len(names)} entries, all forward slashes)")

    if not keep_stage:
        shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version")
    parser.add_argument("--edition", choices=sorted(EDITIONS))
    parser.add_argument("--keep-stage", action="store_true")
    args = parser.parse_args()

    if args.version:
        version = args.version
    else:
        with open(os.path.join(REPO, "package.json"), encoding="utf-8") as fh:
            version = json.load(fh)["version"]

    targets = [args.edition] if args.edition else sorted(EDITIONS)
    for edition in targets:
        build(edition, version, args.keep_stage)
        print()


if __name__ == "__main__":
    main()
