# 伴读 Margin

> 不替你读，帮你读懂。

一个跑在浏览器里的**学习型文档阅读器**。它不把文档压成摘要，而是尽量保留「读懂它需要的那条顺序」：先给你脉络，再在你卡住的那句话旁边解释它在论证里干什么；你随手写在页边的想法，AI 会追问依据、指出跳步——但不会替你写。

数据全部留在本地（IndexedDB），没有账号、没有后端、没有埋点。模型用你自己的 Key。

![状态：可用](https://img.shields.io/badge/status-usable-2f6f4e)

---

## 它想解决什么

把文档丢给 agent 让它总结，会**滤掉学习真正需要的顺序信息**：哪个结论依赖哪个前提、你读到第 3 段时该先补哪个概念、你在哪里卡住了。剩下的"精炼节点"看起来高效，但人无法从零搭起来。

所以这个阅读器只做三件事：

1. **不剧透** —— AI 只能看到你已经读到的部分（数据层截断，不靠提示词）。
2. **不替代** —— 不自动总结、不自动高亮、不代写批注；先问你怎么理解，再补你没说到的。
3. **不锁定** —— 模型可换（DeepSeek / 通义 / Kimi / 智谱 / OpenAI / OpenRouter / Ollama / 任何 OpenAI 兼容端点），数据可整体导出。

## 现在能做什么

| 能力 | 说明 |
| --- | --- |
| 导入文档 | PDF、Word(.docx)、Markdown、纯文本，全部在浏览器本地解析，不上传 |
| 书架与进度 | 记录每篇读到哪一段，下次接着读 |
| 脉络大纲 | 文档结构提取到左侧栏，点击跳转 |
| 划词解释 | 选中任意一句 →「解释」：先讲**它在做什么**，再给**最小定义**，最后告诉你**要不要深究**；必须引用原文，不编页码 |
| 页边批注 | 想到哪记到哪，批注贴在对应段落的页边，像真书页边一样错落下推 |
| AI 点评 | 对一条批注：追问依据 / 给我反例 / 我哪里跳步了；两种姿态可切换（追问式默认 / 纠错式） |
| 提问 | 划词后就这段提问，回答始终围绕你划的那句话 |
| 联网查证 | 选中一句话点「查证」：先搜索，再打开前几条结果的正文，只依据这些资料判断「支持 / 部分支持 / 与资料矛盾 / 资料不足」，每条依据都标编号与出处；没配检索服务时会明确写「未联网，仅凭记忆」 |
| 卡点日志 | 标记「没懂」，汇总到侧栏，读懂后勾掉 |
| 依赖地图 | 让 AI 抽取论点/前提/定义与「读懂 B 先懂 A」的边，可生成阅读路线（按依赖排序，而不是按目录顺序） |
| 防剧透 | 阅读前沿之前的上下文才进模型；后面的内容它看不到 |
| 多模型 | 解释 / 提问 / 点评 / 地图 四个任务可分别指定 provider 与 model |
| 本地转发 | 一键把请求经本地 Node 转发，绕开浏览器 CORS（API Key 仍只存在你自己的浏览器里） |
| 主题与字号 | 纸感 / 素白 / 夜读 三套主题，字号 15–24 |
| 备份 | 全量导出 JSON、导出 Markdown 读书笔记、导入恢复 |

## 快速开始

需要 Node 20+（本项目在 Node 24 上开发）。**所有命令都在 `margin/` 目录下执行。**

```bash
pnpm install

# 开发（默认 http://localhost:5188）
pnpm dev

# 生产构建
pnpm build

# 构建产物 + 本地转发服务（默认 http://127.0.0.1:8787）
pnpm serve
```

构建产物在 `dist/`，可以直接扔到任何静态托管（GitHub Pages / Vercel / Netlify / 自己的 nginx）。如果只想自己或朋友用，`pnpm serve` 一条命令就够：它同时提供静态文件和 `/api/proxy` 转发。

> 如果 `pnpm install` 最后报了 `ERR_PNPM_IGNORED_BUILDS: esbuild`，可以忽略：本项目用 rolldown 版的 Vite，构建不依赖 esbuild 的二进制。想让它闭嘴就执行一次 `pnpm approve-builds` 并把 esbuild 勾上。

### 配置模型

打开右上角「模型与数据」：

1. 选一家厂商（内置 DeepSeek / 通义千问 / Kimi / 智谱 GLM / OpenAI / OpenRouter / Ollama），填 API Key；
2. 建议勾上「经本地转发」，请求会走 `/api/proxy`，避免 CORS 报错；
3. 在「解释 / 提问 / 点评 / 地图」四行里分别选厂商和模型；
4. 「测试连接」确认可用。

Ollama 等本地模型把 BaseURL 指向 `http://127.0.0.1:11434/v1` 即可，不需要 Key。

> **没有 API Key 也想先看看界面？** 另开一个终端跑 `pnpm mock`（一个假的 OpenAI 兼容服务，端口 8788），然后在设置里添加厂商：BaseURL 填 `http://127.0.0.1:8788/v1`、Key 随便填、**关掉**「经本地转发」，模型名填 `mock`。这样划词解释、点评、依赖地图都有固定假回复，可以先把交互走一遍。

> 部署到纯静态托管且没有 Node 转发时，把「经本地转发」关掉——前提是该厂商允许浏览器直连（DeepSeek、OpenAI 等多数厂商**默认不允许**跨域，所以公开部署时请保留 `/api/proxy`，见下一节）。

### 配置联网查证（可选）

「查证」需要一个检索服务的 Key（和模型 Key 分开）：

1. 打开「设置 → 联网」，选一个服务：Tavily（推荐，专为模型设计）、Brave Search、Serper，或自建的 SearXNG；
2. 填 Key（SearXNG 填实例地址，例如 `https://searx.be`，免费不限量）；
3. 点「测试检索」，能返回结果就行。

检索接口几乎都不允许浏览器直连，所以默认走 `/api/proxy`。查证时你选中的句子会发给检索服务——介意就自建 SearXNG。

## 公开给朋友用（Cloudflare Pages）

这是一个纯静态站点，最省事的公开方式是 Cloudflare Pages（免费额度足够小范围使用）：

1. 把 `margin/` 推到 GitHub；
2. Cloudflare Dashboard → Pages → 连接仓库；
3. 构建命令 `pnpm build`，输出目录 `dist`（Node 版本选 20+）；
4. 仓库里的 `functions/api/proxy.js` 会被自动识别成 Pages Function，`/api/proxy` 直接可用；
5. 打开 `https://<项目>.pages.dev`，朋友在你给的网址里填**他们自己的** Key。

**Key 会不会被别人用掉？** 不会。Key 存在每个访客自己的浏览器 IndexedDB 里，跟着设备走，不上传、不进仓库；`/api/proxy` 只是透传，服务端不保存任何 Key。所以别人打开你的网页，用的是他们自己的 Key。

**如果想让朋友不用配 Key、直接用你的额度**：那需要把 Key 放到服务端。`deploy/cloudflare-worker-key.js` 是一个最小示例（Worker + 环境变量 + 来源白名单 + 每日限额）。这等于把自己的额度公开出去，成本和滥用风险都要自己承担，建议只在小群、加限额后使用。

**不想用 Cloudflare？** 任何能跑 Node 的地方都可以：静态文件 + `pnpm serve`（自带 `/api/proxy`），或 Vercel/Netlify 的静态托管 + 一个等价的转发函数。

## 数据与隐私

- 文档正文、批注、卡点、对话、设置全部存在浏览器 **IndexedDB**（库名 `margin-reader`）。
- 只有你主动划词/批注/生成地图时，才会把**当前段落前后已读的部分**发给模型。
- 「查证」会把选中的那句摘要发给检索服务，并从搜索结果里打开前 3 个网页的正文（经 `/api/proxy` 转发）；抓到的正文只用于这一次核查，不落库。
- 没有任何遥测。换浏览器/清站点数据会丢，所以请定期用「导出 JSON」备份；`导出 Markdown` 得到的是一份可以直接读的读书笔记。

## 目录结构

```
margin/
├─ src/
│  ├─ components/   阅读器、书架、页边批注、划词条、动作浮窗、设置
│  ├─ ingest/       PDF / DOCX / MD / TXT → 统一块模型（含大纲）
│  ├─ ai/           provider 预设、OpenAI 兼容流式客户端、提示词、任务封装
│  ├─ lib/          锚点与高亮、Markdown 渲染、备份导出
│  ├─ store.ts      zustand 应用状态 + Dexie 持久化
│  └─ styles.css    三套主题（CSS 变量）+ 全部版面
├─ server/
│  ├─ proxy.mjs     零依赖 SSE 透传
│  └─ serve.mjs     零依赖静态托管 + /api/proxy
├─ functions/api/proxy.js   Cloudflare Pages 版转发（同语义）
├─ deploy/          「借出自己 Key」的 Worker 示例
├─ scripts/         mock 模型服务、构建产物自检
└─ dist/            构建产物
```

**数据模型四层**：原文层（`blocks`，块 id = `docId:序号`）→ 结构层（`outline` / `map`，可重算、人可改）→ 个人层（`anchors` / `notes` / `stucks`，永不自动改写）→ 对话层（`dock`）。锚点用「块 id + 原文引文 + 前后文」定位，正文重解析后仍能尽量找回；找不回的进「孤儿」区，不丢。

## 技术栈

TypeScript（strict）· React 19 · Vite（rolldown）· zustand · Dexie(IndexedDB) · pdf.js · mammoth · markdown-it + DOMPurify · CSS Custom Highlight API · Tavily/Brave/Serper/SearXNG 检索。零运行时后端依赖，`server/` 与 Cloudflare Function 都只用标准 `fetch`。

## 自检

```bash
pnpm build    # 类型检查 + 生产构建
pnpm smoke    # 用 happy-dom 挂载构建产物：书架渲染 → 载入示例 → 正文/大纲/侧栏 → 设置页
```

`pnpm smoke` 不启动浏览器，适合在没有图形环境（CI、服务器）里确认打包后的产物真的能跑起来。

## 已知限制

- PDF 的**扫描件**没有文本层，暂时读不了（需要 OCR，未做）。
- PDF 按文本行重建段落，复杂分栏或表格可能串行；Word 的复杂版式会被简化。
- 依赖地图由模型一次性生成，长文档可能只覆盖主干；可在侧栏手动调整（后续版本）。
- 移动端只做了基础响应式，最佳体验在 ≥ 1040px 宽度。

## 路线

- [ ] 扫描件 OCR、PDF 分栏检测
- [ ] 依赖地图可手动增删边，并把「卡点」自动插成补丁节
- [ ] 节末 3 问 / 复述自测（先让读者说，再补差）
- [ ] 批注线程：对同一条批注继续追问，形成对话
- [ ] 多篇文档之间的概念互链（跨文档的前置知识）
- [ ] 可选：把笔记同步到本地文件夹（File System Access API）

## License

MIT
