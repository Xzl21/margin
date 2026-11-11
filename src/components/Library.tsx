import { useRef, useState } from 'react'
import { useApp } from '../store'
import { useUi } from '../ui'
import { SAMPLE_MD } from '../samples/demo'
import { formatBytes, formatDate } from '../lib/util'
import type { Doc } from '../types'

const KIND_LABEL: Record<Doc['kind'], string> = {
  pdf: 'PDF',
  docx: 'Word',
  md: 'Markdown',
  txt: '纯文本',
}

function DocCard({ doc, onOpen, onDelete }: { doc: Doc; onOpen: () => void; onDelete: () => void }) {
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
    </article>
  )
}

export function Library() {
  const docs = useApp((s) => s.docs)
  const importFiles = useApp((s) => s.importFiles)
  const openDoc = useApp((s) => s.openDoc)
  const deleteDoc = useApp((s) => s.deleteDoc)
  const openSettings = useUi((s) => s.openSettings)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    void importFiles(Array.from(files))
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
            <p>把「读到哪、卡在哪、想到什么」留给未来的自己</p>
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
            <h2>不替你读，帮你读懂。</h2>
            <p>
              伴读不会把文档压成一段摘要。它先给你脉络，再在你划词的地方解释这句话在论证里干什么；
              你随手写在页边的想法，它会追问依据、指出跳步，但不会替你下结论。
            </p>
            <ul className="hero-points">
              <li><b>不剧透</b>：AI 只看到你已经读到的部分。</li>
              <li><b>不替代</b>：先问你、再补差，不自动总结。</li>
              <li><b>不锁定</b>：七家模型可换，数据全在本地，随时导出。</li>
            </ul>
          </div>
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
                void importFiles([file])
              }}
            >
              或者，先读一篇 3 分钟的示例
            </button>
          </div>
        </section>

        <section className="shelf">
          <div className="shelf-head">
            <h2>书架</h2>
            <span>{docs.length ? `${docs.length} 份文档` : '还没有文档'}</span>
          </div>
          {docs.length === 0 ? (
            <div className="empty-shelf">
              这里会是你的书架。导入一份文档，开始第一次「有停顿」的阅读。
            </div>
          ) : (
            <div className="doc-grid">
              {docs.map((doc) => (
                <DocCard
                  key={doc.id}
                  doc={doc}
                  onOpen={() => void openDoc(doc.id)}
                  onDelete={() => {
                    if (window.confirm(`删除《${doc.title}》以及它的批注？此操作不可撤销。`)) {
                      void deleteDoc(doc.id)
                    }
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="lib-foot">
        <span>本地优先 · 文档与批注只存在这台电脑的浏览器里</span>
        <span>MIT · 可自托管</span>
      </footer>

      {dragging && <div className="drop-mask">松手导入</div>}
    </div>
  )
}
