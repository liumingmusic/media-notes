# 音视频笔记（media-notes）

纯前端、本地运行的音视频内容提取与笔记整理工具。所有处理都在浏览器内完成，文件不会上传到任何服务器。

## 功能

- **音频**：本地语音识别（Whisper WASM 模型）转文字，并对文字稿做总结。
- **视频**：在音频转写之外，额外提取画面中的关键帧（幻灯片 / 场景切换）并生成可点击跳转的时间轴。
- **笔记产出**：将「摘要 + 关键帧时间戳 + 文字稿」组装为 Markdown，支持复制到剪贴板或下载 `.md`。
- **本地存储**：转写稿、摘要、关键帧通过 IndexedDB 持久化，支持历史记录查看与删除。

## 技术栈

React 18 + TypeScript + Vite，部署到 GitHub Pages（相对路径 `base: './'`）。
核心依赖：

- `@huggingface/transformers`：浏览器内运行 Whisper（语音识别）。
- `idb`：IndexedDB 封装，用于本地持久化。

## 关于"语音转文字"的实现说明

Web Speech API 只能捕获麦克风输入，无法直接转写上传的文件。因此本项目对**上传文件**采用浏览器本地 Whisper 模型（`Xenova/whisper-base`）进行识别——同样纯前端、文件不出本机，且无需任何 API Key。

**模型与 WASM 全部同源打包进站点**：构建时由 `scripts/fetch-assets.mjs` 把 Whisper 模型（约 120MB）和 ONNX Runtime 的 WASM 下载 / 拷贝到 `public/`，随站点一起发布到 GitHub Pages。浏览器运行时**零外部网络请求**，因此不受 `huggingface.co` 被墙或镜像重定向的影响，在国内也能稳定加载。

- 首次打开会从本站（同源）下载模型（约 120MB），之后走浏览器缓存。
- 若设备算力有限，识别速度会偏慢，属于本地推理的正常代价。
- 实时麦克风场景仍可用 Web Speech API（本项目预留 `transcribeFromMic`，可按需在界面加入）。

## 本地运行

```bash
npm install
npm run fetch-assets   # 下载 Whisper 模型与 WASM 到 public/（仅需一次；CI 部署时自动执行）
npm run dev            # 启动开发服务器
npm run build          # 类型检查 + 生产构建，输出到 dist/
npm run preview        # 本地预览构建产物
```

> `public/models/` 与 `public/wasm/` 已在 `.gitignore` 中忽略，不进 git；它们由 `fetch-assets` 生成。

> 注意：浏览器要求麦克风 / 媒体相关能力在 `https` 或 `localhost` 下可用。GitHub Pages 为 https，本地 `npm run dev` 默认即为 localhost，均满足。

## 部署到 GitHub Pages

仓库已包含 `.github/workflows/deploy.yml`，使用官方 Pages Action：

1. 将代码推送到仓库的 `main` 分支（或在 Actions 页手动 `Run workflow`）。
2. 在仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. 工作流在构建前会先执行 `npm run fetch-assets`（从国内镜像 `hf-mirror.com` 下载模型、从 `node_modules` 拷贝 WASM），随后自动构建并把 `dist/` 发布为站点，地址为 `https://<用户名>.github.io/<仓库名>/`。

## 已知限制

- 视频关键帧基于帧差（像素变化）启发式检测，对「硬切幻灯片」效果最好；对淡入淡出或相似画面可能漏检。
- 总结目前采用**离线抽取式摘要**（基于词频 / 位置打分提取关键句），无需下载、即时可用；如需更强的 AI 总结，可后续接入自带 Key 的云端 LLM 或本地大模型。
- 大体积音视频会占用较多内存，建议在桌面端 Chrome / Edge 使用。
