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
import { captureHtmlSelection, capturePdfSelection } from '../lib/anchor'
import { runAsk, runCritique, runExplain, runMap, runVerify } from '../ai/run'

export function Reader() {
  const doc = useApp((s) => s.doc)
  const blocks = useApp((s) => s.blocks)
  const anchors = useApp((s) => s.anchors)
  const notes = useApp((s) => s.notes)
  const stucks = useApp((s) => s.stucks)
  const settings = useApp((s) => s.settings)
  const closeDoc = useApp((s) => s.closeDoc)
  const ensureAnchor = useApp((s) => s.ensureAnchor)
  const ensureMark = useApp((s) => s.ensureMark)
  const removeMark = useApp((s) => s.removeMark)
  const patchSettings = useApp((s) => s.patchSettings)
  const addNote = useApp((s) => s.addNote)
  const removeNote = useApp((s) => s.removeNote)
  const saveCritique = useApp((s) => s.saveCritique)
  const addStuck = useApp((s) => s.addStuck)
  const setStuckResolved = useApp((s) => s.setStuckResolved)
  const removeStuck = useApp((s) => s.removeStuck)
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
    opts: { thinking?: string; model?: string } = {},
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
    )
  }

  const handleMark = async (cap: Captured) => {
    setCaptured(null)
    dockCapRef.current = null
    window.getSelection()?.removeAllRanges()
    await ensureMark(cap)
  }

  const handleAsk = async (cap: Captured, question: string) => {
    clearSelection()
    dockCapRef.current = cap
    await runDock(
      '提问',
      question.slice(0, 60),
      undefined,
      null,
      (onDelta, signal) => runAsk({ doc, blocks, settings, captured: cap, question }, onDelta, signal),
      { thinking: '正在结合已读上下文想…', model: settings.routing.ask.model },
    )
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
      { thinking: '正在联网检索并核对出处…', model: settings.routing.ask.model },
    )
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

  const handleQuickStuck = async (cap: Captured) => {
    clearSelection()
    const anchor = await ensureAnchor(cap)
    await addStuck(anchor.id, '')
    setTab('stuck')
    setPanelOpen(true)
  }

  const handleComposerSubmit = async (text: string, kind: NoteKind) => {
    if (!composer) return
    const cap = composer.captured
    closeComposer()
    setCaptured(null)
    const anchor = await ensureAnchor(cap)
    if (composer.mode === 'note') {
      await addNote(anchor.id, text, kind)
      setTab('notes')
      setPanelOpen(true)
    } else if (composer.mode === 'ask') {
      await handleAsk(cap, text)
    } else {
      await addStuck(anchor.id, text)
      setTab('stuck')
      setPanelOpen(true)
    }
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
    jumpBlock(anchor.blockIdx)
    window.setTimeout(() => {
      const el = document.querySelector(`[data-anchor="${anchor.id}"]`)
      el?.classList.add('flash')
      window.setTimeout(() => el?.classList.remove('flash'), 1500)
    }, 350)
  }

  const saveDockAsNote = async () => {
    if (!dock?.text) return
    const anchor = dockAnchorRef.current
      ?? (dockCapRef.current ? await ensureAnchor(dockCapRef.current) : null)
    if (!anchor) return
    await addNote(anchor.id, dock.text, 'summary')
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

      <div className={`reader-body ${panelOpen ? '' : 'no-panel'}`}>
        <div className="reader-scroll" ref={articleRef} style={{ '--reader-zoom': settings.zoom } as CSSProperties}>
          {doc.kind === 'pdf' ? (
            <PdfArticle doc={doc} anchors={anchors} onVisibleBlock={onPdfPageVisible} />
          ) : (
            <HtmlArticle
              doc={doc}
              blocks={blocks}
              anchors={anchors}
              notes={notes}
              stucks={stucks}
              settings={settings}
              busyNoteId={busyNoteId}
              onCritique={handleCritique}
              onDeleteNote={(n) => void removeNote(n.id)}
              onJump={jumpAnchor}
            />
          )}
        </div>

        {panelOpen && (
          <SidePanel
            doc={doc}
            blocks={blocks}
            anchors={anchors}
            notes={notes}
            stucks={stucks}
            settings={settings}
            tab={tab}
            onTab={setTab}
            onJumpBlock={jumpBlock}
            onJumpAnchor={jumpAnchor}
            onGenerateMap={handleGenerateMap}
            onCritique={handleCritique}
            onDeleteNote={(n) => void removeNote(n.id)}
            onToggleStuck={(s) => void setStuckResolved(s.id, !s.resolved)}
            onDeleteStuck={(s) => {
              if (window.confirm('删除这个卡点？原文和批注不会受影响。')) void removeStuck(s.id)
            }}
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
          onMark={() => void handleMark(captured)}
          onAsk={(screen) => openComposer({ mode: 'ask', captured, screen })}
          onVerify={() => void handleVerify(captured)}
          onNote={(screen) => openComposer({ mode: 'note', captured, screen })}
          onStuck={() => void handleQuickStuck(captured)}
          onClose={() => {
            setCaptured(null)
            window.getSelection()?.removeAllRanges()
          }}
        />
      )}

      {composer && (
        <Composer
          mode={composer.mode}
          screen={composer.screen}
          onClose={closeComposer}
          onSubmit={(text, kind) => void handleComposerSubmit(text, kind)}
        />
      )}

      {dock && (
        <ActionDock
          dock={dock}
          onStop={() => abortRef.current?.abort()}
          onClose={closeDock}
          onSaveNote={() => void saveDockAsNote()}
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
