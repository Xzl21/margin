import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 8788)

const EXPLAIN = `### 它在做什么
这句话在给「认知负荷」下最小定义：**工作记忆一次能装的信息很少**。

### 最小定义
「认知负荷」在这里指的不是难不难，而是同一时刻要在脑子里同时拎着几个新东西。

### 要不要深究
先别深究它的实验来源，接着往下读：作者马上要用它解释「为什么一句话塞三个新概念会卡住」。
`

const CRITIQUE = `**你抓住了作者的因果方向，但跳了一步。**

你说「读起来顺 = 理解了」，作者在第 4 段其实区分了两件事：流利感（fluency）与可提取性（retrievability）。

追问一句：如果合上书复述不出来，但读的时候很顺，你会怎么判断自己到底懂没懂？`

const VERIFY = `### 结论
**部分支持**：这句话的方向和主流研究一致，但「一次只能装 4 个组块」被说死了，原始文献给的是范围而不是精确数字 [1][2]。

### 依据
- [1] Miller 1956 讨论的是 7±2 的「组块」，不是固定 4 个；后续研究把范围压到约 4 个，但没有定论。
- [2] 资料只说明工作记忆容量有限，没有支持「一次塞三个新概念就一定卡住」这种因果强度。

### 需要当心
科普文章常把「7±2」写成铁律；这条说法在中文二手资料里被反复转述，原始出处容易失真。

### 还缺什么
要下更强结论，需要原始论文的实验条件，以及针对中文阅读材料的复现研究。`

const MAP = JSON.stringify({
  nodes: [
    { id: 'n1', title: '总结会丢掉依赖边', kind: 'claim', note: '摘要只保留结论，丢掉了「为什么需要这个前提」' },
    { id: 'n2', title: '认知负荷：工作记忆有限', kind: 'definition', note: '卡住常因一句话塞了多个新概念' },
    { id: 'n3', title: '先行组织者：先给挂点', kind: 'definition', note: '不提供答案，只提供结构' },
    { id: 'n4', title: '合意困难：顺 ≠ 懂', kind: 'premise', note: '总结会带来理解的错觉' },
    { id: 'n5', title: '四步阅读路线', kind: 'method', note: '扫结构 → 建最小定义 → 段末复述 → 回补依赖' },
  ],
  edges: [
    { from: 'n2', to: 'n1', why: '要知道为什么会卡，先知道工作记忆有限' },
    { from: 'n2', to: 'n4', why: '顺与懂的区别建立在负荷理论上' },
    { from: 'n3', to: 'n5', why: '扫结构就是给自己造先行组织者' },
    { from: 'n4', to: 'n5', why: '段末复述是在制造合意困难' },
  ],
})

const SEARCH_RESULTS = [
  {
    title: 'Working memory: 4 chunks, not 7',
    url: `http://127.0.0.1:${PORT}/page/1`,
    content: '工作记忆一次能保持的组块数量大约在 4 个左右，这一数字在不同研究中有波动，并没有定论。',
  },
  {
    title: 'Miller 1956, The Magical Number Seven',
    url: `http://127.0.0.1:${PORT}/page/2`,
    content: 'Miller 的原文讨论的是 7±2 个组块，并明确说这个数字不是固定常数。',
  },
  {
    title: '科普转述：一次只能记住三件事',
    url: `http://127.0.0.1:${PORT}/page/3`,
    content: '很多科普文章把认知负荷写成「一次最多三个新概念」，属于二手转述。',
  },
]

/** 模拟 DeepSeek 官方搜索：多一个 600–800 字的 summary 和权威分 */
const DEEPSEEK_RESULTS = SEARCH_RESULTS.map((r, i) => ({
  rerank_score: 2.6 - i * 0.4,
  title: r.title,
  url: r.url,
  snippet: r.content.slice(0, 120),
  summary: `${r.content} 这段是模拟的 600 字长摘要里的开头部分，真实接口会返回更完整的上下文，供模型直接阅读。`,
  site_name: ['Nature', 'APA PsycNet', '某科普站'][i] ?? 'mock',
  authority: 3 - i,
  date: '2024-05-01',
}))

