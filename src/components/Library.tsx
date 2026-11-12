import { useRef, useState } from 'react'
import { useApp } from '../store'
import { useUi } from '../ui'
import { SAMPLE_MD } from '../samples/demo'
import { formatBytes, formatDate } from '../lib/util'
import type { Doc, Folder } from '../types'

const KIND_LABEL: Record<Doc['kind'], string> = {
  pdf: 'PDF',
  docx: 'Word',
  md: 'Markdown',
  txt: '纯文本',
}

/** 当前书架筛选：全部 / 未分类 / 某个文件夹 id */
type ShelfFilter = 'all' | 'none' | string

function DocCard({
  doc,
  folders,
  onOpen,
  onDelete,
  onMove,
}: {
  doc: Doc
  folders: Folder[]
  onOpen: () => void
  onDelete: () => void
  onMove: (folderId: string | null) => void
}) {
  const progress = doc.blockCount ? Math.min(100, ((doc.frontierIdx + 1) / doc.blockCount) * 100) : 0
  return (
    <article className="doc-card" onClick={onOpen}>
      <div className="doc-card-top">
        <span className={`kind-badge kind-${doc.kind}`}>{KIND_LABEL[doc.kind]}</span>
        <button
          type="button"
          className="icon-btn doc-del"
          title="删除这份文档及其批注"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          ✕
        </button>
      </div>
      <h3>{doc.title}</h3>
      <p className="doc-meta">
        {doc.blockCount} 段 · {doc.charCount.toLocaleString('zh-CN')} 字
        {doc.pageCount ? ` · ${doc.pageCount} 页` : ''} · {formatBytes(doc.size)}
      </p>
      <div className="doc-progress" aria-label={`阅读进度 ${Math.round(progress)}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <footer>
        <span>{formatDate(doc.lastReadAt)}</span>
        <span>{Math.round(progress)}%</span>
      </footer>
      <select
        className="doc-folder"
        title="归到哪个文件夹"
        value={doc.folderId ?? ''}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation()
          onMove(e.target.value || null)
        }}
      >
        <option value="">未分类</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </article>
  )
}

/** 书架 banner 右侧的插画：一页纸 + 页边三条不同功能的批注 */
function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 268 196" role="img" aria-label="页边批注示意">
      <defs>
        <linearGradient id="hero-page" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="var(--paper-soft)" />
          <stop offset="1" stopColor="var(--paper)" />
        </linearGradient>
      </defs>
      <g className="art-sheet">
        <rect x="18" y="12" width="158" height="172" rx="9" fill="url(#hero-page)" />
        <rect x="18" y="12" width="158" height="172" rx="9" className="art-edge" />
        <line x1="52" y1="16" x2="52" y2="180" className="art-rule" />
        {[
          [64, 40, 84], [64, 56, 96], [64, 72, 70], [64, 100, 92],
          [64, 116, 78], [64, 144, 88], [64, 160, 60],
        ].map(([x, y, w], i) => (
          <rect key={i} x={x} y={y} width={w} height="4" rx="2" className="art-text" />
        ))}
        <rect x="64" y="88" width="52" height="6" rx="3" className="art-mark" />
      </g>
      <g className="art-note art-note-a">
        <rect x="150" y="52" width="100" height="34" rx="7" />
        <rect x="160" y="62" width="62" height="3.5" rx="1.75" className="art-note-line" />
        <rect x="160" y="71" width="44" height="3.5" rx="1.75" className="art-note-line" />
      </g>
      <g className="art-note art-note-b">
        <rect x="158" y="98" width="92" height="30" rx="7" />
        <rect x="168" y="108" width="52" height="3.5" rx="1.75" className="art-note-line" />
        <rect x="168" y="117" width="36" height="3.5" rx="1.75" className="art-note-line" />
      </g>
      <g className="art-note art-note-c">
        <rect x="150" y="140" width="84" height="26" rx="7" />
        <circle cx="164" cy="153" r="6.5" className="art-check" />
        <path d="M161 153l2.2 2.4 4-4.6" className="art-check-mark" />
        <rect x="176" y="150" width="42" height="3.5" rx="1.75" className="art-note-line" />
      </g>
      <circle cx="22" cy="26" r="9" className="art-tab" />
      <path d="M22 21.5v9M17.5 26h9" className="art-tab-mark" />
    </svg>
  )
}

export function Library() {
  const docs = useApp((s) => s.docs)
  const folders = useApp((s) => s.folders)
  const importFiles = useApp((s) => s.importFiles)
  const openDoc = useApp((s) => s.openDoc)
  const deleteDoc = useApp((s) => s.deleteDoc)
  const createFolder = useApp((s) => s.createFolder)
  const renameFolder = useApp((s) => s.renameFolder)
  const deleteFolder = useApp((s) => s.deleteFolder)
  const moveDoc = useApp((s) => s.moveDoc)
  const openSettings = useUi((s) => s.openSettings)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState<ShelfFilter>('all')
  /** id 为 null 表示正在新建 */
  const [editing, setEditing] = useState<{ id: string | null; value: string } | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)

  const activeFolder = folders.find((f) => f.id === filter) ?? null
  const effectiveFilter: ShelfFilter = filter === 'all' || filter === 'none' || activeFolder ? filter : 'all'
  const inFolder = (doc: Doc, id: string) => (doc.folderId ?? null) === id
  const visible =
    effectiveFilter === 'all'
      ? docs
      : effectiveFilter === 'none'
        ? docs.filter((d) => !d.folderId)
        : docs.filter((d) => d.folderId === effectiveFilter)

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    const target = effectiveFilter !== 'all' && effectiveFilter !== 'none' ? effectiveFilter : null
    void importFiles(Array.from(files), target)
  }

  const submitFolder = async () => {
    if (!editing) return
    const name = editing.value.trim()
    if (!name) {
      setEditing(null)
      return
    }
    try {
      if (editing.id) {
        await renameFolder(editing.id, name)
      } else {
        const folder = await createFolder(name)
        setFilter(folder.id)
      }
      setEditing(null)
      setFolderError(null)
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div
      className={`library ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      <header className="lib-head">
        <div className="brand">
          <span className="brand-mark">伴</span>
          <div>
            <h1>
              伴读 <em>Margin</em>
            </h1>
            <p>读到哪、想到什么，都留在页边</p>
          </div>
        </div>
        <div className="lib-actions">
          <button type="button" className="ghost" onClick={openSettings}>
            模型与数据
          </button>
          <button type="button" className="primary" onClick={() => inputRef.current?.click()}>
            导入文档
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.md,.markdown,.txt"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </header>

      <main className="lib-main">
        <section className="hero">
          <div className="hero-copy">
            <p className="hero-kicker">本地优先 · 不替你读</p>
            <h2>不替你读，帮你读懂。</h2>
            <p>
              伴读不会把文档压成一段摘要。它先给你脉络，再在你划词的地方解释这句话在论证里干什么、
              那个词到底是什么意思；你随手写在页边的想法，它会追问依据、指出跳步，但不会替你下结论。
            </p>
            <ul className="hero-points">
              <li><b>不剧透</b>：AI 只看到你已经读到的部分。</li>
              <li><b>不替代</b>：先问你、再补差，不自动总结。</li>
              <li><b>不锁定</b>：预置 DeepSeek，也能接任何 OpenAI 兼容服务；数据在本地，随时导出。</li>
            </ul>
            <div className="hero-feats">
              <span>解释</span>
              <span>概念</span>
              <span>批注</span>
              <span>划线</span>
              <span>查证</span>
              <em>侧栏另有大纲与阅读路线</em>
            </div>
          </div>
          <div className="hero-side">
            <HeroArt />
            <div className="hero-drop">
              <p>把 PDF / Word / Markdown / TXT 拖进来</p>
              <button type="button" className="primary big" onClick={() => inputRef.current?.click()}>
                选择文件
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  const file = new File([SAMPLE_MD], '从零读懂一个陌生领域.md', { type: 'text/markdown' })
                  void importFiles([file], null)
                }}
              >
                或者，先读一篇 3 分钟的示例
              </button>
            </div>
          </div>
        </section>

        <section className="shelf">
          <div className="shelf-head">
            <h2>书架</h2>
            <span>
              {effectiveFilter === 'all'
                ? docs.length
                  ? `${docs.length} 份文档`
                  : '还没有文档'
                : `${activeFolder?.name ?? '未分类'} · ${visible.length} 份`}
              {effectiveFilter !== 'all' ? (
                <button type="button" className="link back-all" onClick={() => setFilter('all')}>
                  看全部
                </button>
              ) : null}
            </span>
          </div>

          <div className="shelf-body">
            <aside className="folder-rail">
              <button
                type="button"
                className={`folder-item ${effectiveFilter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                <span className="folder-name">全部文档</span>
                <span className="folder-count">{docs.length}</span>
              </button>
              <button
                type="button"
                className={`folder-item ${effectiveFilter === 'none' ? 'active' : ''}`}
                onClick={() => setFilter('none')}
              >
                <span className="folder-name">未分类</span>
                <span className="folder-count">{docs.filter((d) => !d.folderId).length}</span>
              </button>

              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={`folder-item ${effectiveFilter === folder.id ? 'active' : ''}`}
                  onClick={() => setFilter(folder.id)}
                  onDoubleClick={() => setEditing({ id: folder.id, value: folder.name })}
                  title="双击重命名"
                >
                  <span className="folder-name">{folder.name}</span>
                  <span className="folder-count">{docs.filter((d) => inFolder(d, folder.id)).length}</span>
                </button>
              ))}

              {editing ? (
                <div className="folder-form">
                  <input
                    autoFocus
                    value={editing.value}
                    placeholder="文件夹名"
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitFolder()
                      if (e.key === 'Escape') {
                        setEditing(null)
                        setFolderError(null)
                      }
                    }}
                  />
                  <button type="button" className="icon-btn" title="确定" onClick={() => void submitFolder()}>
                    ✓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="取消"
                    onClick={() => {
                      setEditing(null)
                      setFolderError(null)
                    }}
                  >
                    ✕
                  </button>
                  {folderError ? <p className="folder-error">{folderError}</p> : null}
                </div>
              ) : (
                <button
                  type="button"
                  className="folder-new"
                  onClick={() => {
                    setFolderError(null)
                    setEditing({ id: null, value: '' })
                  }}
                >
                  + 新建文件夹
                </button>
              )}

              {activeFolder ? (
                <div className="folder-tools">
                  <button
                    type="button"
                    className="link"
                    onClick={() => setEditing({ id: activeFolder.id, value: activeFolder.name })}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => {
                      const count = docs.filter((d) => d.folderId === activeFolder.id).length
                      if (
                        window.confirm(
                          `删除文件夹「${activeFolder.name}」？里面的 ${count} 份文档会回到「未分类」，不会被删除。`,
                        )
                      ) {
                        void deleteFolder(activeFolder.id)
                        setFilter('all')
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              ) : null}
            </aside>

            <div className="shelf-content">
              {visible.length === 0 ? (
                <div className="empty-shelf">
                  {effectiveFilter === 'all'
                    ? '这里会是你的书架。导入一份文档，开始第一次「有停顿」的阅读。'
                    : effectiveFilter === 'none'
                      ? '所有文档都分好类了。'
                      : '这个文件夹还是空的。导入文档时会自动放进来，也可以在卡片下方把已有文档移进来。'}
                </div>
              ) : (
                <div className="doc-grid">
                  {visible.map((doc) => (
                    <DocCard
                      key={doc.id}
                      doc={doc}
                      folders={folders}
                      onOpen={() => void openDoc(doc.id)}
                      onDelete={() => {
                        if (window.confirm(`删除《${doc.title}》以及它的批注？此操作不可撤销。`)) {
                          void deleteDoc(doc.id)
                        }
                      }}
                      onMove={(folderId) => void moveDoc(doc.id, folderId)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="lib-foot">
        <span>本地优先 · 文档与批注只存在这台电脑的浏览器里</span>
        <span>MIT · 可自托管</span>
      </footer>

      {dragging && (
        <div className="drop-mask">
          {effectiveFilter !== 'all' && effectiveFilter !== 'none'
            ? `松手导入到「${activeFolder?.name ?? ''}」`
            : '松手导入'}
        </div>
      )}
    </div>
  )
}
