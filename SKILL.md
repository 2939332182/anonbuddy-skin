---
name: anonbuddy-skin
description: >-
  Apply a reversible theme/skin to the WorkBuddy desktop app (Tencent AI office
  agent) on Windows via local Chromium DevTools Protocol (CDP) injection. Use
  when the user wants to change WorkBuddy's appearance/theme/skin, references an
  open-source WorkBuddy theming project by GitHub URL, or says phrases like
  "帮我换 WorkBuddy 主题/皮肤", "用这个开源项目帮我更换 WorkBuddy 的主题", or
  "change my WorkBuddy theme". Never modifies app.asar, the official install
  directory, or code signing. Windows only.
---

# AnonBuddy Skin

Reversible WorkBuddy desktop theming through local CDP injection. The tool
restarts WorkBuddy with `--remote-debugging-port` (9333 for the international
build, 9334 for the China build), discovers its renderer
(`renderer/index.html`), and injects CSS + a 🎨 theme menu into the live UI.
No official files are touched.

**Windows only.** The macOS launchers were retired because they were never
validated on real hardware. If the user is on macOS, say so and stop.

## When this skill applies

- The user gives you a GitHub URL for `anonbuddy-skin` (or similar) and
  asks you to install / apply / use it to theme WorkBuddy.
- The user wants to change WorkBuddy's look (color theme, background image,
  custom uploaded image) without editing the official app.
- The user reports the theme disappeared after a WorkBuddy restart and wants it
  reapplied, or wants to revert to the native look.

## Which build is installed (decide this first)

WorkBuddy ships as two product lines and the release packages differ. The
plugin itself supports both; only the launcher defaults differ.

| | International | China |
|:---|:---|:---|
| Site | `workbuddy.ai` | `workbuddy.cn` |
| Executable | `WorkBuddyAI.exe` | `WorkBuddy.exe` |
| Data dir | `~/.workbuddy-ai` | `~/.workbuddy` |
| Default CDP port | 9333 | 9334 |
| Package suffix | `-intl` | `-cn` |

