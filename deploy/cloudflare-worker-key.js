// 可选：把「你自己的 Key」借给朋友用的 Cloudflare Worker。
// 默认的 /api/proxy 是纯透传，每个访客用自己的 Key；这个 Worker 则把 Key 放在服务端，
// 访客不用填 Key，但你要承担费用与被滥用的风险——所以加了来源白名单与简单的每日限额。
//
// 部署：
//   1. 在 Cloudflare 建一个 Worker，粘贴本文件；
//   2. Settings → Variables：UPSTREAM（例如 https://api.deepseek.com/v1）、
//      UPSTREAM_KEY（你的 Key，选 Encrypt）、ALLOWED_ORIGIN（你的 Pages 域名）、
//      DAILY_LIMIT（可选，默认 300）；
//   3. 绑一个 KV 命名空间，变量名 RATE（用于计数）；
//   4. 阅读器里把 Base URL 填成 https://<worker>.workers.dev/v1，Key 随便填、打开「经本地转发」。
//
// 注意：这仍然是「把 Key 给所有人用」，只是不直接暴露在浏览器里。公开前想清楚限额与成本。

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? ''
    const cors = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || origin || '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
      return new Response('forbidden origin', { status: 403, headers: cors })
    }

    const day = new Date().toISOString().slice(0, 10)
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    const key = `${day}:${ip}`
    const limit = Number(env.DAILY_LIMIT || 300)
    if (env.RATE) {
      const used = Number((await env.RATE.get(key)) || 0)
      if (used >= limit) return new Response('daily limit reached', { status: 429, headers: cors })
      await env.RATE.put(key, String(used + 1), { expirationTtl: 172800 })
    }

    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/proxy/, '')
    const upstream = (env.UPSTREAM || 'https://api.deepseek.com/v1').replace(/\/+$/, '') + path + url.search

    const headers = new Headers()
    headers.set('authorization', `Bearer ${env.UPSTREAM_KEY}`)
    headers.set('content-type', request.headers.get('content-type') || 'application/json')

    const init = { method: request.method, headers }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body
      init.duplex = 'half'
    }
    const res = await fetch(upstream, init)
    const out = new Headers(cors)
    out.set('content-type', res.headers.get('content-type') || 'application/json')
    out.set('cache-control', 'no-store')
    return new Response(res.body, { status: res.status, headers: out })
  },
}
