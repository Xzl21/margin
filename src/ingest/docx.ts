/**
 * DOCX 预处理：mammoth 不认识 Word 的公式（OMML），会把整段公式丢掉。
 * 这里先把 document.xml 里的公式换成 MathML 占位符，再重新打包成 zip；
 * mammoth 转完 HTML 后，调用方把占位符替换回 MathML 即可。
 *
 * 未改动的条目按原始压缩字节复制，图片不会被解开再压一遍。
 */

import { ommlToMathml } from './omml'
import { decodeZipText, readZipEntries, readZipEntry, readZipEntryRaw, writeZip, type ZipEntry } from './zip'

const MATH_TAG = /<m:oMathPara\b[^>]*>[\s\S]*?<\/m:oMathPara>|<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>/g

export interface DocxPrepared {
  data: ArrayBuffer
  math: string[]
}

export const mathToken = (i: number) => `@@EQ${i}@@`

export function replaceMathTokens(html: string, math: string[]): string {
  let out = html
  for (let i = 0; i < math.length; i++) out = out.split(mathToken(i)).join(math[i])
  return out
}

export async function docxWithMath(buffer: ArrayBuffer): Promise<DocxPrepared> {
  const bytes = new Uint8Array(buffer)
  let entries: Map<string, ZipEntry>
  try {
    entries = readZipEntries(bytes)
  } catch {
    return { data: buffer, math: [] }
  }
  const docEntry = entries.get('word/document.xml')
  if (!docEntry) return { data: buffer, math: [] }

  let xml = ''
  try {
    xml = decodeZipText(await readZipEntry(bytes, docEntry))
  } catch {
    return { data: buffer, math: [] }
  }
  if (!xml.includes('<m:oMath')) return { data: buffer, math: [] }

  const math: string[] = []
  const replaced = xml.replace(MATH_TAG, (chunk) => {
    const display = /^<m:oMathPara/.test(chunk)
    const ml = ommlToMathml(chunk, display)
    if (!ml) return ''
    const token = mathToken(math.length)
    math.push(ml)
    return `<w:r><w:t>${token}</w:t></w:r>`
  })
  if (!math.length) return { data: buffer, math: [] }

  const encoder = new TextEncoder()
  const files = [...entries.values()].map((entry) =>
    entry.name === 'word/document.xml'
      ? { name: entry.name, data: encoder.encode(replaced) }
      : {
          name: entry.name,
          raw: readZipEntryRaw(bytes, entry),
          method: entry.method,
          crc: entry.crc,
          size: entry.size,
        },
  )
  const packed = writeZip(files)
  return { data: packed.buffer as ArrayBuffer, math }
}