const FETCH_CONTENT = `# 工作记忆的容量

工作记忆（working memory）一次能够同时保持和操作的信息量是有限的。早期研究给出的经典数字是 7±2 个组块，后续研究认为实际容量更接近 4 个组块。

- 具体数字依赖材料组织方式与测量方法
- 学界没有统一铁律
`

const PAGE_HTML = `<!doctype html><html><head><title>mock page</title></head><body>
<nav>导航</nav>
<article>
<h1>工作记忆的容量</h1>
<p>工作记忆（working memory）一次能够同时保持和操作的信息量是有限的。早期研究给出的经典数字是 7±2 个组块，后续研究认为实际容量更接近 4 个组块，但具体数字依赖于材料的组织方式与测量方法，学界并没有一个统一的铁律。</p>
<p>因此，把「一次只能装 4 个组块」当作精确结论是不严谨的；更稳妥的表述是「容量有限，且明显少于直觉」。</p>
</article>
<footer>页脚</footer>
</body></html>`

function pickReply(messages) {
  const sys = messages.find((m) => m.role === 'system')?.content ?? ''
  if (sys.includes('事实核查') || sys.includes('核查员')) return VERIFY
  if (sys.includes('JSON') || sys.includes('json') || sys.includes('骨架')) return MAP
  if (sys.includes('批注')) return CRITIQUE
  return EXPLAIN
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  if (req.method === 'GET' && req.url.startsWith('/page/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE_HTML)
    return
  }

  if (req.method === 'POST' && req.url === '/search') {
    json(res, 200, { query: 'mock', results: SEARCH_RESULTS })
    return
  }

  if (req.method === 'POST' && req.url === '/v1/tools/search') {
    json(res, 200, { query: 'mock', results: DEEPSEEK_RESULTS })
    return
  }

  if (req.method === 'POST' && req.url === '/v1/tools/fetch') {
    json(res, 200, { title: '工作记忆的容量', content: FETCH_CONTENT })
    return
  }

  if (req.method === 'GET' && req.url.startsWith('/res/v1/web/search')) {
    json(res, 200, {
      web: {
        results: SEARCH_RESULTS.map((r) => ({ title: r.title, url: r.url, description: r.content })),
      },
    })
    return
  }

  if (req.method === 'POST' && req.url === '/search-serper') {
    json(res, 200, {
      organic: SEARCH_RESULTS.map((r) => ({ title: r.title, link: r.url, snippet: r.content })),
    })
    return
  }

  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}')
    return
  }
  let body = ''
  req.on('data', (c) => {
    body += c
  })
  req.on('end', async () => {
    let messages = []
    let tools = []
    try {
      const parsed = JSON.parse(body)
      messages = parsed.messages ?? []
      tools = parsed.tools ?? []
    } catch {
      /* ignore */
    }
    const reply = pickReply(messages)
    const usedTools = tools.some((t) => t?.type === 'deepseek_web_search')
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const chunks = reply.match(/[\s\S]{1,18}/g) ?? [reply]
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
      await new Promise((r) => setTimeout(r, 12))
    }
    if (usedTools) {
      // 模拟最后一块才把完整引用给全
      res.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                annotations: DEEPSEEK_RESULTS.slice(0, 2).map((r) => ({
                  type: 'url_citation',
                  url_citation: { url: r.url, title: r.title, start_index: 0, end_index: 10 },
                })),
              },
            },
          ],
        })}\n\n`,
      )
    }
    res.write(
      `data: ${JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 1280,
          completion_tokens: 96,
          prompt_cache_hit_tokens: 1024,
          completion_tokens_details: { reasoning_tokens: 320 },
          server_tool_use: { tool_search: usedTools ? 2 : 0, tool_fetch: usedTools ? 1 : 0 },
        },
      })}\n\n`,
    )
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`mock llm on http://127.0.0.1:${PORT}/v1`))
