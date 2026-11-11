// Cloudflare Pages Function：/api/proxy?url=<encoded>
// 与 server/proxy.mjs 同职责、同语义：只做透传，不保存任何 Key。
// 作用：让「浏览器直连被 CORS 拦」的模型/检索接口在公开网页上也能用。
const FORWARD = new Set([
  'authorization',
  'content-type',
  'accept',
  'x-api-key',
  'x-subscription-token',
])

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const target = url.searchParams.get('url')
  if (!target) return json(400, { error: 'missing url' })

  let targetUrl
  try {
    targetUrl = new URL(target)
  } catch {
    return json(400, { error: 'bad url' })
  }
  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
    return json(400, { error: 'only http(s) allowed' })
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      },
    })
  }

  const headers = new Headers()
  for (const [key, value] of request.headers) {
    if (FORWARD.has(key.toLowerCase())) headers.set(key, value)
  }

  const init = { method: request.method, headers, redirect: 'follow' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }

  let upstream
  try {
    upstream = await fetch(targetUrl.toString(), init)
  } catch (err) {
    return json(502, { error: 'proxy failed', detail: String(err).slice(0, 300) })
  }

  const out = new Headers({
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
  })
  // 流式返回：SSE 才能边生成边显示
  return new Response(upstream.body, { status: upstream.status, headers: out })
}
