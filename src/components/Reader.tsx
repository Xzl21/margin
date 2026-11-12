import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useApp } from '../store'
import { useUi } from '../ui'
import type { Anchor, Captured, Note, NoteKind } from '../types'
import { HtmlArticle } from './Article'
import { PdfArticle } from './PdfArticle'
import { SidePanel } from './SidePanel'
import { SelectionToolbar } from './SelectionToolbar'
import { Composer } from './Composer'
import { ActionDock } from './ActionDock'
import { HitMenu, type HitAdd } from './HitMenu'
import { captureHtmlSelection, capturePdfSelection, rangeForAnchor } from '../lib/anchor'
import { runConcept, runCritique, runExplain, runMap, runVerify } from '../ai/run'

export function Reader() {
  const doc = useApp((s) => s.doc)
  const blocks = useApp((s) => s.blocks)
  const anchors = useApp((s) => s.anchors)
  const notes = useApp((s) => s.notes)
  const settings = useApp((s) => s.settings)
  const closeDoc = useApp((s) => s.closeDoc)
  const ensureAnchor = useApp((s) => s.ensureAnchor)
  const ensureMark = useApp((s) => s.ensureMark)
  const ensureVerify = useApp((s) => s.ensureVerify)
  const removeMark = useApp((s) => s.removeMark)
  const patchSettings = useApp((s) => s.patchSettings)
  const addNote = useApp((s) => s.addNote)
  const updateNote = useApp((s) => s.updateNote)
  const removeNote = useApp((s) => s.removeNote)
  const saveCritique = useApp((s) => s.saveCritique)
  const removeCritique = useApp((s) => s.removeCritique)
  const setMap = useApp((s) => s.setMap)
  const advanceFrontier = useApp((s) => s.advanceFrontier)
  const setError = useApp((s) => s.setError)

  const captured = useUi((s) => s.captured)
  const setCaptured = useUi((s) => s.setCaptured)
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)
  const composer = useUi((s) => s.composer)
  const openComposer = useUi((s) => s.openComposer)
  const closeComposer = useUi((s) => s.closeComposer)
  const dock = useUi((s) => s.dock)
  const openDock = useUi((s) => s.openDock)
  const patchDock = useUi((s) => s.patchDock)
  const appendDock = useUi((s) => s.appendDock)
  const closeDock = useUi((s) => s.closeDock)
  const openSettings = useUi((s) => s.openSettings)

  const articleRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const dockAnchorRef = useRef<Anchor | null>(null)
  const dockCapRef = useRef<Captured | null>(null)
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)
  const [mapping, setMapping] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [hit, setHit] = useState<{ anchor: Anchor; x: number; y: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  /** 拖动分隔条调整右侧栏宽度：拖动过程只改 CSS 变量，松手才写库 */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const body = bodyRef.current
    if (!body) return
    const startX = e.clientX
    const startW = settings.sideWidth || 340
    const min = 220
    const max = Math.max(300, Math.min(760, window.innerWidth - 380))
    let next = startW
    const move = (ev: PointerEvent) => {
      next = Math.round(Math.max(min, Math.min(max, startW - (ev.clientX - startX))))
      body.style.setProperty('--side-w', `${next}px`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('panel-resizing')
      if (next !== startW) void patchSettings({ sideWidth: next })
    }
    document.body.classList.add('panel-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ------- 选区捕获 ------- */
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.no-capture')) return
      window.setTimeout(() => {
        const root = articleRef.current
        if (!root || !doc) return
        const cap = doc.kind === 'pdf' ? capturePdfSelection(root, blocks) : captureHtmlSelection(root)
        setCaptured(cap)
      }, 10)
    }
    const onSel = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) setCaptured(null)
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('selectionchange', onSel)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('selectionchange', onSel)
    }
  }, [doc, blocks, setCaptured])

  /* ------- 阅读前沿（不剧透的数据基础） ------- */
  useEffect(() => {
    const root = articleRef.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const idx = Number((entry.target as HTMLElement).dataset.idx ?? '-1')
          if (idx >= 0) advanceFrontier(idx)
        }
      },
      { rootMargin: '0px 0px -50% 0px', threshold: 0.2 },
    )
    root.querySelectorAll('[data-idx]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [blocks, doc?.id, advanceFrontier])

  /* ------- 文档切换时清空浮层 ------- */
  useEffect(() => {
    setCaptured(null)
    closeDock()
    return () => {
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id])

  if (!doc) return null

  const progress = doc.blockCount ? Math.round(((doc.frontierIdx + 1) / doc.blockCount) * 100) : 0

  const runDock = async (
    title: string,
    subtitle: string | undefined,
    noteId: string | undefined,
    anchor: Anchor | null,
    run: (onDelta: (t: string) => void, signal: AbortSignal) => Promise<string>,
    opts: { thinking?: string; model?: string; allowVerdict?: boolean; noteKind?: string; allowSave?: boolean } = {},
  ): Promise<string> => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    dockAnchorRef.current = anchor
    openDock({
      title,
      subtitle,
      text: '',
      running: true,
      model: opts.model ?? settings.routing.explain.model,
      noteId,
      thinking: opts.thinking,
      allowVerdict: opts.allowVerdict,
      noteKind: opts.noteKind,
      allowSave: opts.allowSave,
    })
    let acc = ''
    try {
      const text = await run((delta) => {
        acc += delta
        appendDock(delta)
      }, ctrl.signal)
      patchDock({ running: false, text: text || acc })
      return text || acc
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        patchDock({ running: false })
        return acc
      }
      patchDock({ running: false, error: (err as Error).message || '调用失败了' })
      return ''
    }
  }

  /* ------- 点中已经划出来的句子：就地删除 / 追加功能 ------- */
  useEffect(() => {
    const root = articleRef.current
    if (!root || !doc) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.no-capture')) return
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return
      let found: Anchor | undefined
      const pdfHl = target?.closest<HTMLElement>('.pdf-hl')
      if (pdfHl?.dataset.anchor) {
        found = anchors.find((a) => a.id === pdfHl.dataset.anchor)
      } else {
        const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY)
        const node = pos?.startContainer ?? null
        const el = node
          ? ((node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null)
              ?.closest<HTMLElement>('.blk')
          : null
        if (el) {
          const blockId = el.dataset.blockId
          for (const a of anchors) {
            if (a.blockId !== blockId) continue
            const range = rangeForAnchor(el, a)
            if (!range) continue
            const onIt = Array.from(range.getClientRects()).some(
              (r) =>
                r.width > 0 &&
                e.clientX >= r.left - 2 &&
                e.clientX <= r.right + 2 &&
                e.clientY >= r.top - 2 &&
                e.clientY <= r.bottom + 2,
            )
            if (onIt) {
              found = a
              break
            }
          }
        }
      }
      if (!found) {
        setHit(null)
        return
      }
      e.preventDefault()
      setHit({ anchor: found, x: e.clientX, y: e.clientY })
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [anchors, doc])

  /** 划词动作一开始就清掉浏览器选区：不落成批注就不该留下任何划线。 */
  const clearSelection = () => {
    setCaptured(null)
    dockCapRef.current = null
    window.getSelection()?.removeAllRanges()
  }

  const handleExplain = async (cap: Captured, question?: string) => {
    clearSelection()
    dockCapRef.current = cap
    await runDock(
      '解释',
      cap.quote.slice(0, 60),
      undefined,
      null,
      (onDelta, signal) => runExplain({ doc, blocks, settings, captured: cap, question }, onDelta, signal),
      { noteKind: 'explain', model: settings.routing.explain.model },
    )
  }

  /** 概念：只讲清「它是什么」，比解释更短。 */
  const handleConcept = async (cap: Captured) => {
    clearSelection()
    dockCapRef.current = cap
    await runDock(
      '概念',
      cap.quote.slice(0, 60),
      undefined,
      null,
      (onDelta, signal) => runConcept({ doc, blocks, settings, captured: cap }, onDelta, signal),
      {
        noteKind: 'concept',
        model: settings.routing.explain.model,
        thinking: '正在把这句话里的概念说清楚…',
      },
    )
  }

  const openComposerFor = (cap: Captured, screen: { x: number; y: number }) => {
    // 打开输入框就收掉浏览器自己的蓝色选区：不落成内容，就不该在原文上留痕。
    window.getSelection()?.removeAllRanges()
    setCaptured(null)
    dockCapRef.current = null
    openComposer({ captured: cap, screen })
  }

  const handleMark = async (cap: Captured) => {
    setCaptured(null)
    dockCapRef.current = null
    window.getSelection()?.removeAllRanges()
    await ensureMark(cap)
  }

  const handleVerify = async (cap: Captured) => {
    clearSelection()
    dockCapRef.current = cap
    await runDock(
      '查证',
      cap.quote.slice(0, 60),
      undefined,
      null,
      (onDelta, signal) => runVerify({ doc, blocks, settings, captured: cap }, onDelta, signal),
      { thinking: '正在联网检索并核对出处…', model: settings.routing.verify.model, allowVerdict: true, allowSave: false },
    )
  }

  /** 查证结论落成原文标记：证实=绿✓，未证实=灰?。 */
  const handleVerdict = async (verdict: 'ok' | 'unknown') => {
    const cap = dockCapRef.current
    if (!cap) return
    await ensureVerify(cap, verdict, dock?.text)
    patchDock({ verdict })
    window.setTimeout(() => closeDock(), 600)
  }

  const handleCritique = async (note: Note) => {
    const anchor = anchors.find((a) => a.id === note.anchorId)
    if (!anchor) {
      setError('这条批注的原位锚点丢了，没法回看上下文。')
      return
    }
    const cap: Captured = {
      blockId: anchor.blockId,
      blockIdx: anchor.blockIdx,
      quote: anchor.quote.exact,
      prefix: anchor.quote.prefix,
      suffix: anchor.quote.suffix,
      page: anchor.page,
      rects: anchor.rects,
    }
    setBusyNoteId(note.id)
    dockCapRef.current = null
    const text = await runDock(
      settings.stance === 'socratic' ? '追问这条批注' : '校对这条批注',
      note.body.slice(0, 50),
      note.id,
      anchor,
      (onDelta, signal) =>
        runCritique({ doc, blocks, settings, note, captured: cap, previous: notes }, onDelta, signal),
    )
    setBusyNoteId(null)
    if (text) await saveCritique(note.id, text, settings.stance, settings.routing.critique.model)
  }

  const capFromAnchor = (anchor: Anchor): Captured => ({
    blockId: anchor.blockId,
    blockIdx: anchor.blockIdx,
    quote: anchor.quote.exact,
    prefix: anchor.quote.prefix,
    suffix: anchor.quote.suffix,
    page: anchor.page,
    rects: anchor.rects,
  })

  /** 在正文里点中已有的划线，追加一个功能。 */
  const handleHitAdd = (kind: HitAdd) => {
    const anchor = hit?.anchor
    if (!anchor) return
    const cap = capFromAnchor(anchor)
    const at = { x: hit?.x ?? 0, y: hit?.y ?? 0 }
    setHit(null)
    if (kind === 'explain') void handleExplain(cap)
    else if (kind === 'concept') void handleConcept(cap)
    else if (kind === 'mark') void handleMark(cap)
    else if (kind === 'note') openComposerFor(cap, at)
    else if (kind === 'verify') void handleVerify(cap)
  }

  const handleComposerSubmit = async (text: string, kind: NoteKind) => {
    if (!composer) return
    const cap = composer.captured
    closeComposer()
    setCaptured(null)
    window.getSelection()?.removeAllRanges()
    const anchor = await ensureAnchor(cap)
    await addNote(anchor.id, text, kind)
    setTab('notes')
    setPanelOpen(true)
  }

  const handleGenerateMap = async () => {
    setMapping(true)
    try {
      const map = await runMap({ doc, blocks, settings })
      await setMap(map)
      setTab('route')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMapping(false)
    }
  }

  const jumpBlock = (idx: number) => {
    const block = blocks.find((b) => b.idx === idx) ?? blocks[idx]
    if (!block) return
    if (doc.kind === 'pdf' && block.page) {
      document
        .querySelector(`[data-pdf-page="${block.page}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    document
      .querySelector(`[data-block-id="${block.id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const jumpAnchor = (anchor: Anchor) => {
    const root = articleRef.current
    if (!root) return
    if (doc.kind === 'pdf') {
      jumpBlock(anchor.blockIdx)
      return
    }
    const blockEl = root.querySelector<HTMLElement>(
      `[data-block-id="${anchor.blockId.replace(/["\\]/g, '\\$&')}"]`,
    )
    const range = blockEl ? rangeForAnchor(blockEl, anchor) : null
    const rect = range?.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      jumpBlock(anchor.blockIdx)
      return
    }
    // 准确滚到那句话，而不是滚到整段开头。
    root.scrollTop += rect.top - root.getBoundingClientRect().top - root.clientHeight * 0.3
    flashRect(root, rect)
  }

  /** 在命中的原文位置闪一下，告诉用户「就是这句」。 */
  const flashRect = (root: HTMLElement, rect: DOMRect) => {
    const zoom = settings.zoom || 1
    const base = root.getBoundingClientRect()
    const spot = document.createElement('div')
    spot.className = 'anchor-flash'
    spot.style.left = `${(rect.left - base.left) / zoom - 3}px`
    spot.style.top = `${(rect.top - base.top) / zoom - 3}px`
    spot.style.width = `${rect.width / zoom + 6}px`
    spot.style.height = `${rect.height / zoom + 6}px`
    root.appendChild(spot)
    window.setTimeout(() => spot.remove(), 1600)
  }

  const saveDockAsNote = async () => {
    if (!dock?.text) return
    const anchor = dockAnchorRef.current
      ?? (dockCapRef.current ? await ensureAnchor(dockCapRef.current) : null)
    if (!anchor) return
    // 解释 → 「解释」类别；概念 → 「概念」类别；其余按设置里的默认类别
    const fallback = settings.noteCategories.find((c) => c.id === 'think')?.id
      ?? settings.noteCategories[0]?.id ?? 'custom'
    await addNote(anchor.id, dock.text, dock.noteKind ?? fallback)
    setTab('notes')
    setPanelOpen(true)
    closeDock()
  }

  const onPdfPageVisible = useCallback(
    (page: number) => {
      const pageBlocks = blocks.filter((b) => b.page === page)
      const last = pageBlocks[pageBlocks.length - 1]
      if (last) advanceFrontier(last.idx)
    },
    [blocks, advanceFrontier],
  )

  return (
    <div className="reader">
      <header className="reader-head">
        <button type="button" className="ghost back" onClick={closeDoc}>
          ← 书架
        </button>
        <div className="reader-title">
          <h1 title={doc.title}>{doc.title}</h1>
          <span>
            {doc.kind.toUpperCase()} · 已读 {progress}% · {doc.blockCount} 段
          </span>
        </div>
        <div className="reader-tools">
          <button
            type="button"
            className={panelOpen ? 'ghost active' : 'ghost'}
            onClick={() => setPanelOpen((v) => !v)}
            title="显示或收起右侧栏"
          >
            侧栏
          </button>
          <button
            type="button"
            className="ghost icon-only"
            title="放大文档页面"
            disabled={settings.zoom >= 1.8}
            onClick={() => void patchSettings({ zoom: Math.round((settings.zoom + 0.1) * 10) / 10 })}
          >
            <ZoomIcon />
          </button>
          <button
            type="button"
            className="ghost icon-only"
            title="缩小文档页面"
            disabled={settings.zoom <= 0.7}
            onClick={() => void patchSettings({ zoom: Math.round((settings.zoom - 0.1) * 10) / 10 })}
          >
            <ZoomIcon minus />
          </button>
          <button type="button" className="ghost" onClick={openSettings}>
            设置
          </button>
        </div>
        <div className="head-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div
        ref={bodyRef}
        className={`reader-body ${panelOpen ? '' : 'no-panel'}`}
        style={{ '--side-w': `${settings.sideWidth || 340}px` } as CSSProperties}
      >
        <div className="reader-scroll" ref={articleRef} style={{ '--reader-zoom': settings.zoom } as CSSProperties}>
          {doc.kind === 'pdf' ? (
            <PdfArticle doc={doc} anchors={anchors} onVisibleBlock={onPdfPageVisible} />
          ) : (
            <HtmlArticle
              doc={doc}
              blocks={blocks}
              anchors={anchors}
              notes={notes}
              settings={settings}
              busyNoteId={busyNoteId}
              onCritique={handleCritique}
              onDeleteNote={(n) => void removeNote(n.id)}
              onUpdateNote={(n, body, kind) => void updateNote(n.id, body, kind)}
              onRemoveCritique={(n) => void removeCritique(n.id)}
              onJump={jumpAnchor}
            />
          )}
        </div>

        {panelOpen && (
          <div
            className="panel-resizer no-capture"
            role="separator"
            aria-orientation="vertical"
            title="拖动调整侧栏宽度"
            onPointerDown={startResize}
          />
        )}

        {panelOpen && (
          <SidePanel
            doc={doc}
            blocks={blocks}
            anchors={anchors}
            notes={notes}
            settings={settings}
            tab={tab}
            onTab={setTab}
            onJumpBlock={jumpBlock}
            onJumpAnchor={jumpAnchor}
            onGenerateMap={handleGenerateMap}
            onCritique={handleCritique}
            onDeleteNote={(n) => void removeNote(n.id)}
            onUpdateNote={(n, body, kind) => void updateNote(n.id, body, kind)}
            onRemoveCritique={(n) => void removeCritique(n.id)}
            onDeleteMark={(a) => void removeMark(a.id)}
            onClose={() => setPanelOpen(false)}
            mapping={mapping}
            busyNoteId={busyNoteId}
          />
        )}
      </div>

      {captured && (
        <SelectionToolbar
          captured={captured}
          onExplain={() => void handleExplain(captured)}
          onConcept={() => void handleConcept(captured)}
          onMark={() => void handleMark(captured)}
          onVerify={() => void handleVerify(captured)}
          onNote={(screen) => openComposerFor(captured, screen)}
          onClose={() => {
            setCaptured(null)
            window.getSelection()?.removeAllRanges()
          }}
        />
      )}

      {hit && (
        <HitMenu
          anchor={hit.anchor}
          notes={notes.filter((n) => n.anchorId === hit.anchor.id)}
          x={hit.x}
          y={hit.y}
          onClose={() => setHit(null)}
          onDeleteNote={(n) => void removeNote(n.id)}
          onDeleteMark={(a) => void removeMark(a.id)}
          onAdd={handleHitAdd}
        />
      )}

      {composer && (
        <Composer
          screen={composer.screen}
          categories={settings.noteCategories}
          onClose={() => {
            closeComposer()
            window.getSelection()?.removeAllRanges()
          }}
          onSubmit={(text, kind) => void handleComposerSubmit(text, kind)}
        />
      )}

      {dock && (
        <ActionDock
          dock={dock}
          onStop={() => abortRef.current?.abort()}
          onClose={closeDock}
          onSaveNote={dock.allowSave === false ? undefined : () => void saveDockAsNote()}
          onVerdict={(v) => void handleVerdict(v)}
        />
      )}
    </div>
  )
}

function ZoomIcon({ minus = false }: { minus?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.2 15.2 20.6 20.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.6 10.5h5.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {!minus && <path d="M10.5 7.6v5.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  )
}
