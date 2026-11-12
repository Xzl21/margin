/**
 * 浏览器里的最小 zip 读写。
 *
 * 读：扫尾部中央目录，method 0 直接取，method 8 交给浏览器内置的
 * DecompressionStream('deflate-raw')，不引第三方解压库。
 * 写：只做 stored（不压缩），给 DOCX 公式预处理用——把改过的 document.xml
 * 重新包成一个 mammoth 能读的 zip。
 */

export type ZipEntry = {
  name: string
  method: number
  compSize: number
  size: number
  crc: number
  offset: number
}

export type ZipInput = {
  name: string
  /** 未压缩的新内容（会以 stored 方式写入） */
  data?: Uint8Array
  /** 原始压缩字节，配合 method/crc/size 原样复制，避免解压再压 */
  raw?: Uint8Array
  method?: number
  crc?: number
  size?: number
}

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

const u16 = (dv: DataView, off: number) => dv.getUint16(off, true)
const u32 = (dv: DataView, off: number) => dv.getUint32(off, true)

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function findEocd(dv: DataView): number {
  const min = Math.max(0, dv.byteLength - 0xffff - 22)
  for (let i = dv.byteLength - 22; i >= min; i--) {
    if (u32(dv, i) === EOCD_SIG) return i
  }
  throw new Error('不是有效的压缩包：找不到 zip 目录')
}

export function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const dv = viewOf(bytes)
  const eocd = findEocd(dv)
  const count = u16(dv, eocd + 10)
  let off = u32(dv, eocd + 16)
  const out = new Map<string, ZipEntry>()
  const decoder = new TextDecoder('utf-8')

  for (let i = 0; i < count; i++) {
    if (u32(dv, off) !== CENTRAL_SIG) break
    const method = u16(dv, off + 10)
    const crc = u32(dv, off + 16)
    const compSize = u32(dv, off + 20)
    const size = u32(dv, off + 24)
    const nameLen = u16(dv, off + 28)
    const extraLen = u16(dv, off + 30)
    const commentLen = u16(dv, off + 32)
    const localOff = u32(dv, off + 42)
    const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen))
    // zip64 的条目（尺寸/偏移为 0xffffffff）这里不支持，跳过即可
    if (compSize !== 0xffffffff && localOff !== 0xffffffff) {
      out.set(name, { name, method, compSize, size, crc, offset: localOff })
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** 原始（压缩后）字节，用于把未改动的条目原样搬进新包 */
export function readZipEntryRaw(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const dv = viewOf(bytes)
  if (u32(dv, entry.offset) !== LOCAL_SIG) throw new Error(`压缩包条目损坏：${entry.name}`)
  const nameLen = u16(dv, entry.offset + 26)
  const extraLen = u16(dv, entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  return bytes.subarray(start, start + entry.compSize)
}

export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const dv = viewOf(bytes)
  if (u32(dv, entry.offset) !== LOCAL_SIG) throw new Error(`压缩包条目损坏：${entry.name}`)
  const nameLen = u16(dv, entry.offset + 26)
  const extraLen = u16(dv, entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  const raw = bytes.subarray(start, start + entry.compSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error(`不支持的压缩方式（${entry.method}）：${entry.name}`)
  const stream = new Blob([raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function decodeZipText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

// ---------- 写 ----------

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

/** 生成一个 zip。新内容写成 stored；未改动的条目可直接原样复制（保留 method）。 */
export function writeZip(files: ZipInput[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(new Date())
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = enc.encode(file.name)
    const data = file.raw ?? file.data ?? new Uint8Array(0)
    const method = file.raw ? (file.method ?? 0) : 0
    const crc = file.crc ?? crc32(file.data ?? data)
    const size = file.size ?? file.data?.length ?? data.length
    const local = new Uint8Array(30 + nameBytes.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, LOCAL_SIG, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, 0, true)
    dv.setUint16(8, method, true)
    dv.setUint16(10, time, true)
    dv.setUint16(12, date, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, data.length, true)
    dv.setUint32(22, size, true)
    dv.setUint16(26, nameBytes.length, true)
    dv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    chunks.push(local, data)

    const cen = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, CENTRAL_SIG, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    cen.set(nameBytes, 46)
    central.push(cen)

    offset += local.length + data.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, EOCD_SIG, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const total = offset + centralSize + end.length
  const out = new Uint8Array(total)
  let p = 0
  for (const chunk of chunks) {
    out.set(chunk, p)
    p += chunk.length
  }
  for (const chunk of central) {
    out.set(chunk, p)
    p += chunk.length
  }
  out.set(end, p)
  return out
}
