import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Anchor, Doc, Note, Settings } from '../types'
import { MarginRail } from './MarginRail'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  doc: Doc
  anchors: Anchor[]
  notes: Note[]
  settings: Settings
  showRail: boolean
  busyNoteId: string | null
  onVisibleBlock: (idx: number) => void
  onCritique: (note: Note) => void
  onDeleteNote: (note: Note) => void
  onUpdateNote: (note: Note, body: string, kind: string) => void
  onRemoveCritique: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

export function PdfArticle({
  doc, anchors, notes, settings, showRail, busyNoteId, onVisibleBlock, onCritique, onDeleteNote,
  onUpdateNote, onRemoveCritique, onJump,
}: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [, setLayoutTick] = useState(0)

  useEffect(() => {
    if (!doc.blob) return
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    void (async () => {
      try {
        const data = new Uint8Array(await doc.blob!.arrayBuffer())
        const task = pdfjsLib.getDocument({ data, isEvalSupported: false })
        loaded = await task.promise
        if (cancelled) {
          void loaded.destroy()
          return
        }
        setPdf(loaded)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      void loaded?.destroy()
      setPdf(null)
    }
  }, [doc.id, doc.blob])

  // 页面渲染完成后高度会变（canvas 尺寸落定），让批注栏重新对位。
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let timer = 0
    const bump = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setLayoutTick((n) => n + 1), 120)
    }
    const ro = new ResizeObserver(bump)
    ro.observe(root)
    return () => {
      window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [pdf])

  /** 批注要贴的位置：该页上这条高亮第一个矩形的视口坐标 */
  const locate = (anchor: Anchor): DOMRect | null => {
    const root = rootRef.current
    const pageEl = root?.querySelector<HTMLElement>(`[data-pdf-page="${anchor.page}"]`)
    const rect = anchor.rects?.[0]
    if (!pageEl || !rect) return null
    const page = pageEl.getBoundingClientRect()
    return new DOMRect(page.left + rect.x * page.width, page.top + rect.y * page.height, 1, Math.max(2, rect.h * page.height))
  }

  if (error) return <div className="pdf-error">PDF 打不开：{error}</div>
  if (!pdf) return <div className="pdf-loading"><span className="spinner" /> 正在排版 PDF…</div>

  return (
    <div className={`pdf-wrap ${showRail ? '' : 'no-rail'}`} ref={rootRef}>
      <div className="pdf-doc">
        {Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage
            key={i + 1}
            pdf={pdf}
            num={i + 1}
            anchors={anchors}
            onVisibleBlock={onVisibleBlock}
          />
        ))}
      </div>
      {showRail && (
        <MarginRail
          anchors={anchors}
          notes={notes}
          settings={settings}
          busyNoteId={busyNoteId}
          onCritique={onCritique}
          onDelete={onDeleteNote}
          onUpdate={onUpdateNote}
          onRemoveCritique={onRemoveCritique}
          onJump={onJump}
          getRect={locate}
          revision={`${pdf.numPages}:${settings.zoom}`}
          emptyHint="PDF 里选中的句子写的批注，会出现在这一栏，和页面上那句话对齐。"
        />
      )}
    </div>
  )
}

function PdfPage({
  pdf, num, anchors, onVisibleBlock,
}: {
  pdf: PDFDocumentProxy
  num: number
  anchors: Anchor[]
  onVisibleBlock: (idx: number) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const [rendered, setRendered] = useState(false)
  const pageHits = anchors.filter((a) => a.page === num)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            if (entry.intersectionRatio > 0.25) onVisibleBlock(num)
          }
        }
      },
      { rootMargin: '900px 0px' },
    )
    io.observe(el)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => {
      io.disconnect()
      ro.disconnect()
    }
  }, [num, onVisibleBlock])

  useEffect(() => {
    if (!visible || !width) return
    let cancelled = false
    void (async () => {
      const page = await pdf.getPage(num)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const scale = width / base.width
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const vp = page.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current
      const layer = layerRef.current
      if (!canvas || !layer) return
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const cssW = Math.floor(width)
      const cssH = Math.floor(vp.height / dpr)
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      if (cancelled) return

      const content = await page.getTextContent()
      const cssVp = page.getViewport({ scale })
      layer.style.width = `${cssW}px`
      layer.style.height = `${cssH}px`
      layer.textContent = ''
      const frag = document.createDocumentFragment()
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const tx = pdfjsLib.Util.transform(cssVp.transform, item.transform)
        const fontHeight = Math.hypot(tx[2], tx[3]) || item.height * scale
        if (fontHeight < 1) continue
        const span = document.createElement('span')
        span.textContent = item.str + (item.hasEOL ? ' ' : '')
        span.style.left = `${tx[4]}px`
        span.style.top = `${tx[5] - fontHeight}px`
        span.style.fontSize = `${fontHeight}px`
        span.style.fontFamily = 'sans-serif'
        frag.appendChild(span)
      }
      layer.appendChild(frag)
      setRendered(true)
    })()
    return () => {
      cancelled = true
    }
  }, [visible, width, pdf, num])

  return (
    <div className="pdf-page" ref={wrapRef} data-pdf-page={num}>
      <canvas ref={canvasRef} className="pdf-canvas" />
      {!rendered && <div className="pdf-placeholder">第 {num} 页</div>}
      <div className="pdf-text-layer" ref={layerRef} />
      <div className="pdf-hl-layer">
        {pageHits.map((anchor) =>
          (anchor.rects ?? []).map((r, i) => (
            <div
              key={`${anchor.id}-${i}`}
              className={`pdf-hl ${anchor.kind === 'verify' ? (anchor.verdict === 'unknown' ? 'verify-unknown' : 'verify-ok') : anchor.kind === 'mark' ? 'mark' : ''}`}
              data-anchor={anchor.id}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
              }}
            />
          )),
        )}
      </div>
      {pageHits.map((anchor) => {
        if (anchor.kind !== 'verify') return null
        const rects = anchor.rects ?? []
        const last = rects[rects.length - 1]
        if (!last) return null
        return (
          <span
            key={`v-${anchor.id}`}
            className={`verify-badge pdf ${anchor.verdict === 'unknown' ? 'unknown' : 'ok'}`}
            style={{ left: `${(last.x + last.w) * 100}%`, top: `${last.y * 100}%` }}
          >
            {anchor.verdict === 'unknown' ? '?' : '✓'}
          </span>
        )
      })}
    </div>
  )
}
