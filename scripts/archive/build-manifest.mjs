// 生成最终精确删除清单（保守方案）
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/workbuddy-skin-studio/cleanup-audit';
const MANIFEST = `${OUT}/delete-manifest.json`;

function dirSize(d, n = 0) {
  if (n > 30) return { size: 0, count: 0 };
  let size = 0, count = 0, es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return { size: 0, count: 0 }; }
  for (const e of es) {
    const f = path.join(d, e.name);
    try {
      if (e.isFile()) { size += fs.statSync(f).size; count++; }
      else if (e.isDirectory()) { const r = dirSize(f, n + 1); size += r.size; count += r.count; }
    } catch {}
  }
  return { size, count };
}
const exists = p => fs.existsSync(p);

const items = [];   // {group, path, size, count, note}
const addDir = (group, p, note) => {
  if (!exists(p)) return;
  const r = dirSize(p);
  items.push({ group, path: p, type: 'dir', size: r.size, count: r.count, note });
};
const addFile = (group, p, note) => {
  if (!exists(p)) return;
  let st; try { st = fs.statSync(p); } catch { return; }
  items.push({ group, path: p, type: 'file', size: st.size, count: 1, note });
};

// ============ 1. Temp: josqnmwc ============
addDir('temp-josqnmwc', 'C:/Users/ZhuanZ/AppData/Local/Temp/josqnmwc', 'VS 安装缓存');

// ============ 2. Temp: VS 残留（保守：只清确定是 VS 的）============
{
  const tmp = 'C:/Users/ZhuanZ/AppData/Local/Temp';
  let es = [];
  try { es = fs.readdirSync(tmp, { withFileTypes: true }); } catch {}
  for (const e of es) {
    const name = e.name;
    const full = path.join(tmp, name);
    // 必须是目录
    if (!e.isDirectory()) continue;
    // --- 明确的保留白名单 ---
    if (/^(workbuddy|dsh|vs|vscode|npm|NuGet|clr-debug)/i.test(name)) continue;
    if (/^\./.test(name)) continue;

    // --- 判定 VS 安装/解压残留 ---
    const isVSComp = /^Microsoft\.[A-Za-z0-9_.]+?\.[0-9A-F]{16,}$/i.test(name);  // Microsoft.XXX.哈希
    const isOdis   = /^odis_/i.test(name);                                        // odis_download_dest
    const isRandDir= /^[a-z0-9]{5,9}\.[a-z0-9]{3}$/i.test(name);                  // avm0d5wc.muo
    const isGUIDish= /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(name);

    if (!(isVSComp || isOdis || isRandDir)) continue;
    if (isGUIDish) continue;  // GUID 命名的子目录可能是运行中的，保守保留

    // 内容抽查：VS 残留目录里必有 Microsoft.* 子项
    let looksVS = false;
    try {
      const sub = fs.readdirSync(full).slice(0, 30);
      looksVS = sub.some(s => /^Microsoft\./i.test(s)) || sub.length === 0;
    } catch { looksVS = false; }
    if (!looksVS) continue;

    addDir('temp-others', full, isOdis ? 'VS 下载缓存' : (isVSComp ? 'VS 组件缓存' : 'VS 解压残留'));
  }
}

// ============ 3. C:\DrvPath ============
addDir('drvpath', 'C:/DrvPath', '2021 驱动安装包留档');

// ============ 4. D:\5EDemocache ============
addDir('5edemo', 'D:/5EDemocache', 'CS demo 缓存');

// ============ 5. C:\rgloader ============
addDir('rgloader', 'C:/rgloader', '2022 Ruby 残留');

// ============ 6. C:\ComboKey（空目录）============
{
  const p = 'C:/ComboKey';
  if (exists(p)) {
    let n = -1; try { n = fs.readdirSync(p).length; } catch {}
    if (n === 0) items.push({ group: 'combokey', path: p, type: 'dir', size: 0, count: 0, note: '空目录' });
    else { const r = dirSize(p); items.push({ group: 'combokey', path: p, type: 'dir', size: r.size, count: r.count, note: '⚠非空，请复核' }); }
  }
}

// ============ 7. D:\360Downloads 顶层安装包 ============
{
  const p = 'D:/360Downloads';
  let es = []; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch {}
  const PKG = /\.(exe|msi|7z|zip|rar|tar\.gz|cab|pdf)$/i;
  for (const e of es) {
    if (e.isFile() && PKG.test(e.name)) {
      addFile('360dl', path.join(p, e.name), '旧安装包/压缩包');
    }
  }
  // Magpie 的散落文件（2024-06 的 dll/资源，非程序目录）
  addFile('360dl', `${p}/Microsoft.UI.Xaml.dll`, 'Magpie 散落文件');
  addFile('360dl', `${p}/Magpie.App.dll`, 'Magpie 散落文件');
  addFile('360dl', `${p}/resources.pri`, 'Magpie 散落文件');
}

// ============ 8. 回收站（单独标记，用系统方式清）============
items.push({ group: 'recycle', path: 'C:/$RECYCLE.BIN', type: 'shell', size: 36.29 * 1048576, count: 335, note: '回收站，走系统清空' });
items.push({ group: 'recycle', path: 'D:/$RECYCLE.BIN', type: 'shell', size: 85.08 * 1048576, count: 31, note: '回收站，走系统清空' });

// 汇总
const total = items.reduce((s, i) => s + i.size, 0);
const byGroup = {};
for (const i of items) {
  if (!byGroup[i.group]) byGroup[i.group] = { size: 0, count: 0, n: 0 };
  byGroup[i.group].size += i.size;
  byGroup[i.group].count += i.count;
  byGroup[i.group].n++;
}

fs.writeFileSync(MANIFEST, JSON.stringify(items, null, 2), 'utf8');

let rep = '===== 最终删除清单（保守方案）=====\n\n';
for (const [g, v] of Object.entries(byGroup)) {
  rep += `【${g}】${v.n} 项 / ${(v.size / 1048576).toFixed(1)} MB / ${v.count} 个文件\n`;
  for (const i of items.filter(x => x.group === g)) {
    rep += `    ${String((i.size / 1048576).toFixed(1)).padStart(9)} MB  ${i.path}${i.note ? '   # ' + i.note : ''}\n`;
  }
  rep += '\n';
}
rep += `\n合计: ${(total / 1073741824).toFixed(2)} GB / ${items.reduce((s, i) => s + i.count, 0)} 个文件 / ${items.length} 个条目\n`;

fs.writeFileSync(`${OUT}/待清理清单-最终.txt`, rep, 'utf8');
console.log(rep);
console.log('MANIFEST=' + MANIFEST);
