// 安全清理执行器：先移动到隔离区（可恢复），再删除
// 用法: node clean-execute.mjs [--purge]
//   不带参数 = 移动到隔离区
//   带 --purge = 从隔离区彻底删除
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/anonbuddy-skin/cleanup-audit';
const QDIR = `${OUT}/_quarantine`;
const MANIFEST = `${OUT}/delete-manifest.json`;
const mode = process.argv.includes('--purge') ? 'purge' : 'quarantine';

const items = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const log = [];
const say = s => { console.log(s); log.push(s); };

fs.mkdirSync(OUT, { recursive: true });

function moveToQuarantine(src, destBase) {
  // 计算隔离区里的目标路径，保留原盘符结构
  const norm = src.replace(/^([A-Za-z]):[\\/]/, '$1/');
  const rel = norm.replace(/[\\/]/g, '__');
  const dest = path.join(destBase, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    // 已存在则加时间戳
    const dest2 = dest + '_' + Date.now();
    fs.renameSync(src, dest2);
    return dest2;
  }
  fs.renameSync(src, dest);
  return dest;
}

if (mode === 'quarantine') {
  say(`\n=== 阶段1：移动到隔离区 ${QDIR} ===\n`);
  fs.mkdirSync(QDIR, { recursive: true });
  let ok = 0, fail = 0, moved = 0;
  for (const it of items) {
    if (it.type === 'shell') { say(`[跳过-单独处理] ${it.path} (${it.note})`); continue; }
    if (!fs.existsSync(it.path)) { say(`[已不存在] ${it.path}`); continue; }
    try {
      const dest = moveToQuarantine(it.path, QDIR);
      say(`[OK] ${(it.size / 1048576).toFixed(1)} MB  ${it.path}`);
      ok++; moved += it.size;
    } catch (e) {
      say(`[失败] ${it.path}  ->  ${e.code || ''} ${e.message}`);
      fail++;
    }
  }
  say(`\n移动完成: 成功 ${ok} 项 / 失败 ${fail} 项，共 ${(moved / 1073741824).toFixed(2)} GB`);
  say(`隔离区: ${QDIR}`);
  say(`\n确认无误后，执行 purge 彻底删除隔离区内容。`);
}

if (mode === 'purge') {
  say(`\n=== 阶段2：彻底删除隔离区 ===\n`);
  if (!fs.existsSync(QDIR)) { say('隔离区不存在，无需清理'); }
  else {
    let total = 0, cnt = 0;
    const walk = d => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const x of e) { const f = path.join(d, x.name); if (x.isDirectory()) walk(f); else { try { total += fs.statSync(f).size; cnt++; } catch {} } } };
    walk(QDIR);
    try {
      fs.rmSync(QDIR, { recursive: true, force: true, maxRetries: 3 });
      say(`[OK] 已删除隔离区全部内容: ${(total / 1073741824).toFixed(2)} GB / ${cnt} 个文件`);
    } catch (err) {
      say(`[失败] 删除隔离区出错: ${err.message}`);
    }
  }
}

fs.writeFileSync(`${OUT}/clean-log-${mode}.txt`, log.join('\n'), 'utf8');
