// 零依赖静态托管 + LLM 转发。给「小范围朋友」用最省事：
//   pnpm build && node server/serve.mjs --port 8787
// 浏览器打开 http://127.0.0.1:8787
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleProxy, sendJson } from './proxy.mjs'

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const portArg = process.argv.indexOf('--port')
const port = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  const candidate = resolve(normalize(join(root, clean)))
  return candidate.startsWith(root) ? candidate : null
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/api/proxy') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST,GET,OPTIONS',
      })
      return res.end()
    }
    return handleProxy(req, res, url.searchParams)
  }

  if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true })

  let file = safePath(url.pathname)
  if (!file) return sendJson(res, 403, { error: 'forbidden' })

  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    file = join(root, 'index.html')
  }

  try {
    const data = await readFile(file)
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(data)
  } catch {
    sendJson(res, 404, { error: 'not found' })
  }
})

server.listen(port, host, () => {
  console.log(`伴读 Margin 运行中 → http://${host}:${port}`)
})
