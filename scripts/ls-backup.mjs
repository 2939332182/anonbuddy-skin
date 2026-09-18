// 备份 / 恢复 renderer 的 localStorage 关键键（测试前保命用）
// 用法：node scripts/ls-backup.mjs dump|restore <file> [port]
import { readFile, writeFile } from "node:fs/promises";

import { fetchRendererTargets, CdpSession } from "../src/cdp-client.mjs";

const KEYS = [
  "workbuddyCustomTheme",
  "workbuddyCustomThemes",
  "workbuddySkinMenuPos",
  "workbuddySkinAliases",
  "workbuddySkinLastTheme",
];
const [mode = "dump", file = "outputs/ls-backup.json", portArg = "9333"] = process.argv.slice(2);
const PORT = Number(portArg);

const targets = await fetchRendererTargets(PORT);
const session = new CdpSession(targets[0].webSocketDebuggerUrl);
await session.open();

if (mode === "dump") {
  const snapshot = await session.evaluate(
    `(() => { const out = {}; for (const k of ${JSON.stringify(KEYS)}) out[k] = localStorage.getItem(k); return out; })()`,
  );
  await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`DUMP -> ${file}`);
  for (const [k, v] of Object.entries(snapshot)) console.log(`  ${k}: ${v === null ? "(absent)" : `${String(v).length} chars`}`);
} else {
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  const result = await session.evaluate(`(() => {
    const data = ${JSON.stringify(snapshot)};
    for (const [k, v] of Object.entries(data)) {
      if (v === null || v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
    return Object.keys(data).length;
  })()`);
  console.log(`RESTORE <- ${file} (${result} keys)`);
}

session.close();
