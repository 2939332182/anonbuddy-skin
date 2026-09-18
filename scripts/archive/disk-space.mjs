import fs from 'node:fs';
for (const d of ['C:/', 'D:/']) {
  try {
    const s = fs.statfsSync(d);
    const free = s.bavail * s.bsize;
    const total = s.blocks * s.bsize;
    console.log(`${d}  Free=${(free / 1073741824).toFixed(2)} GB / Total=${(total / 1073741824).toFixed(1)} GB / Used=${((total - free) / 1073741824).toFixed(1)} GB`);
  } catch (e) { console.log(d, 'ERR', e.message); }
}
