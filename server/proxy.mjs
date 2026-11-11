// 可选：本地/自托管 LLM 转发，解决浏览器直连各家 API 的 CORS 限制。
// 不放任何密钥：key 仍由浏览器带上，这里只做透传。
const HOP_BY_HOP = new Set([
  'host', 'origin', 'referer', 'connection', 'content-length',
  'accept-encoding', 'keep-alive', 'transfer-encoding', 'upgrade',
])

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/**
 * 处理 /api/proxy?url=<encoded>：把请求原样转发到目标，并流式返回。
 */
export async function handleProxy(req, res, searchParams) {
  const target = searchParams.get('url')
  if (!target) return sendJson(res, 400, { error: 'missing url' })
  let targetUrl
  try {
    targetUrl = new URL(target)
  } catch {
    return sendJson(res, 400, { error: 'bad url' })
  }
  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
    return sendJson(res, 400, { error: 'only http(s) allowed' })
  }

  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue
    if (typeof v === 'string') headers[k] = v
  }

  let body
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: 'read body failed' })
    }
  }

  const controller = new AbortController()
  res.on('close', () => controller.abort())

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined,
      signal: controller.signal,
    })
    const out = {
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    }
    res.writeHead(upstream.status, out)
    if (!upstream.body) return res.end()
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
      if (typeof res.flush === 'function') res.flush()
    }
    res.end()
  } catch (err) {
    if (controller.signal.aborted) {
      try { res.end() } catch { /* ignore */ }
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (!res.headersSent) sendJson(res, 502, { error: 'proxy failed', detail: msg })
    else res.end()
  }
}
