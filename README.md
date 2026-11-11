# 伴读 Margin

一个跑在浏览器里的**学习型文档阅读器**：读 PDF / Word / Markdown，在划词和写批注的地方给出解释、提问和查证，而不是把整篇文档压成摘要。

数据全部留在本地浏览器（IndexedDB），无账号、无后端、无埋点；模型与检索都用你自己的 Key。

## 功能

| 能力 | 说明 |
| --- | --- |
| 导入文档 | PDF、Word(.docx)、Markdown、纯文本；浏览器本地解析，不上传 |
| 书架与进度 | 记录每篇读到哪一段，下次接着读 |
| 脉络大纲 | 自动提取文档结构，侧栏点击跳转 |
| 划词解释 | 三层回答：它在论证里做什么 / 最小定义与前置概念 / 要不要深究；必须引用原文 |
| 页边批注 | 批注贴在对应段落的页边，像真书页边一样错落下推 |
| AI 点评 | 对一条批注追问依据、要反例、指出跳步；追问式 / 纠错式两种姿态 |
| 划词提问 | 围绕选中的那句话提问，回答不跑题 |
| 联网查证 | 先检索、再读前几条结果正文，只依据资料判断「支持 / 部分支持 / 与资料矛盾 / 资料不足」，逐条标出处；未联网会明确说明 |
| 卡点日志 | 标记「没懂」，汇总到侧栏，读懂后勾掉 |
| 依赖地图 | 抽取论点、前提、定义与「读懂 B 先懂 A」的依赖边，生成按依赖排序的阅读路线 |
| 防剧透 | 只把阅读前沿之前的内容发给模型，后面的内容它看不到 |
| 多模型 | 解释 / 提问 / 点评 / 地图四个任务可分别指定厂商与模型 |
| 主题与字号 | 纸感 / 素白 / 夜读，字号 15–24 |
| 备份 | 导出 JSON、导出 Markdown 读书笔记、导入恢复 |

## 本地运行

需要 Node 20+ 与 pnpm。以下命令都在项目根目录执行：

```bash
pnpm install

pnpm dev      # 开发模式，http://localhost:5188
pnpm build    # 类型检查 + 生产构建，产物在 dist/
pnpm serve    # 托管 dist/ 并提供 /api/proxy 转发，默认 http://127.0.0.1:8787
```

只想自己用：`pnpm build && pnpm serve`，浏览器打开 `http://127.0.0.1:8787` 即可。

## 配置模型

打开「设置 → 模型」：

1. 选一家厂商（内置 DeepSeek、通义千问、Kimi、智谱 GLM、OpenAI、OpenRouter、Ollama），填 API Key；
2. 勾上「经本地转发」，请求走 `/api/proxy`，避免浏览器 CORS 报错；
3. 在「解释 / 提问 / 点评 / 地图」四行分别选厂商和模型；
4. 点「测试连接」确认可用。

Ollama 等本地模型把 BaseURL 指向 `http://127.0.0.1:11434/v1`，不需要 Key。

## 配置联网查证（可选）

「查证」需要一个检索服务（与模型 Key 分开）：

1. 打开「设置 → 联网」，选择服务：Tavily、Brave Search、Serper，或自建的 SearXNG；
2. 填 API Key（SearXNG 填实例地址，例如 `https://searx.be`，免费、不限量）；
3. 点「测试检索」确认能返回结果。

检索接口不允许浏览器直连，默认经 `/api/proxy` 转发。查证时选中的句子会发给检索服务；介意的话自建 SearXNG。

## 部署

### Cloudflare Pages（推荐）

1. 把本仓库推到 GitHub；
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，选择仓库；
3. 构建设置：
   - Build command：`pnpm build`
   - Build output directory：`dist`
   - 环境变量：`NODE_VERSION=22`
4. 保存并部署，得到 `https://<项目名>.pages.dev`。

仓库里的 `functions/api/proxy.js` 会被自动识别为 Pages Function，因此 `/api/proxy` 直接可用，不需要额外服务。之后每次 `git push` 都会自动重新构建。

### 自托管

静态文件 + Node 转发：

```bash
pnpm build
pnpm serve --port 8787
```

也可以只把 `dist/` 放到任意静态托管（Nginx、Vercel、Netlify），再自行提供一个等价的 `/api/proxy` 转发接口；没有转发时，在设置里关掉「经本地转发」，但多数厂商不允许浏览器直连。

### 访问者的 Key 与费用

- 每个访客的 Key 存在他自己的浏览器 IndexedDB 里，不上传、不进仓库；`/api/proxy` 只透传，不保存 Key。因此别人打开网页用的是他们自己的额度。
- 如果想让朋友免配 Key、直接使用部署者的额度，需要把 Key 放到服务端。可参考 `deploy/cloudflare-worker-key.js`（Worker + 环境变量 + 来源白名单 + 每日限额）。这等于公开自己的额度，请自行评估成本与滥用风险。

## 数据与隐私

- 文档正文、批注、卡点、对话、设置全部存在浏览器 IndexedDB（库名 `margin-reader`）。
- 只有主动划词、写批注、生成地图时，才会把当前段落前后已读的部分发给模型。
- 「查证」会把选中的句子发给检索服务，并经 `/api/proxy` 打开前 3 条结果的网页正文；抓取内容只用于本次核查，不落库。
- 无遥测。清除站点数据会丢失记录，建议定期用「导出 JSON」备份。

## 目录结构

```
margin/
├─ src/
│  ├─ components/   阅读器、书架、页边批注、划词条、动作浮窗、设置
│  ├─ ingest/       PDF / DOCX / MD / TXT → 统一块模型（含大纲）
│  ├─ ai/           厂商预设、OpenAI 兼容流式客户端、检索、提示词、任务封装
│  ├─ lib/          锚点与高亮、Markdown 渲染、备份导出
│  ├─ store.ts      zustand 应用状态 + Dexie 持久化
│  └─ styles.css    三套主题 + 版面
├─ server/          本地静态托管与 /api/proxy（零依赖）
├─ functions/api/   Cloudflare Pages 版 /api/proxy
├─ deploy/          出借自身 Key 的 Worker 示例
├─ scripts/         构建产物自检
└─ dist/            构建产物
```

## 技术栈

TypeScript（strict）· React 19 · Vite（rolldown）· zustand · Dexie（IndexedDB）· pdf.js · mammoth · markdown-it + DOMPurify · CSS Custom Highlight API。

## 已知限制

- PDF 扫描件没有文本层，暂不支持（需要 OCR）。
- PDF 按文本行重建段落，复杂分栏或表格可能串行；Word 复杂版式会被简化。
- 依赖地图由模型一次生成，长文档可能只覆盖主干。
- 移动端为基础响应式，最佳体验在 ≥ 1040px 宽度。

## License

MIT
