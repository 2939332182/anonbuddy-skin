---
name: workbuddy-skin-studio
description: >-
  Apply a reversible theme/skin to the WorkBuddy desktop app (Tencent AI office
  agent) via local Chromium DevTools Protocol (CDP) injection. Use when the user
  wants to change WorkBuddy's appearance/theme/skin, references an open-source
  WorkBuddy theming project by GitHub URL, or says phrases like "帮我换 WorkBuddy
  主题/皮肤", "用这个开源项目帮我更换 WorkBuddy 的主题", or "change my WorkBuddy
  theme". Never modifies app.asar, the official install directory, or code signing.
---

# WorkBuddy Skin Studio

Reversible WorkBuddy desktop theming through local CDP injection. The tool
restarts WorkBuddy with `--remote-debugging-port=9333`, discovers its renderer
(`renderer/index.html`), and injects CSS + a 🎨 theme menu into the live UI.
No official files are touched.

## When this skill applies

- The user gives you a GitHub URL for `workbuddy-skin-studio` (or similar) and
  asks you to install / apply / use it to theme WorkBuddy.
- The user wants to change WorkBuddy's look (color theme, background image,
  custom uploaded image) without editing the official app.
- The user reports the theme disappeared after a WorkBuddy restart and wants it
  reapplied, or wants to revert to the native look.

## Prerequisites

- **WorkBuddy desktop installed** (this tool themes the desktop app, not web).
- **Node.js 18+** on PATH (the injector is plain Node, cross-platform).
- macOS **or** Windows. (Linux is not supported by WorkBuddy's desktop build.)
- Warn the user once: applying **restarts WorkBuddy** and any unsaved in-app
  work is lost. Ask them to save first.

## Platform detection (run first)

- macOS: shell `uname` returns `Darwin`, or `$OSTYPE` starts with `darwin`.
- Windows: PowerShell `$IsWindows` is `$true`, or `$env:OS` is `Windows_NT`.
- Choose the matching branch below.

## Workflow — macOS

1. Clone / open the repo, then run the launcher (double-click works, or CLI):

   ```bash
   # default theme (miku-light)
   ./scripts/apply.command

   # or a specific theme via the cross-platform CLI
   node src/cli.mjs apply --theme genshin-dawn
   ```

   `apply.command` quits WorkBuddy, relaunches it with the CDP port, waits for
   the debugger, and injects the skin.
2. Verify:

   ```bash
   node src/cli.mjs status
   ```

   Expect an injected/active state and the WorkBuddy renderer listed.
3. A 🎨 button appears at the top-right of WorkBuddy. Tell the user they can
   switch themes, upload a custom image, or revert to native from that menu.

## Workflow — Windows

1. From the repo directory, run in **PowerShell** (not cmd):

   ```powershell
   # default theme (miku-light)
   .\scripts\apply.ps1

   # or a specific theme
   .\scripts\apply.ps1 -Theme genshin-dawn
   ```

   If you hit an execution-policy error, run once:
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then retry.
2. If `apply.ps1` cannot locate `WorkBuddy.exe`, run the locator and follow its
   printed hint (often you just need to launch WorkBuddy once so the path is
   registered):

   ```powershell
   .\scripts\find-workbuddy.ps1
   ```

   If WorkBuddy lives outside the standard install locations, set the env var once
   instead of passing `-WorkBuddyExe` every time. It only reaches **newly opened**
   terminals:

   ```powershell
   [Environment]::SetEnvironmentVariable('WORKBUDDY_EXE', 'D:\path\to\WorkBuddyAI.exe', 'User')
   ```

3. Verify:

   ```powershell
   node src/cli.mjs status
   ```

4. Same 🎨 menu appears top-right in WorkBuddy.

## Choosing a theme

- List available themes: `node src/cli.mjs list` (macOS) / same via PowerShell.
- Built-ins shipped in `themes/`: `miku-488137`, `genshin-dawn`, `wuthering-echo`.
  Other presets (`miku-light`, `genshin-night`, `wuthering-tide`, `deepspace-*`,
  `naruto-*`) were moved to `themes-removed/` — move a folder back into `themes/`
  and re-apply to bring it back into the menu.
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

## Pause / restore to native

```bash
# macOS
./scripts/pause.command

# Windows (PowerShell)
.\scripts\pause.ps1
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
- Do not import README/preview screenshots or images with baked-in UI as a
  theme background; use clean wallpapers / character art.

## Checks (sanity before reporting done)

```bash
node src/cli.mjs doctor   # platform, app path, CDP port, renderer hint
node src/cli.mjs status   # injection state
node --check src/cli.mjs  # syntax
```

`doctor` should report the correct platform, a found WorkBuddy app, and the
renderer hint `renderer/index.html`.

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
  `localStorage["workbuddySkinAliases"]` (id → display name). Scriptable through
  `window.__workbuddySkin`: `renameTheme(id, name)` (pass `""` to restore the default,
  `null` for the native row), `deleteCustomTheme(id)`, `importFromDataUrl(dataUrl, name)`,
  plus `customThemes()` / `aliases()` inspectors.
- `src/injector.mjs` — idempotent CSS+menu injection and removal.
- `src/constants.mjs`, `src/theme-schema.mjs`, `src/theme-store.mjs` — config & theme model.
- `scripts/apply.command` / `pause.command` — macOS launchers.
- `scripts/apply.ps1` / `pause.ps1` / `find-workbuddy.ps1` — Windows launchers.
- `themes/` — 10 built-in theme folders (`theme.json` + `hero.webp`).
- `README.md` — full human-readable documentation.

## One-line summary for the user

> "I cloned workbuddy-skin-studio, restarted WorkBuddy in debug mode, and injected
> the theme. Use the 🎨 button (top-right) to switch or revert. Re-run apply if
> you restart WorkBuddy manually."
