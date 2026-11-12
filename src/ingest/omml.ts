/**
 * OMML（Word 公式）→ MathML 子集。
 *
 * mammoth 只认段落和文字，遇到 <m:oMath> 会整段丢掉，所以 Word 里的公式
 * 在网页上直接消失。这里的做法是：先把 document.xml 里的公式抽出来翻成
 * MathML，塞成占位符；mammoth 转完 HTML 后再把占位符换回 MathML，
 * 最后由 DOMPurify 放行 MathML 标签。
 *
 * 只覆盖常见的数学结构，遇到不认识的元素就递归拼子节点，保证不丢内容。
 */

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const local = (el: Element): string => el.localName || el.nodeName.replace(/^.*:/, '')

const kids = (el: Element | null | undefined): Element[] => (el ? Array.from(el.children) : [])

function child(el: Element | null | undefined, name: string): Element | undefined {
  return kids(el).find((k) => local(k) === name)
}

function deepText(el: Element): string {
  let out = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) out += node.nodeValue ?? ''
    else if (node.nodeType === 1) {
      const e = node as Element
      if (local(e) === 't') out += e.textContent ?? ''
      else out += deepText(e)
    }
  }
  return out
}

/** 取属性值：m:val 或者 val */
function val(el: Element | null | undefined): string {
  if (!el) return ''
  return el.getAttributeNS(MATH_NS, 'val') || el.getAttribute('m:val') || el.getAttribute('val') || ''
}

function prop(el: Element, name: string): Element | undefined {
  return kids(el).find((k) => local(k) === name)
}

function propVal(el: Element, name: string, chr: string): string {
  return val(child(prop(el, name), chr))
}

function row(html: string): string {
  return html ? `<mrow>${html}</mrow>` : '<mrow></mrow>'
}

function convChildren(el: Element | null | undefined): string {
  if (!el) return ''
  return kids(el)
    .map((k) => conv(k))
    .join('')
}

