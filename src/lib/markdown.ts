import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const PURIFY = {
  // MathML 用来放 Word 公式（OMML 已转成 MathML），别的样式标签一律不放行
  USE_PROFILES: { html: true, mathMl: true },
  ADD_ATTR: ['target', 'display', 'columnalign', 'rowspacing', 'columnspacing', 'displaystyle'],
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
}

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(md.render(src ?? ''), PURIFY)
}

export function sanitizeHtml(src: string): string {
  return DOMPurify.sanitize(src, PURIFY)
}

export function escapeHtml(src: string): string {
  return src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
