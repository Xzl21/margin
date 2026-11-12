/**
 * EPUB 解析：EPUB 就是一个 zip，里面是 OPF 清单 + 若干 XHTML。
 * 这里只依赖浏览器内置的 DecompressionStream，不引第三方解压库，
 * 因为阅读器只需要正文与标题，不需要图片、字体和 DRM。
 */

import { decodeZipText, readZipEntries, readZipEntry } from './zip'

const decode = decodeZipText

/** 把 OPF 里的相对路径解析成 zip 内绝对路径 */
function resolvePath(base: string, href: string): string {
  const parts = (base ? base.split('/') : []).concat(href.split('/'))
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(decodeURIComponent(part))
  }
  return stack.join('/')
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function textOf(doc: Document, tag: string): string {
  const el = doc.getElementsByTagName(tag)[0]
  return (el?.textContent ?? '').trim()
}

/** 单个标签里的属性值；单双引号都认 */
function attrOf(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? (m[2] ?? m[3] ?? '') : ''
}

function bodyHtml(xhtml: string): string {
  const doc = new DOMParser().parseFromString(xhtml, 'text/html')
  const body = doc.body
  if (!body) return ''
  // 去掉 EPUB 自带的脚注链接与导航，避免把页眉页脚切成一堆碎块
  body.querySelectorAll('script, style, nav, link, meta').forEach((el) => el.remove())
  return body.innerHTML
}

export type EpubContent = { title: string; html: string }

export async function readEpub(bytes: Uint8Array, fallbackTitle: string): Promise<EpubContent> {
  const entries = readZipEntries(bytes)

  const containerEntry = entries.get('META-INF/container.xml')
  if (!containerEntry) throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml')
  const containerText = decode(await readZipEntry(bytes, containerEntry))
  const container = new DOMParser().parseFromString(containerText, 'application/xml')
  const rootfile =
    container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') ||
    attrOf(/<rootfile\b[^>]*>/i.exec(containerText)?.[0] ?? '', 'full-path')
  if (!rootfile) throw new Error('不是有效的 EPUB：container.xml 里没有 rootfile')
  const opfPath = resolvePath('', rootfile)
  const opfEntry = entries.get(opfPath)
  if (!opfEntry) throw new Error('EPUB 的 OPF 清单缺失')
  const opfText = decode(await readZipEntry(bytes, opfEntry))
  const opf = new DOMParser().parseFromString(opfText, 'application/xml')
  const opfDir = dirOf(opfPath)

  const title =
    textOf(opf, 'dc:title') ||
    /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opfText)?.[1]?.trim() ||
    fallbackTitle

  const manifest = new Map<string, { href: string; type: string; props: string }>()
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, {
      href: resolvePath(opfDir, href),
      type: item.getAttribute('media-type') ?? '',
      props: item.getAttribute('properties') ?? '',
    })
  }
  // 有些解析器对命名空间 XML 支持不完整，补一条按文本扫描的退路
  if (manifest.size === 0) {
    for (const tag of opfText.match(/<item\b[^>]*>/gi) ?? []) {
      const id = attrOf(tag, 'id')
      const href = attrOf(tag, 'href')
      if (!id || !href) continue
      manifest.set(id, {
        href: resolvePath(opfDir, href),
        type: attrOf(tag, 'media-type'),
        props: attrOf(tag, 'properties'),
      })
    }
  }

  let order = Array.from(opf.getElementsByTagName('itemref'))
    .map((ref) => ref.getAttribute('idref'))
    .filter((id): id is string => Boolean(id))
    .map((id) => manifest.get(id))
    .filter((item): item is { href: string; type: string; props: string } => Boolean(item))

  if (order.length === 0) {
    const refs = Array.from(opfText.matchAll(/<itemref\b[^>]*>/gi)).map((m) => attrOf(m[0], 'idref'))
    order = refs.map((id) => manifest.get(id)).filter((item): item is { href: string; type: string; props: string } => Boolean(item))
    if (order.length === 0) {
      order = Array.from(manifest.values()).filter(
        (item) => /xhtml|html/.test(item.type) && !item.props.includes('nav'),
      )
    }
  }

  const chunks: string[] = []
  for (const item of order) {
    if (!/xhtml|html/.test(item.type) && !/\.x?html?$/i.test(item.href)) continue
    const entry = entries.get(item.href) ?? entries.get(encodeURI(item.href)) ?? entries.get(decodeURIComponent(item.href))
    if (!entry) continue
    const html = bodyHtml(decode(await readZipEntry(bytes, entry)))
    if (html.trim()) chunks.push(html)
  }

  if (chunks.length === 0) throw new Error('EPUB 里没有可读的正文（可能是纯图片或加密书）')

  // 章节之间用分隔标记，正文切块时不会串段
  return { title: title || fallbackTitle, html: chunks.join('\n<hr/>\n') }
}
