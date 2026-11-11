import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const PURIFY = {
  ADD_ATTR: ['target'],
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
