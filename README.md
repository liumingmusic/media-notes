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

- `transformers`：浏览器内运行 Whisper（语音识别）与可选的小模型总结（Qwen2.5-0.5B）。
- `idb`：IndexedDB 封装，用于本地持久化。

## 关于"语音转文字"的实现说明

Web Speech API 只能捕获麦克风输入，无法直接转写上传的文件。因此本项目对**上传文件**采用浏览器本地 Whisper 模型（`Xenova/whisper-base`）进行识别——同样纯前端、文件不出本机，且无需任何 API Key。

- 首次识别会下载语音模型（约 70MB），之后走浏览器缓存。
- 若设备算力有限，识别速度会偏慢，属于本地推理的正常代价。
- 实时麦克风场景仍可用 Web Speech API（本项目预留 `transcribeFromMic`，可按需在界面加入）。

## 本地运行

```bash
npm install
npm run dev      # 启动开发服务器
npm run build    # 类型检查 + 生产构建，输出到 dist/
npm run preview  # 本地预览构建产物
```

> 注意：浏览器要求麦克风 / 媒体相关能力在 `https` 或 `localhost` 下可用。GitHub Pages 为 https，本地 `npm run dev` 默认即为 localhost，均满足。

## 部署到 GitHub Pages

仓库已包含 `.github/workflows/deploy.yml`，使用官方 Pages Action：

1. 将代码推送到仓库的 `main` 分支（或在 Actions 页手动 `Run workflow`）。
2. 在仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. 工作流会自动构建并把 `dist/` 发布为站点，地址为 `https://<用户名>.github.io/<仓库名>/`。

## 已知限制

- 视频关键帧基于帧差（像素变化）启发式检测，对「硬切幻灯片」效果最好；对淡入淡出或相似画面可能漏检。
- 本地 AI 深度总结首次需下载模型（数百 MB），建议在网络与设备条件允许时使用；内置的抽取式摘要无需下载、即时可用。
- 大体积音视频会占用较多内存，建议在桌面端 Chrome / Edge 使用。
