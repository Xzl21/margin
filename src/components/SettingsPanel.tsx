import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { useUi } from '../ui'
import { collectChat } from '../ai/client'
import { searchWeb } from '../ai/search'
import { docMarkdown, download, exportBundle, importBundle } from '../lib/backup'
import { uuid } from '../lib/util'
import type { HighlightKey, NoteCategory, ProviderConfig, SearchKind, SearchProvider, Settings } from '../types'
import { HIGHLIGHT_LABELS } from '../ai/presets'
import { clearUsage, loadUsage, TASK_NAME, type UsageSummary } from '../ai/usage'

type Tab = 'models' | 'colors' | 'reading' | 'search' | 'usage' | 'data'
type TaskKey = keyof Settings['routing']

const HIGHLIGHT_KEYS: HighlightKey[] = ['note', 'ask', 'mark', 'verify-ok', 'verify-unknown']

/** 颜色选择器不接受空串，这里给一个和主题默认接近的初始值；选完才写回设置。 */
const HL_FALLBACK: Record<HighlightKey, string> = {
  note: '#e2a841',
  ask: '#7c9cc4',
  mark: '#ffd666',
  'verify-ok': '#4caf7d',
  'verify-unknown': '#8c8476',
}

const TASK_LABEL: Record<TaskKey, string> = {
  explain: '划词解释',
  verify: '查证',
  ask: '提问',
  critique: '批注点评',
  map: '依赖骨架',
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function fmtTime(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function SettingsPanel() {
  const close = useUi((s) => s.closeSettings)
  const settings = useApp((s) => s.settings)
  const saveProvider = useApp((s) => s.saveProvider)
  const removeProvider = useApp((s) => s.removeProvider)
  const patchSettings = useApp((s) => s.patchSettings)
  const doc = useApp((s) => s.doc)
  const blocks = useApp((s) => s.blocks)
  const anchors = useApp((s) => s.anchors)
  const notes = useApp((s) => s.notes)

  const [tab, setTab] = useState<Tab>('models')
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [usage, setUsage] = useState<string>('')
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const [usageTick, setUsageTick] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (tab !== 'usage') return
    let alive = true
    void loadUsage(80).then((s) => {
      if (alive) setUsageSummary(s)
    })
    return () => {
      alive = false
    }
  }, [tab, usageTick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    void (async () => {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate()
        const used = ((est.usage ?? 0) / 1024 / 1024).toFixed(1)
        setUsage(`${used} MB`)
      }
    })()
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  const updateProvider = (provider: ProviderConfig) => void saveProvider(provider)

  const test = async (provider: ProviderConfig) => {
    setTesting(provider.id)
    setTestResult((prev) => ({ ...prev, [provider.id]: '请求中…' }))
    try {
      const text = await collectChat({
        provider,
        model: provider.models[0] ?? '',
        messages: [{ role: 'user', content: '只回复两个字：可用' }],
        proxyBase: settings.proxyBase,
        temperature: 0,
      })
      setTestResult((prev) => ({ ...prev, [provider.id]: `✓ ${text.slice(0, 40) || '已返回'}` }))
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [provider.id]: `✗ ${(err as Error).message.slice(0, 160)}` }))
    } finally {
      setTesting(null)
    }
  }

  const saveSearchProvider = (provider: SearchProvider) =>
    void patchSettings({
      search: {
        ...settings.search,
        providers: settings.search.providers.map((p) => (p.id === provider.id ? provider : p)),
      },
    })

  const testSearch = async (provider: SearchProvider) => {
    setTesting(provider.id)
    setTestResult((prev) => ({ ...prev, [provider.id]: '检索中…' }))
    try {
      const hits = await searchWeb(
        { ...settings, search: { ...settings.search, activeId: provider.id } },
        '大语言模型的上下文窗口是什么',
      )
      setTestResult((prev) => ({
        ...prev,
        [provider.id]: `✓ 拿到 ${hits.length} 条结果${hits[0]?.title ? `：${hits[0].title.slice(0, 24)}` : ''}`,
      }))
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [provider.id]: `✗ ${(err as Error).message.slice(0, 160)}` }))
    } finally {
      setTesting(null)
    }
  }

  const exportJson = async () => {
    const blob = await exportBundle()
    download(blob, `伴读备份-${new Date().toISOString().slice(0, 10)}.json`)
    setMessage('已导出完整备份（文档、批注、设置）')
  }

  const exportMd = () => {
    if (!doc) {
      setMessage('先打开一份文档，再导出它的 Markdown 批注')
      return
    }
    const md = docMarkdown({ doc, blocks, anchors, notes })
    download(new Blob([md], { type: 'text/markdown' }), `${doc.title}-批注.md`)
    setMessage('已导出 Markdown')
  }

  const doImport = async (file: File) => {
    try {
      const result = await importBundle(file)
      await useApp.getState().refreshDocs()
      useApp.getState().closeDoc()
      setMessage(`已导入 ${result.docs} 份文档、${result.notes} 条批注`)
    } catch (err) {
      setMessage(`导入失败：${(err as Error).message}`)
    }
  }

  return (
    <div className="modal-mask" onMouseDown={close}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>设置</h2>
          <div className="settings-tabs">
            {([
              ['models', '模型'],
              ['colors', '外观'],
              ['reading', '阅读'],
              ['search', '联网'],
              ['usage', '用量'],
              ['data', '数据'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" onClick={close} title="关闭">
            ✕
          </button>
        </header>

        {message && (
          <div className="settings-message">
            {message}
            <button type="button" className="mini" onClick={() => setMessage(null)}>
              知道了
            </button>
          </div>
        )}

        <div className="settings-body">
          {tab === 'models' && (
            <>
              <section>
                <h3>任务用哪个模型</h3>
                <p className="section-hint">
                  四个任务可以各用各的模型。便宜的模型（deepseek-flash）做解释足够；骨架和点评可以换成更强的 deepseek-v4-pro。
                </p>
                <div className="route-grid">
                  {(Object.keys(TASK_LABEL) as TaskKey[]).map((key) => {
                    const route = settings.routing[key]
                    const provider = settings.providers.find((p) => p.id === route.providerId)
                    return (
                      <label key={key} className="route-row">
                        <span>{TASK_LABEL[key]}</span>
                        <select
                          value={route.providerId}
                          onChange={(e) => {
                            const next = settings.providers.find((p) => p.id === e.target.value)
                            void patchSettings({
                              routing: {
                                ...settings.routing,
                                [key]: { providerId: e.target.value, model: next?.models[0] ?? '' },
                              },
                            })
                          }}
                        >
                          {settings.providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <input
                          list={`models-${key}`}
                          value={route.model}
                          placeholder="模型名"
                          onChange={(e) => {
                            void patchSettings({
                              routing: { ...settings.routing, [key]: { ...route, model: e.target.value } },
                            })
                          }}
                        />
                        <datalist id={`models-${key}`}>
                          {(provider?.models ?? []).map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      </label>
                    )
                  })}
                </div>
              </section>

              <section>
                <h3>厂商与密钥</h3>
                <p className="section-hint">
                  只预置 DeepSeek 一家，其它任何 OpenAI 兼容接口都可以用下面的「添加自定义」接进来。密钥只保存在这台电脑的浏览器 IndexedDB 里，不会上传到任何地方。浏览器直连被 CORS 拦时，打开「经本地转发」，
                  并用 <code>node server/serve.mjs</code> 启动（或部署时保留 <code>/api/proxy</code>）。
                </p>
                <div className="provider-list">
                  {settings.providers.map((provider) => (
                    <div key={provider.id} className="provider-card">
                      <div className="provider-head">
                        <input
                          className="provider-name"
                          value={provider.name}
                          onChange={(e) => updateProvider({ ...provider, name: e.target.value })}
                        />
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={provider.proxy}
                            onChange={(e) => updateProvider({ ...provider, proxy: e.target.checked })}
                          />
                          经本地转发
                        </label>
                        <button
                          type="button"
                          className="mini"
                          disabled={testing === provider.id}
                          onClick={() => void test(provider)}
                        >
                          {testing === provider.id ? '测试中…' : '测试连接'}
                        </button>
                        <button
                          type="button"
                          className="mini danger"
                          onClick={() => void removeProvider(provider.id)}
                        >
                          移除
                        </button>
                      </div>
                      <div className="provider-grid">
                        <label>
                          <span>Base URL</span>
                          <input
                            value={provider.baseURL}
                            placeholder="https://api.deepseek.com"
                            onChange={(e) => updateProvider({ ...provider, baseURL: e.target.value })}
                          />
                        </label>
                        <label>
                          <span>API Key</span>
                          <input
                            type="password"
                            value={provider.apiKey}
                            placeholder="sk-…（本地模型可留空）"
                            autoComplete="off"
                            onChange={(e) => updateProvider({ ...provider, apiKey: e.target.value })}
                          />
                        </label>
                        <label className="wide">
                          <span>模型列表（逗号分隔）</span>
                          <input
                            value={provider.models.join(', ')}
                            onChange={(e) =>
                              updateProvider({
                                ...provider,
                                models: e.target.value.split(',').map((m) => m.trim()).filter(Boolean),
                              })
                            }
                          />
                        </label>
                      </div>
                      {testResult[provider.id] && (
                        <p className={`test-result ${testResult[provider.id].startsWith('✓') ? 'ok' : 'bad'}`}>
                          {testResult[provider.id]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    void saveProvider({
                      id: `custom-${uuid().slice(0, 6)}`,
                      name: '自定义厂商',
                      baseURL: 'https://',
                      apiKey: '',
                      models: [],
                      proxy: true,
                    })
                  }
                >
                  + 添加自定义（任何 OpenAI 兼容接口）
                </button>
              </section>
            </>
          )}

          {tab === 'colors' && (
            <>
              <section>
                <h3>划线颜色</h3>
                <p className="section-hint">
                  五类标记各用各的颜色，正文高亮和 PDF 覆盖层都会跟着变。想回主题默认就点「跟随主题」。
                </p>
                {HIGHLIGHT_KEYS.map((key) => (
                  <div className="color-row" key={key}>
                    <span className="color-label">{HIGHLIGHT_LABELS[key]}</span>
                    <input
                      type="color"
                      value={settings.highlightColors[key] || HL_FALLBACK[key]}
                      onChange={(e) =>
                        void patchSettings({
                          highlightColors: { ...settings.highlightColors, [key]: e.target.value },
                        })
                      }
                    />
                    <span className="color-value">
                      {settings.highlightColors[key] ? settings.highlightColors[key] : '跟随主题'}
                    </span>
                    <button
                      type="button"
                      className="mini"
                      disabled={!settings.highlightColors[key]}
                      onClick={() =>
                        void patchSettings({
                          highlightColors: { ...settings.highlightColors, [key]: '' },
                        })
                      }
                    >
                      跟随主题
                    </button>
                  </div>
                ))}
              </section>

              <section>
                <h3>批注类别</h3>
                <p className="section-hint">
                  类别名随便改，颜色决定页边卡片的边线和正文里这条批注的高亮。删掉一个类别不会删批注，
                  那些批注会退回主题默认色，也可以在批注的「编辑」里换到别的类别。
                </p>
                {settings.noteCategories.map((c) => (
                  <div className="color-row" key={c.id}>
                    <input
                      className="cat-label"
                      value={c.label}
                      onChange={(e) =>
                        void patchSettings({
                          noteCategories: settings.noteCategories.map((x) =>
                            x.id === c.id ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <input
                      type="color"
                      value={c.color}
                      onChange={(e) =>
                        void patchSettings({
                          noteCategories: settings.noteCategories.map((x) =>
                            x.id === c.id ? { ...x, color: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="mini danger"
                      disabled={settings.noteCategories.length <= 1}
                      onClick={() =>
                        void patchSettings({
                          noteCategories: settings.noteCategories.filter((x) => x.id !== c.id),
                        })
                      }
                    >
                      删除
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    const cat: NoteCategory = {
                      id: `cat-${Date.now().toString(36).slice(-5)}`,
                      label: '新类别',
                      color: '#7a8fa6',
                    }
                    void patchSettings({ noteCategories: [...settings.noteCategories, cat] })
                  }}
                >
                  + 新增类别
                </button>
              </section>
            </>
          )}

          {tab === 'search' && (
            <>
              <section>
                <h3>「查证」用哪个检索服务</h3>
                <p className="section-hint">
                  选中一句话点「查证」，它会先用下面的服务去搜索，打开前几条结果的正文，再让模型**只依据这些资料**给出
                  「支持 / 部分支持 / 与资料矛盾 / 资料不足」的结论，并标出处。检索 Key 也只存在这台电脑的浏览器里。
                  检索接口基本都不允许浏览器直连，所以默认走本地转发（<code>/api/proxy</code>）。
                </p>
                <div className="provider-list">
                  {settings.search.providers.map((provider) => (
                    <div
                      key={provider.id}
                      className={`provider-card ${settings.search.activeId === provider.id ? 'active' : ''}`}
                    >
                      <div className="provider-head">
                        <label className="toggle">
                          <input
                            type="radio"
                            name="search-active"
                            checked={settings.search.activeId === provider.id}
                            onChange={() =>
                              void patchSettings({ search: { ...settings.search, activeId: provider.id } })
                            }
                          />
                          {provider.name}
                        </label>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={provider.proxy}
                            onChange={(e) => saveSearchProvider({ ...provider, proxy: e.target.checked })}
                          />
                          经本地转发
                        </label>
                        <button
                          type="button"
                          className="mini"
                          disabled={testing === provider.id}
                          onClick={() => void testSearch(provider)}
                        >
                          {testing === provider.id ? '检索中…' : '测试检索'}
                        </button>
                      </div>
                      <div className="provider-grid">
                        <label>
                          <span>服务类型</span>
                          <select
                            value={provider.kind}
                            onChange={(e) =>
                              saveSearchProvider({ ...provider, kind: e.target.value as SearchKind })
                            }
                          >
                            <option value="tavily">Tavily（推荐，专为模型设计）</option>
                            <option value="brave">Brave Search</option>
                            <option value="serper">Serper（Google 结果）</option>
                            <option value="searxng">SearXNG（自建，免费）</option>
                          </select>
                        </label>
                        {provider.kind === 'searxng' ? (
                          <label>
                            <span>实例地址</span>
                            <input
                              value={provider.endpoint ?? ''}
                              placeholder="https://searx.be"
                              onChange={(e) => saveSearchProvider({ ...provider, endpoint: e.target.value })}
                            />
                          </label>
                        ) : (
                          <label>
                            <span>API Key</span>
                            <input
                              type="password"
                              value={provider.apiKey}
                              placeholder="检索服务的 Key"
                              autoComplete="off"
                              onChange={(e) => saveSearchProvider({ ...provider, apiKey: e.target.value })}
                            />
                          </label>
                        )}
                      </div>
                      {testResult[provider.id] && (
                        <p className={`test-result ${testResult[provider.id].startsWith('✓') ? 'ok' : 'bad'}`}>
                          {testResult[provider.id]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <label className="field">
                  <span>每次取几条结果（1–10）</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={settings.search.maxResults}
                    onChange={(e) =>
                      void patchSettings({
                        search: { ...settings.search, maxResults: Math.max(1, Math.min(10, Number(e.target.value) || 5)) },
                      })
                    }
                  />
                </label>
              </section>

              <section>
                <h3>不想再买一个 Key？</h3>
                <p className="section-hint">
                  自建一个 <a href="https://docs.searxng.org/" target="_blank" rel="noreferrer">SearXNG</a>
                  （Docker 一行就能跑）是免费的、不限量，还能自己选搜索引擎。把实例地址填到上面并把「服务类型」改成
                  SearXNG 即可。注意：查证时你选中的句子会发给检索服务，介意的话就自建。
                </p>
              </section>
            </>
          )}

          {tab === 'reading' && (
            <>
              <section>
                <h3>AI 的姿态</h3>
                <div className="stance-grid">
                  <button
                    type="button"
                    className={`stance-card ${settings.stance === 'socratic' ? 'active' : ''}`}
                    onClick={() => void patchSettings({ stance: 'socratic' })}
                  >
                    <strong>追问式</strong>
                    <span>不判对错，先问你依据。适合想自己长本事的时候。</span>
                  </button>
                  <button
                    type="button"
                    className={`stance-card ${settings.stance === 'corrective' ? 'active' : ''}`}
                    onClick={() => void patchSettings({ stance: 'corrective' })}
                  >
                    <strong>纠错式</strong>
                    <span>直接指出事实错误与推理跳跃，给更准确的说法。</span>
                  </button>
                </div>
              </section>

              <section>
                <h3>不剧透</h3>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={settings.noSpoiler}
                    onChange={(e) => void patchSettings({ noSpoiler: e.target.checked })}
                  />
                  <span>
                    默认让 AI 看到全文（不再遮住后面的内容）
                    <small>打开「不剧透」后，解释、概念、提问、查证都只用你已经读过的部分。</small>
                  </span>
                </label>
              </section>

              <section>
                <h3>排版</h3>
                <label className="range-row">
                  <span>正文字号</span>
                  <input
                    type="range"
                    min={15}
                    max={24}
                    step={1}
                    value={settings.fontSize}
                    onChange={(e) => void patchSettings({ fontSize: Number(e.target.value) })}
                  />
                  <b>{settings.fontSize}px</b>
                </label>
                <label className="range-row">
                  <span>主题</span>
                  <select
                    value={settings.theme}
                    onChange={(e) => void patchSettings({ theme: e.target.value as Settings['theme'] })}
                  >
                    <option value="paper">纸页</option>
                    <option value="plain">素白</option>
                    <option value="dark">夜间</option>
                  </select>
                </label>
                <label className="range-row">
                  <span>转发地址</span>
                  <input
                    value={settings.proxyBase}
                    onChange={(e) => void patchSettings({ proxyBase: e.target.value })}
                  />
                </label>
                <p className="section-hint">
                  转发地址只在打开「经本地转发」时使用。自托管时可指向自己的转发服务，路径形如
                  <code> /api/proxy?url=&lt;encoded&gt;</code>。
                </p>
              </section>
            </>
          )}

          {tab === 'usage' && (
            <>
              <section>
                <h3>API 用量</h3>
                <p className="section-hint">
                  每次调用模型后，服务端回报的 token 数会记在本机这里（不上传、不同步）。没有回报用量的厂商不会出现在统计里。
                </p>
                {!usageSummary ? (
                  <p className="section-hint">读取中…</p>
                ) : usageSummary.total.calls === 0 ? (
                  <p className="section-hint">
                    还没有记录。去正文里划一个词、点「解释」或「提问」，之后回到这里就能看到。
                  </p>
                ) : (
                  <>
                    <div className="usage-grid">
                      {([
                        ['今天', usageSummary.today],
                        ['近 7 天', usageSummary.week],
                        ['总计', usageSummary.total],
                      ] as const).map(([label, t]) => (
                        <div className="usage-card" key={label}>
                          <span className="usage-label">{label}</span>
                          <strong>{fmtTokens(t.promptTokens + t.completionTokens)}</strong>
                          <span className="usage-sub">
                            输入 {fmtTokens(t.promptTokens)} · 输出 {fmtTokens(t.completionTokens)} · {t.calls} 次
                          </span>
                        </div>
                      ))}
                    </div>

                    <h3>按功能</h3>
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>功能</th>
                          <th>次数</th>
                          <th>输入</th>
                          <th>输出</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageSummary.byTask.map((row) => (
                          <tr key={row.key}>
                            <td>{TASK_NAME[row.key] ?? row.key}</td>
                            <td>{row.calls}</td>
                            <td>{fmtTokens(row.promptTokens)}</td>
                            <td>{fmtTokens(row.completionTokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <h3>按模型</h3>
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>模型</th>
                          <th>次数</th>
                          <th>输入</th>
                          <th>输出</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageSummary.byModel.map((row) => (
                          <tr key={row.key}>
                            <td>{row.label}</td>
                            <td>{row.calls}</td>
                            <td>{fmtTokens(row.promptTokens)}</td>
                            <td>{fmtTokens(row.completionTokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <h3>最近调用</h3>
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>功能</th>
                          <th>模型</th>
                          <th>输入</th>
                          <th>输出</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageSummary.recent.map((row) => (
                          <tr key={row.id}>
                            <td>{fmtTime(row.at)}</td>
                            <td>{TASK_NAME[row.task] ?? row.task}</td>
                            <td>{row.model}</td>
                            <td>{fmtTokens(row.promptTokens)}</td>
                            <td>{fmtTokens(row.completionTokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <p className="section-hint">
                      这里只统计 token，不换算金额：各家单价不同，按你手上的价目表乘一下即可。记录只在本浏览器，换设备不会带过去。
                    </p>
                    <button
                      type="button"
                      className="mini danger"
                      onClick={() => {
                        if (!window.confirm('清空本机所有用量记录？不影响文档和批注。')) return
                        void clearUsage().then(() => setUsageTick((n) => n + 1))
                      }}
                    >
                      清空用量记录
                    </button>
                  </>
                )}
              </section>
            </>
          )}

          {tab === 'data' && (
            <>
              <section>
                <h3>你的数据</h3>
                <p className="section-hint">
                  所有文档、批注、点评都存在本机浏览器里（IndexedDB）。清除浏览器数据会一并清掉，记得定期导出。
                </p>
                <p className="storage-line">当前占用约 {usage || '计算中…'}</p>
                <div className="data-actions">
                  <button type="button" className="primary" onClick={() => void exportJson()}>
                    导出完整备份（JSON）
                  </button>
                  <button type="button" className="ghost" onClick={exportMd}>
                    导出 Markdown 批注
                  </button>
                  <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
                    从备份导入
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void doImport(file)
                      e.target.value = ''
                    }}
                  />
                </div>
                <p className="section-hint danger-text">
                  导入会覆盖当前全部数据。想保留的话先导出一份。
                </p>
              </section>

              <section>
                <h3>开源与部署</h3>
                <p className="section-hint">
                  伴读是 MIT 开源的单页应用：<code>pnpm build</code> 后把 <code>dist/</code> 丢到任意静态托管即可；
                  想让朋友直连模型不折腾 CORS，就一起跑 <code>node server/serve.mjs</code>。
                </p>
              </section>
            </>
          )}
        </div>

        <footer>
          <span>伴读 Margin 0.1.0 · 本地优先</span>
          <button type="button" className="primary" onClick={close}>
            完成
          </button>
        </footer>
      </div>
    </div>
  )
}
