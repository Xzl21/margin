import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Anchor, Doc } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  doc: Doc
  anchors: Anchor[]
  onVisibleBlock: (idx: number) => void
}

export function PdfArticle({ doc, anchors, onVisibleBlock }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  if (error) return <div className="pdf-error">PDF 打不开：{error}</div>
  if (!pdf) return <div className="pdf-loading"><span className="spinner" /> 正在排版 PDF…</div>

  return (
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
