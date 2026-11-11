import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-ignore - plain ESM helper shared with server/serve.mjs
import { handleProxy, sendJson } from './server/proxy.mjs'

/**
 * 开发期把 /api/proxy?url=... 透传到真实 API，避免浏览器 CORS 限制。
 * 与 `node server/serve.mjs` 生产期行为一致。
 */
function devProxyPlugin() {
  return {
    name: 'margin-dev-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/proxy', (req: any, res: any) => {
        const fake = new URL(req.url ?? '/', 'http://localhost')
        void handleProxy(req, res, fake.searchParams)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devProxyPlugin()],
  server: { port: 5188, strictPort: false },
  build: { target: 'chrome110', chunkSizeWarningLimit: 1600 },
})
