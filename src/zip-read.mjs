// 零依赖 ZIP 读取器 —— 只做「一键更新」需要的那点事：列出条目、取出某个条目的字节。
//
// 为什么自己写：packaging/zip.mjs 是**写入器**，解包需要读取；而为了一个功能引入
// 依赖包不符合这个项目的口径（零运行时依赖）。Node 自带 zlib，剩下的只是解析结构。
//
// ZIP 的骨架（APPNOTE 4.3）：
//   本地文件头  PK\x03\x04  每个条目一份，后面紧跟压缩数据
//   中央目录    PK\x01\x02  每个条目一份，含压缩方式与本地头偏移
//   EOCD        PK\x05\x06  文件尾部，指向中央目录
// 从 EOCD 反向解析（不信任何偏移之外的猜测），这也是 packaging/zip.mjs 校验时的做法。

import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

/** EOCD 之后最多还有 65535 字节的注释，所以从尾部向前最多搜这么远 */
const MAX_COMMENT = 65535;

/**
 * 列出 ZIP 内的条目（不解压数据）。
 * @returns {Array<{name:string, method:number, compSize:number, uncompSize:number, localOffset:number}>}
 */
export function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("ZIP 太小");
  const floor = Math.max(0, buf.length - MAX_COMMENT - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是 ZIP：找不到 EOCD");

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset <= 0 || cdOffset >= buf.length) throw new Error("中央目录偏移越界");

  const out = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) throw new Error(`中央目录第 ${i} 项损坏`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 取出一个条目的**解压后**字节 */
export function readZipFile(buf, entry) {
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LFH_SIG) throw new Error(`本地文件头损坏：${entry.name}`);
  // 本地头里的名称/扩展区长度可能与中央目录不同（规范允许），所以按本地头自己的来
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const end = start + entry.compSize;
  if (end > buf.length) throw new Error(`数据越界：${entry.name}`);
  const raw = buf.subarray(start, end);
  // 0 = 存储，8 = deflate。其余（bzip2/lzma/…）本项目不会遇到，明确报错而不是静默出错。
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`);
}

/** 包里第一层目录名（打包器会套一层 `chihayaanon-skin-<版本>-<edition>/`），没有则返回 "" */
export function detectRootPrefix(entries) {
  const first = entries.find((entry) => !entry.name.endsWith("/"));
  if (!first) return "";
  const slash = first.name.indexOf("/");
  return slash < 0 ? "" : first.name.slice(0, slash + 1);
}
