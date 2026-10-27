# Qelemchi

Qelemchi（维吾尔语「执笔人」，词根 *qelem* + *-chi*）是一个单 HTML 文件的 LaTeX 论文写作工作台：像 Overleaf 一样在浏览器里编辑和编译，但以 GitHub 仓库作为唯一存储层，没有后端、没有中间服务器。

交付物是根目录的 `index.html`（约 5.5 MB）。`src/` 是可维护的拆分源码，`node build.mjs` 把它们拼回单文件。

## 功能

- **两种编辑模式**：LaTeX 源码（CodeMirror）与整篇稿纸式所见即所得（公式、图表、定理直接渲染，`\cite` 显示为数字）。
- **真实 PDF 预览**：预览区只显示编译后的 PDF，由 SwiftLaTeX 的 pdfTeX / XeTeX WebAssembly 引擎在本机编译，支持 BibTeX 与多遍编译。
- **会议模板**：CVPR 2026、NeurIPS 2025，以及中文示例论文。
- **GitHub 存储**：直接调用 GitHub Git Data API，一次保存展开为 blob → tree → commit → ref；论文不经过任何服务器。
- **可离线使用**：第一次编译后，TeX 引擎资源缓存在 IndexedDB，断网也能继续写和编译。

## 快速开始

直接双击打开 `index.html`，或起一个静态服务器：

```sh
python3 -m http.server 4173
# http://127.0.0.1:4173/index.html
```

选择「示例项目」即可试用；选择「连接 GitHub」后粘贴一个 fine-grained PAT，仓库只需要 **Contents: Read and write**（如需用 GitHub Actions 编译，再加 **Actions: Read and write**）。

### 令牌安全

- 令牌不会写入源码、URL 或 `localStorage`。
- 当前会话的令牌只放在 `sessionStorage`；可选的「记住此设备」用 AES-GCM 加密后存入 IndexedDB，密钥不可导出。
- 可再加一层 PBKDF2 口令（150,000 次迭代）。
- 页面 CSP 只允许 `https://api.github.com` 与已批准的 jsDelivr 静态资源域名；代理只用于资源下载。

## 浏览器编译与 CDN

`index.html` 只内嵌很小的资源清单（含每个文件的 SHA-256）。第一次编译时：

1. 按检测到的引擎下载所需的 3–4 个文件（约 15 MB）到本机；
2. 逐个校验大小与 SHA-256；
3. 以 base64 写入 IndexedDB（`texasset:<sha256>`）；
4. 之后的编译直接读缓存，不再联网。

资源来自本项目仓库 [elyar-adil/qelemchi](https://github.com/elyar-adil/qelemchi) 的 `assets/tex/` 目录（标签 `v1`），按顺序尝试三个 jsDelivr 端点：

```
https://fastly.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/
https://gcore.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/
https://testingcf.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/
```

源码与 PDF 不会上传；请求只发往上述静态资源域名。

## 构建与测试

```sh
node build.mjs                 # 生成 index.html 与 tex-assets/
node test-wysiwyg.mjs          # 所见即所得渲染
node test-wys-edit.mjs         # 编辑往返、回车分段、源码跳转
node test-local-compile.mjs    # 冷/热缓存编译（默认用本地资源）
QELEMCHI_TEST_URL=http://127.0.0.1:4173/index.html node test-local-compile.mjs  # 走真实 CDN
QELEMCHI_TEST_URL=http://127.0.0.1:4173/index.html QELEMCHI_FALLBACK=1 node test-local-compile.mjs  # 端点回退
```

测试需要 Playwright 与已安装的 Microsoft Edge：`chromium.launch({ channel: 'msedge' })`。

## 目录

```
src/template/      HTML 骨架与脚本占位符
src/styles/        样式（含所见即所得纸张样式）
src/js/tex/        TeXPreview：LaTeX 子集解析与结构模型
src/js/app/        编辑器、GitHub API、编译、PDF.js、设置等
src/templates/     CVPR / NeurIPS 模板
assets/tex/        SwiftLaTeX 引擎、LaTeX format、texmf 归档
assets/pdfjs/      PDF.js 3.11.174 与 CJK CMap
vendor/            CodeMirror 5、MathJax 3
tex-assets/        build.mjs 生成的本地校验包（含 manifest.json，不提交）

```

## 许可与归属

浏览器内 TeX 引擎来自 [SwiftLaTeX](https://github.com/SwiftLaTeX/SwiftLaTeX)，texmf 文件来自 TeX Live 2026（多数为 LPPL，Fandol 字体为 GUST Font License）。详见 `assets/tex/README.md`。

Qelemchi 是独立项目，与 Overleaf、SwiftLaTeX、CVPR 或 NeurIPS 没有隶属关系。
