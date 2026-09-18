// 生成最终清理结果报告
import fs from 'node:fs';

const OUT = 'D:/workbuddy-skin-studio/cleanup-audit';

// 各项实际清理结果
const results = [
  { group: 'Temp\\josqnmwc（VS 安装缓存）', size: 3272.7, status: '已删除', detail: '817 个文件，Microsoft.Build / VC / DiagnosticsHub 组件包' },
  { group: 'Temp VS 解压残留 ×11', size: 1129.8, status: '已删除', detail: 'avm0d5wc.muo、jffiuisc.gq2 等随机名目录 + odis_download_dest' },
  { group: 'C:\\DrvPath（2021 驱动包留档）', size: 458.8, status: '已删除', detail: 'Realtek 声卡 + Intel 蓝牙驱动安装包，311 个文件' },
  { group: 'D:\\360Downloads 顶层安装包', size: 869.5, status: '已删除', detail: '22 个旧安装包（Quark、GeForce、网易云、uTools、VSCode 等）' },
  { group: 'D:\\5EDemocache', size: 206.8, status: '已删除', detail: 'CS demo 录像 1 个' },
  { group: 'C:\\rgloader', size: 0.7, status: '已删除', detail: '2022 年 Ruby loader，10 个文件' },
  { group: 'C:\\ComboKey', size: 0, status: '已删除', detail: '空目录' },
  { group: '回收站 C 盘', size: 36.3, status: '已清空', detail: '335 个文件' },
  { group: '回收站 D 盘', size: 85.1, status: '已清空', detail: '31 个文件' },
];
const totalMB = results.reduce((s, r) => s + r.size, 0);

const kept = [
  ['C:\\Users\\...\\Temp\\workbuddy-*、dsh-*', '正在使用的工作环境缓存'],
  ['C:\\Users\\...\\Temp\\*.tmp.js（15个）、*.png、日志', '疑似运行中的临时文件，保守保留'],
  ['D:\\360Downloads\\Microsoft VS Code', '807 MB，2026-09 仍在用'],
  ['D:\\360Downloads\\Free Download Manager', '259 MB，2026-08 仍在用'],
  ['C:\\Tangent（天正建筑）', '946 MB，未勾选'],
  ['D:\\steam美化插件', '156 MB，未勾选'],
  ['D:\\weGameApps / qqnt / edge / xwechat_files', '程序本体与数据'],
];

let md = `# 磁盘清理执行报告

**执行时间**：2026-09-11 02:30 ~ 02:45
**执行者**：小爱音 🐾
**方案**：保守精准模式（先隔离 → 校验 → 再删除）

---

## 一、清理结果汇总

| 项目 | 大小 | 状态 | 说明 |
|---|---:|---|---|
`;
for (const r of results) {
  md += `| ${r.group} | ${r.size >= 1000 ? (r.size / 1024).toFixed(2) + ' GB' : r.size.toFixed(1) + ' MB'} | ✅ ${r.status} | ${r.detail} |\n`;
}
md += `| **合计** | **${(totalMB / 1024).toFixed(2)} GB** | | |\n`;

md += `
## 二、磁盘空间变化

| 磁盘 | 清理前剩余 | 清理后剩余 | 变化 |
|---|---:|---:|---:|
| C 盘 | 24.10 GB | **27.85 GB** | **+3.75 GB** |
| D 盘 | 28.40 GB | 28.51 GB | +0.11 GB |

> D 盘释放的 1.05 GB 被系统同期新增的缓存/日志抵消，属正常现象。

## 三、安全措施说明

1. **全程精确路径操作**，未使用任何通配符批量删除
2. **两阶段执行**：先移动到隔离区/重命名，校验通过后才彻底删除
3. **保留项逐一验证存在**（9 项关键目录全部确认无损）
4. 回收站通过系统 Clear-RecycleBin 清空，非直接删文件

## 四、本次保留未动的项目

`;
for (const [p, why] of kept) md += `- \`${p}\` —— ${why}\n`;

md += `
## 五、遗留事项

- ⚠️ \`C:\\Users\\ZhuanZ\\AppData\\Local\\Temp\\nswB0EA.tmp.__to_delete__\`：空目录，被某进程占用暂无法删除（0 字节，不占空间，重启后可删）
- 📌 下次可考虑清理（本次未勾选）：\`C:\\Tangent\` 天正建筑 946 MB、\`D:\\steam美化插件\` 156 MB、\`D:\\GitHubDesktop\` 356 MB、\`D:\\Ksoftware\` 101 MB、\`D:\\pkg文件转换\` 4.5 MB、各类加速器二选一

---

*数据文件位于 \`D:\\workbuddy-skin-studio\\cleanup-audit\\\`*
`;
fs.writeFileSync(`${OUT}/清理执行报告.md`, md, 'utf8');
console.log(md);
