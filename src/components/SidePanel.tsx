import { useMemo } from 'react'
import type { Anchor, Block, Doc, Note, Settings, Stuck } from '../types'
import type { PanelTab } from '../ui'
import { NoteCard } from './Notes'
import { topoOrder } from '../ai/prompts'

interface Props {
  doc: Doc
  blocks: Block[]
  anchors: Anchor[]
  notes: Note[]
  stucks: Stuck[]
  settings: Settings
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onJumpBlock: (idx: number) => void
  onJumpAnchor: (anchor: Anchor) => void
  onGenerateMap: () => void
  onCritique: (note: Note) => void
  onDeleteNote: (note: Note) => void
  onToggleStuck: (stuck: Stuck) => void
  onClose: () => void
  mapping: boolean
  busyNoteId: string | null
}

const KIND_LABEL: Record<string, string> = {
  claim: '论断',
  premise: '前提',
  definition: '定义',
  method: '方法',
  conclusion: '结论',
}

export function SidePanel({
  doc, blocks, anchors, notes, stucks, settings, tab, onTab, onJumpBlock, onJumpAnchor,
  onGenerateMap, onCritique, onDeleteNote, onToggleStuck, onClose, mapping, busyNoteId,
}: Props) {
  const openStucks = stucks.filter((s) => !s.resolved)
  const outline = doc.outline
  const ordered = useMemo(() => (doc.map ? topoOrder(doc.map) : []), [doc.map])
  const nodeById = useMemo(() => new Map((doc.map?.nodes ?? []).map((n) => [n.id, n])), [doc.map])

  return (
    <aside className="side-panel">
      <div className="side-tabs">
        {([
          ['outline', '大纲'],
          ['notes', `批注 ${notes.length}`],
          ['stuck', `卡点 ${openStucks.length}`],
          ['route', '路线'],
        ] as [PanelTab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'active' : ''}
            onClick={() => onTab(key)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="side-close" onClick={onClose} title="收起侧栏">
          »
        </button>
      </div>

      <div className="side-body">
        {tab === 'outline' && (
          <div className="outline">
            <div className="panel-note">
              这是文档自己的骨架。想看清「先懂什么再懂什么」，去「路线」生成依赖骨架。
            </div>
            {outline.length === 0 && (
              <p className="empty">这份文档没有识别到标题。可以先用「路线」让模型从正文推断结构。</p>
            )}
            <ul>
              {outline.map((node) => (
                <li key={node.id} style={{ paddingLeft: `${(node.level - 1) * 14}px` }}>
                  <button type="button" onClick={() => onJumpBlock(node.blockIdx)}>
                    <span className="dot" />
                    {node.title}
                  </button>
                </li>
              ))}
            </ul>
            <div className="outline-foot">
              <span>{blocks.length} 段 · {(doc.charCount / 1000).toFixed(1)}k 字</span>
              {doc.pageCount ? <span>{doc.pageCount} 页</span> : null}
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className="notes-list">
            {notes.length === 0 && (
              <p className="empty">
                还没有批注。选中一段文字，点「批注」，写下你自己的话——哪怕只是「这里我不信」。
              </p>
            )}
            {notes
              .slice()
              .sort((a, b) => (blockIdxOf(a, anchors) - blockIdxOf(b, anchors)))
              .map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  anchor={anchors.find((a) => a.id === note.anchorId)}
                  stance={settings.stance}
                  busy={busyNoteId === note.id}
                  onCritique={onCritique}
                  onDelete={onDeleteNote}
                  onJump={onJumpAnchor}
                />
              ))}
          </div>
        )}

        {tab === 'stuck' && (
          <div className="stuck-list">
            <div className="panel-note">
              卡点不是失败。它标记的是你此刻的理解边界；读到后文时，往往会自己亮起来。
            </div>
            {stucks.length === 0 && <p className="empty">还没有卡点。读不懂的地方，选中后点「没懂」。</p>}
            {stucks.map((stuck) => {
              const anchor = anchors.find((a) => a.id === stuck.anchorId)
              return (
                <div key={stuck.id} className={`stuck-item ${stuck.resolved ? 'resolved' : ''}`}>
                  <div className="stuck-quote">
                    {anchor ? `“${anchor.quote.exact.slice(0, 80)}${anchor.quote.exact.length > 80 ? '…' : ''}”` : '（原文锚点已丢失）'}
                  </div>
                  {stuck.question ? <p className="stuck-q">{stuck.question}</p> : <p className="stuck-q muted">（没写原因）</p>}
                  <div className="stuck-actions">
                    {anchor && (
                      <button type="button" className="mini" onClick={() => onJumpAnchor(anchor)}>
                        回到原文
                      </button>
                    )}
                    <button type="button" className="mini accent" onClick={() => onToggleStuck(stuck)}>
                      {stuck.resolved ? '标为未解决' : '标记已解决'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'route' && (
          <div className="route">
            {!doc.map ? (
              <div className="route-empty">
                <h3>依赖骨架</h3>
                <p>
                  把文档里的关键节点抽出来，并标出「读懂 B 之前先懂 A」的关系。它回答的不是「讲了什么」，
                  而是「先读哪一段」。
                </p>
                <button type="button" className="primary" disabled={mapping} onClick={onGenerateMap}>
                  {mapping ? '正在生成…' : '生成依赖骨架'}
                </button>
                <small>会用掉一次模型调用；结果保存在本地，可重复使用。</small>
              </div>
            ) : (
              <>
                <div className="route-head">
                  <span>{doc.map.nodes.length} 个节点 · {doc.map.edges.length} 条依赖</span>
                  <button type="button" className="mini" disabled={mapping} onClick={onGenerateMap}>
                    {mapping ? '重算中…' : '重算'}
                  </button>
                </div>
                <ol className="route-list">
                  {ordered.map((node, i) => {
                    const prereqs = (doc.map?.edges ?? []).filter((e) => e.to === node.id)
                    return (
                      <li key={node.id}>
                        <button type="button" onClick={() => node.blockIdx !== undefined && onJumpBlock(node.blockIdx)}>
                          <span className="route-index">{String(i + 1).padStart(2, '0')}</span>
                          <span className={`route-kind kind-${node.kind}`}>{KIND_LABEL[node.kind] ?? node.kind}</span>
                          <span className="route-title">{node.title}</span>
                        </button>
                        {node.note && <p className="route-note">{node.note}</p>}
                        {prereqs.length > 0 && (
                          <p className="route-deps">
                            先懂：
                            {prereqs
                              .map((e) => nodeById.get(e.from)?.title ?? e.from)
                              .join(' / ')}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function blockIdxOf(note: Note, anchors: Anchor[]): number {
  return anchors.find((a) => a.id === note.anchorId)?.blockIdx ?? 0
}