function conv(el: Element): string {
  const name = local(el)
  switch (name) {
    case 'oMath':
    case 'oMathPara':
      return convChildren(el)

    case 'r':
    case 't': {
      const text = deepText(el)
      if (!text) return ''
      const trimmed = text.trim()
      if (/^[0-9.]+$/.test(trimmed)) return `<mn>${escapeXml(trimmed)}</mn>`
      if (/^[+\-=<>±×÷≤≥≠≈∑∏∫√∞]$/.test(trimmed)) return `<mo>${escapeXml(trimmed)}</mo>`
      if (/^[A-Za-z\u0370-\u03ff]$/.test(trimmed)) return `<mi>${escapeXml(trimmed)}</mi>`
      return `<mtext>${escapeXml(text)}</mtext>`
    }

    case 'f': {
      const num = child(el, 'num')
      const den = child(el, 'den')
      return `<mfrac>${row(convChildren(num ?? el))}${row(convChildren(den ?? el))}</mfrac>`
    }

    case 'sSub':
    case 'sSup':
    case 'sSubSup': {
      const base = row(convChildren(child(el, 'e')))
      const sub = row(convChildren(child(el, 'sub')))
      const sup = row(convChildren(child(el, 'sup')))
      if (name === 'sSub') return `<msub>${base}${sub}</msub>`
      if (name === 'sSup') return `<msup>${base}${sup}</msup>`
      return `<msubsup>${base}${sub}${sup}</msubsup>`
    }

    case 'rad': {
      const deg = child(el, 'deg')
      const body = child(el, 'e')
      const hasDeg = deg && deepText(deg).trim()
      return hasDeg
        ? `<mroot>${row(convChildren(body))}${row(convChildren(deg))}</mroot>`
        : `<msqrt>${row(convChildren(body))}</msqrt>`
    }

    case 'nary': {
      const chr = propVal(el, 'naryPr', 'chr') || '∫'
      const sub = child(el, 'sub')
      const sup = child(el, 'sup')
      const body = child(el, 'e')
      const op = `<mo>${escapeXml(chr)}</mo>`
      let head = op
      if (sub && sup) head = `<msubsup>${op}${row(convChildren(sub))}${row(convChildren(sup))}</msubsup>`
      else if (sub) head = `<msub>${op}${row(convChildren(sub))}</msub>`
      else if (sup) head = `<msup>${op}${row(convChildren(sup))}</msup>`
      return `<mrow>${head}${row(convChildren(body))}</mrow>`
    }

    case 'd': {
      const beg = propVal(el, 'dPr', 'begChr') || '('
      const end = propVal(el, 'dPr', 'endChr') || ')'
      const sep = propVal(el, 'dPr', 'sepChr') || '|'
      const parts = kids(el).filter((k) => local(k) === 'e')
      const inner = parts.length
        ? parts.map((p) => row(convChildren(p))).join(`<mo>${escapeXml(sep)}</mo>`)
        : ''
      return `<mrow><mo>${escapeXml(beg)}</mo>${inner}<mo>${escapeXml(end)}</mo></mrow>`
    }

    case 'func': {
      const fName = child(el, 'fName')
      const body = child(el, 'e')
      return `<mrow>${row(convChildren(fName))}<mspace width="0.24em"/>${row(convChildren(body))}</mrow>`
    }

    case 'acc': {
      const chr = propVal(el, 'accPr', 'chr') || '¯'
      return `<mover accent="true">${row(convChildren(child(el, 'e')))}<mo>${escapeXml(chr)}</mo></mover>`
    }

    case 'bar': {
      return `<mover accent="true">${row(convChildren(child(el, 'e')))}<mo>‾</mo></mover>`
    }

    case 'limLow':
      return `<munder>${row(convChildren(child(el, 'e')))}${row(convChildren(child(el, 'lim')))}</munder>`

    case 'limUpp':
      return `<mover>${row(convChildren(child(el, 'e')))}${row(convChildren(child(el, 'lim')))}</mover>`

    case 'm': {
      const rows = kids(el).filter((k) => local(k) === 'mr')
      const body = rows
        .map((r) => `<mtr>${kids(r)
          .filter((k) => local(k) === 'e')
          .map((c) => `<mtd>${row(convChildren(c))}</mtd>`)
          .join('')}</mtr>`)
        .join('')
      return `<mtable>${body}</mtable>`
    }

    case 'eqArr': {
      const body = kids(el)
        .filter((k) => local(k) === 'e')
        .map((c) => `<mtr><mtd>${row(convChildren(c))}</mtd></mtr>`)
        .join('')
      return `<mtable>${body}</mtable>`
    }

    case 'groupChr': {
      const chr = propVal(el, 'groupChrPr', 'chr') || '⏟'
      const pos = propVal(el, 'groupChrPr', 'pos') || 'bot'
      const e = row(convChildren(child(el, 'e')))
      return pos === 'top' ? `<mover>${e}<mo>${escapeXml(chr)}</mo></mover>` : `<munder>${e}<mo>${escapeXml(chr)}</mo></munder>`
    }

    case 'borderBox':
    case 'box':
    case 'phant':
      return convChildren(el)

    case 'rPr':
    case 'ctrlPr':
    case 'fPr':
    case 'sSubPr':
    case 'sSupPr':
    case 'sSubSupPr':
    case 'radPr':
    case 'naryPr':
    case 'dPr':
    case 'funcPr':
    case 'accPr':
    case 'barPr':
    case 'mPr':
    case 'eqArrPr':
    case 'limLowPr':
    case 'limUppPr':
    case 'groupChrPr':
      return ''

    default:
      return convChildren(el)
  }
}

function wrapNamespace(xml: string): string {
  if (/xmlns:m=/.test(xml)) return xml
  return xml.replace(/^<m:oMath/, `<m:oMath xmlns:m="${MATH_NS}"`) 
}

/**
 * 把一个 <m:oMath> / <m:oMathPara> 片段转成 MathML 字符串。
 * 解析失败时返回纯文本 <mtext>，至少不丢公式内容。
 */
export function ommlToMathml(xml: string, display = false): string {
  try {
    const src = wrapNamespace(xml)
    const doc = new DOMParser().parseFromString(
      `<root xmlns:m="${MATH_NS}" xmlns:w="${WORD_NS}">${src}</root>`,
      'application/xml',
    )
    const root = doc.documentElement
    if (!root || root.getElementsByTagName('parsererror').length) throw new Error('xml')
    const first = kids(root)[0]
    if (!first) return ''
    const body = conv(first)
    const math = `<math xmlns="http://www.w3.org/1998/Math/MathML">${body}</math>`
    // 不用 display 属性（净化器会把它和 <math> 一起丢掉），用 span 包一层当块级公式
    return display ? `<span class="eq-block">${math}</span>` : math
  } catch {
    const text = xml.replace(/<[^>]+>/g, '').trim()
    return text ? `<mtext>${escapeXml(text)}</mtext>` : ''
  }
}