Detect it:

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*WorkBuddy*' } | Select-Object -Unique ProcessName
```

→ `WorkBuddyAI` = international, `WorkBuddy` = China. Both = ask the user which
one they want themed. Neither = WorkBuddy isn't installed; stop and tell them.

The package choice is a convenience, not a constraint: the launcher's `-Prefer`
only pre-selects the executable name and port, and falls back to the generic
resolver when that name is absent, so downloading the "wrong" package still
works. When both builds are installed side by side, pass the matching `-Prefer`
so you theme the one the user meant.

## Prerequisites

- **Windows 10/11** and the **WorkBuddy desktop app** (this themes the desktop
  app, not the web version).
- **Node.js 18+** on PATH, or the copy WorkBuddy unpacks under
  `%USERPROFILE%\.workbuddy-ai\binaries\node\versions\` (international) /
  `%USERPROFILE%\.workbuddy\binaries\node\versions\` (China). The launchers scan
  both.
- Warn the user once: applying **restarts WorkBuddy** and any unsaved in-app
  work is lost. Ask them to save first.

## Workflow

1. From the repo directory. If WorkBuddy is not already running *with* the CDP
   port, use the one-step launcher (plain Node — no PowerShell, no execution
   policy involved):

   ```powershell
   # launch with CDP + inject, one step
   node scripts\launch-and-skin.mjs

   # both product lines installed? pick the one the user wants
   node scripts\launch-and-skin.mjs --prefer cn
   ```

   If it is already running with the port, the CLI alone is enough:

   ```powershell
   node src\cli.mjs apply
   node src\cli.mjs apply --theme chunzhi-night
   ```
2. If the launcher cannot locate WorkBuddy, run the locator — it prints every
   candidate it tried and reads the registry, so a drive change or reinstall is
   usually handled automatically:

   ```powershell
   node scripts\find-workbuddy.mjs
   ```

   If WorkBuddy lives somewhere unusual, set the env var once instead of passing
   `-WorkBuddyExe` every time. It only reaches **newly opened** terminals:

   ```powershell
   [Environment]::SetEnvironmentVariable('WORKBUDDY_EXE', 'D:\path\to\WorkBuddyAI.exe', 'User')
   ```

3. Verify:

   ```powershell
   node src/cli.mjs status
   ```

   Expect `installed: true` and `menu: true`.

4. A 🎨 button appears at the top-right of WorkBuddy. Tell the user they can
   switch themes, upload a custom image, or revert to native from that menu.

## Choosing a theme

- List available themes: `node src/cli.mjs list`.
- Built-ins shipped in `themes/`: `aisu`, `chunzhi-day`, `chunzhi-night`,
  `miku-sea`, `summer-moon`. All of them ship with the repo, so anyone who
  clones gets the full set out of the box; add your own by dropping
  `theme.json` + `hero.webp` into `themes/<id>/` and re-applying.
- Pin a startup default via the row right-click menu ("set as boot theme"):
  it outranks the auto-remembered last pick. Only plain themes qualify —
  Wallpaper Engine entries are machine-local paths and are deliberately excluded,
  so the wallpaper side can never fight the boot pick.
- `apply --theme last` restores whatever theme the user last picked in the 🎨 menu,
  custom uploads included. This is what the automatic paths (the login watcher and
  `apply-now.mjs`) use by default, so a WorkBuddy restart no longer resets the user
  back to Miku. Pass a concrete id to force one.
- If the user names a mood/character (e.g. "dark Genshin"), map it to the
  closest id, or just apply the default and let them pick from the 🎨 menu.
- Custom image: `node src/cli.mjs create --image "/path/to/hero.webp" --name "My Skin"`
  then `node src/cli.mjs apply --theme my-skin`. The in-app 🎨 menu also supports
  "＋ 自定义图片" with automatic color extraction; every upload is kept as its own
  theme instead of replacing the previous one.
- Custom launcher icon: drop a square image at `assets/menu-icon.png` (or `assets/icon.*`;
  png / jpg / webp / gif / svg all work) and re-apply — no code change needed. It is
  inlined as a data URL and shown in the round 38×38 button; without it the 🎨 emoji is used.
  Verify with `node scripts/test-menu-icon.mjs`.

## Auto-start with the skin

Nothing in the skin survives a manual restart, and the default launch entries
(desktop shortcut, Start Menu, auto-start) start WorkBuddy *without* the debug
port, so the injector has nothing to attach to. `scripts/setup-autoskin.ps1`
binds those entries to `scripts/autoskin-launch.vbs`, which starts the app with
the port, waits for the renderer, injects, and exits — no console window, no
resident process.

```powershell
.\scripts\setup-autoskin.ps1 -ListOnly    # dry run: show what would change
.\scripts\setup-autoskin.ps1 -Prefer cn   # bind the China build
.\scripts\setup-autoskin.ps1 -Undo        # restore from backup
```

It only touches entries whose target executable matches exactly, so two
installed builds don't interfere. Always start with `-ListOnly` and show the
user what will change before running it for real.

## Pause / restore to native

```powershell
node src\cli.mjs pause
```

This removes the injected skin and relaunches WorkBuddy normally. The official
install is always left untouched.

## Guardrails

- Never replace, edit, or take ownership of `WorkBuddy.app`, `app.asar`, or the
  Windows install directory. This tool only injects into the live renderer.
- CDP binds to loopback `127.0.0.1` only. Tell the user not to run untrusted
  local software while a skin is active (Chromium CDP has no same-user auth).
- Injection lives for the renderer's lifetime. After a **manual** WorkBuddy
  restart the skin disappears by design — re-run `apply` to bring it back.
- WorkBuddy's process is protected (Turing Shield): `Stop-Process` and
  `taskkill /F` are refused, and even reading its process owner fails. To close
  it, tell the user to right-click the tray icon and pick 退出; clicking the
  window's × only minimizes it to the tray.
- Do not import README/preview screenshots or images with baked-in UI as a
  theme background; use clean wallpapers / character art.

## Checks (sanity before reporting done)

```powershell
node src/cli.mjs doctor   # platform, app path, CDP port, renderer hint
node src/cli.mjs status   # injection state
node --check src/cli.mjs  # syntax
```

`doctor` should report `appFound: true`, a `source` of either
`env:WORKBUDDY_EXE` or `registry:uninstall`, and the renderer hint
`renderer/index.html`.

## Resources

- `src/cli.mjs` — entry point: `list` / `create` / `apply` / `status` / `pause` / `doctor`.
- `src/cdp-client.mjs` — CDP connection + renderer discovery.
- `src/skin-css.mjs` — `--cb-*` variable overrides + background + container transparency.
- `src/skin-menu.mjs` — the 🎨 in-app menu (switch / upload / delete / rename / native).
  Right-clicking a row opens a small menu with 重命名 / 删除 (delete only for uploaded
  custom themes, two clicks to confirm; renames and deletions never touch `theme.json`
  or the theme folder on disk). Custom themes live in
  `localStorage["workbuddyCustomThemes"]` as an **array** — every upload adds an entry,
  nothing is overwritten — and the legacy single-theme key `workbuddyCustomTheme` is
  migrated automatically on first run. Theme display names are overridden via
  `localStorage["anonbuddySkinAliases"]` (id → display name). Scriptable through
  `window.__anonbuddySkin`: `renameTheme(id, name)` (pass `""` to restore the default,
  `null` for the native row), `deleteCustomTheme(id)`, `importFromDataUrl(dataUrl, name)`,
  plus `customThemes()` / `aliases()` inspectors.
- `src/injector.mjs` — idempotent CSS+menu injection and removal.
- `src/constants.mjs`, `src/theme-schema.mjs`, `src/theme-store.mjs` — config & theme model.
- `scripts/launch-and-skin.mjs` — start WorkBuddy with CDP + inject, in one step (Node).
- `scripts/find-workbuddy.mjs` — print every candidate path it tried, plus the hit.
- `src/platform/workbuddy-path.mjs` — the single source of truth for locating the app,
  its bundled Node and the per-edition port (reads the registry via `reg.exe`).
- `scripts/setup-autoskin.ps1` + `autoskin-launch.vbs` — bind launch entries for auto-start.
  These two stay PowerShell/VBScript on purpose: they drive the `WScript.Shell` COM
  interface to rewrite `.lnk` shortcuts, which Node has no equivalent for, and a `.vbs`
  is the only way to start a child process without a console window flashing.
- `scripts/workbuddy-path.ps1` — only dot-sourced by `setup-autoskin.ps1`; the Node
  module above is the real entry point.
- `scripts/watch-targets.mjs` — re-inject windows opened later (Settings is its own window in 5.6.x).
- `themes/` — built-in theme folders (`theme.json` + `hero.webp`).
- `packaging/build-package.mjs` — builds the `-cn` / `-intl` release zips (Node only, no Python).
- `README.md` — full human-readable documentation.

## One-line summary for the user

> "I cloned anonbuddy-skin, restarted WorkBuddy in debug mode, and injected
> the theme. Use the 🎨 button (top-right) to switch or revert. Re-run apply if
> you restart WorkBuddy manually."
