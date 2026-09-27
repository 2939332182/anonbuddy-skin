// 最小 ZIP 写入器（stored / deflate，UTF-8 文件名）
//
// 为什么要自己写：Node 没有内置的 ZIP 写入 API，而打包脚本不想为了这一个用途
// 引入第三方依赖。这里只实现发布包真正用得到的那部分子集：
//
//   - 每个条目 = 本地文件头 + 数据 + 中央目录记录，结尾一个 EOCD
//   - 压缩方式：deflate（只有更小才用）或 stored，CRC-32 一律对原始数据算
//   - 文件名一律正斜杠，并置位 11（UTF-8）—— APPNOTE 4.4.17.1 要求正斜杠，
//     1.0.0 那版就是栽在反斜杠上；中文文件名没有位 11 会变乱码
//   - 外部属性固定 0o100644：Windows 上没有 Unix mode 可继承，不显式写就会
//     落到 0o666，解压方看到的是"人人可写"
//
// 参考：PKWARE APPNOTE.TXT 4.3.6 / 4.3.7 / 4.3.12 / 4.3.16

import { deflateRawSync } from "node:zlib";

/** 标准 CRC-32（IEEE 802.3）查表 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const DOS_EPOCH = 1980;

/** ZIP 用的是 DOS 时间戳：秒只有 5 位，所以要除以 2 */
function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), DOS_EPOCH);
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - DOS_EPOCH) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

// 高字节 3 = Unix，这样 external_attr 才会被当作 Unix mode 解释
const VERSION_UNIX = (3 << 8) | 30;
// 注意：0o100644 << 16 会超出有符号 32 位变成负数，必须 >>> 0 转回无符号，
// 否则 writeUInt32LE 会直接抛 RangeError
const EXTERNAL_ATTR = (0o100644 << 16) >>> 0;

/**
 * @param {Array<{ name: string, data: Buffer, date?: Date }>} entries
 *   name 用正斜杠分隔、不带前导斜杠；data 是未压缩内容
 * @returns {Buffer} 完整 zip 字节
 */
export function createZip(entries) {
  const parts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = entry.data;
    const deflated = deflateRawSync(raw, { level: 9 });
    // 压完反而更大就存原样，和主流 zip 实现一致
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const sum = crc32(raw);
    const { time, date } = dosDateTime(entry.date ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION_UNIX & 0xffff, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION_UNIX, 4);
    central.writeUInt16LE(VERSION_UNIX & 0xffff, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(EXTERNAL_ATTR, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length & 0xffff, 8);
  eocd.writeUInt16LE(entries.length & 0xffff, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralBuf, eocd]);
}

/**
 * 自检：从末尾的 EOCD 反向走一遍中央目录，确认条目名都是正斜杠、条数对得上。
 * 打包脚本在写盘前会跑一次，避免又把反斜杠发出去。
 *
 * 注意不要用 buf.indexOf(签名数字) 去找记录：Buffer.indexOf 收到 number 时
 * 只匹配那一个字节，会停在压缩数据里随便一个 0x50 上。从 EOCD 走偏移才是对的。
 */
export function verifyZipNames(buf) {
  const eocd = buf.length - 22; // 我们从不写归档注释，所以 EOCD 是定长的最后 22 字节
  if (eocd < 0 || buf.readUInt32LE(eocd) !== EOCD_SIG) {
    throw new Error("找不到 EOCD 记录，zip 尾部不完整");
  }
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const names = [];
  let at = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(at) !== CENTRAL_SIG) {
      throw new Error(`第 ${i + 1} 条中央目录记录签名不对（偏移 ${at}）`);
    }
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    names.push(buf.subarray(at + 46, at + 46 + nameLen).toString("utf8"));
    at += 46 + nameLen + extraLen + commentLen;
  }

  const backslashes = names.filter((n) => n.includes("\\"));
  return { names, backslashes };
}
