/* ==========================================================================
   Qelemchi · starter projects
   The demo is intentionally a real multi-file LaTeX project: equations,
   a generated figure, a table, citations, cross references and a theorem.
   ========================================================================== */

const DEMO_IMAGE_BASE64 = '__DEMO_IMAGE_BASE64__';

const DEMO_MAIN = String.raw`\documentclass[11pt,a4paper]{ctexart}

\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{amsthm}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{xcolor}

\newcommand{\keywords}[1]{\par\noindent\textbf{关键词：}#1}

\title{边注与提交：\\[0.2em]一种 GitHub 原生的学术写作工作流}
\author{林知远 \and 周澄}
\date{2026 年 10 月}

\newcommand{\R}{\mathbb{R}}
\newcommand{\E}{\mathbb{E}}
\newcommand{\abs}[1]{\left|#1\right|}
\newcommand{\norm}[1]{\left\lVert #1\right\rVert}

\newtheorem{theorem}{定理}[section]
\newtheorem{lemma}[theorem]{引理}
\newtheorem{definition}[theorem]{定义}

\begin{document}

\maketitle

\begin{abstract}
论文写作工具的存储层应当和论文本身一样长寿。本文提出一种以 Git 仓库为唯一数据源的协作写作工作流：编辑器在浏览器中运行，源码、图片与参考文献直接写入作者自己的 GitHub 仓库，每次保存对应一次原子提交。我们用一个无后端的单页应用实现该工作流，并讨论其在版本追踪、离线草稿与真实 PDF 编译方面的取舍。示例与模板表明，该方法可以在不牺牲可迁移性的前提下，将部署成本降到接近零。
\keywords{GitHub, LaTeX, 协作写作, 版本控制, 即时预览}
\end{abstract}

\tableofcontents

\input{sections/intro}
\input{sections/method}
\input{sections/results}
\input{sections/conclusion}

\bibliographystyle{plain}
\bibliography{refs}

\end{document}
`;

const DEMO_INTRO = String.raw`\section{引言}\label{sec:intro}

学术写作工具长期在“便利”与“可迁移”之间摇摆。云端编辑器提供了实时协作与即时预览，却把论文锁进私有文档格式；本地 \LaTeX{} 工具链保留了完整的控制权，却需要作者自己维护编译环境与版本管理。对于一篇需要反复修改数月的论文，这种割裂会逐渐累积成真实的成本：合作者不知道该以哪一版为准，审稿意见散落在邮件里，图表与源码的对应关系只能靠记忆维持。

Git 已经解决了其中大部分问题。提交是不可变的版本，分支可以承载并行实验，差异视图精确到字符，仓库可以在任何一台机器上完整克隆。问题在于，Git 的界面从来不是为写作设计的。作者需要的是“保存—预览—继续写”的循环，而不是“暂存—提交—推送”的心智负担。\LaTeX{} 本身则提供了一个足够稳定的排版层\cite{knuth1984,lamport1994}。

本文的工作可以概括为一个简单的判断：\textbf{把 Git 藏在写作界面后面，而不是把写作界面塞进 Git 里}。我们实现了一个单 HTML 文件的编辑器，它直接调用 GitHub REST API，把一次保存展开为 Git Data API 上的 blob、tree、commit 与 ref 更新。论文内容不经过任何中间服务器，令牌只留在作者本机，仓库则保持为普通的 \LaTeX{} 项目。

\subsection{贡献}

本文的贡献主要有三点：
\begin{itemize}
  \item 提出一种无后端的论文存储模型：一个仓库对应一篇论文，一次保存对应一次提交，所有中间状态都可以用标准 Git 工具恢复。
  \item 设计并实现一个浏览器内的 \LaTeX{} 子集排版器，覆盖公式、图、表、定理、交叉引用与参考文献等学术写作的高频结构。
  \item 将真实 PDF 编译交给 GitHub Actions，使作者在没有本地 \TeX{} Live 的机器上也能得到可提交的成品，同时保留完整的构建日志。
\end{itemize}

如第~\ref{sec:method}~节所述，整个系统没有数据库，也没有需要运维的服务器。唯一的持久化状态是作者的仓库，以及浏览器中可选的加密令牌。
`;

const DEMO_METHOD = String.raw`\section{方法}\label{sec:method}

\subsection{系统结构}

系统由三个彼此独立的层组成：编辑器、GitHub API 与编译工作流。编辑器是一个静态 HTML 文件，打开后从仓库读取源码，在内存中维护文件树与草稿；保存时，它把发生变化的文件编码为 blob，基于当前 commit 的 tree 构造新 tree，再创建 commit 并推进分支引用。整个写入过程是原子的：要么所有文件一起进入历史，要么全部不生效。

\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.92\linewidth]{figures/architecture.png}
  \caption{端到端的写入与编译路径。浏览器只与 api.github.com 通信，最终 PDF 由仓库中的 Actions 工作流生成。}
  \label{fig:architecture}
\end{figure}

图~\ref{fig:architecture} 展示了这条路径。与常见的“前端 + 后端 + 数据库”结构相比，这里少了两个需要维护的组件，也多了一个明确的所有权边界：仓库属于作者，令牌属于作者，构建日志也属于作者。

\subsection{原子提交}

设当前分支指向提交 $c_0$，其树为 $T_0$。一次保存包含文件集合 $F$，每个文件 $f \in F$ 被写入为 blob $b_f$。我们构造新树
\begin{equation}\label{eq:tree}
  T_1 = T_0 \oplus \{(f, b_f) : f \in F\},
\end{equation}
其中 $\oplus$ 表示在保留未修改文件的前提下覆盖同名条目。随后创建以 $c_0$ 为父提交、以 $T_1$ 为树的新提交 $c_1$，并用非强制方式把分支从 $c_0$ 推进到 $c_1$。如果在此期间远程分支已经被其他协作者推进，GitHub 会拒绝这次 ref 更新，编辑器随即提示作者先刷新，而不是静默覆盖。

这种乐观并发控制比锁简单得多，也更符合写作的节奏。作者不需要在开始写作前“签到”，只在提交的瞬间检查一次冲突。对于单人或小团队论文，冲突概率很低；即使发生，Git 的差异视图也足以解决问题。

\subsection{即时排版}

真实 \LaTeX{} 编译需要完整的 \TeX{} Live，启动成本以秒计，不适合每次击键都运行。因此编辑器内置一个保守的 \LaTeX{} 子集渲染器：它解析导言区、宏定义、章节、公式、浮动体、列表、定理与参考文献，生成接近论文版式的 HTML，再由 MathJax 负责公式。它不是 \TeX{} 的替代品，而是一个足够快的近似：作者在写作时看到结构，在需要最终稿时再交给 Actions。

排版器遇到无法可靠解释的命令时不会静默丢弃，而是在预览下方列出提示。这一设计把“预览不完整”变成可见的状态，避免作者误以为最终 PDF 一定与预览完全一致。
`;

const DEMO_RESULTS = String.raw`\section{实验结果}\label{sec:results}

我们在一个包含 18 个源文件、约 1.2 万行 \LaTeX{} 的论文项目上进行了测试。项目包含 23 幅图、11 张表与 86 条参考文献。表~\ref{tab:latency} 比较了三种常见工作流的保存延迟。这里的延迟指从点击保存到新版本可被其他协作者读取的时间，不包含网络往返之外的编辑时间。

\begin{table}[htbp]
  \centering
  \caption{不同写作后端的保存延迟与可迁移性对比。}
  \label{tab:latency}
  \begin{tabular}{lccc}
    \toprule
    方案 & 保存延迟 & 版本粒度 & 可迁移性 \\
    \midrule
    传统云端文档 & 180--420 ms & 自动快照 & 低 \\
    自建 Overleaf & 90--260 ms & 项目版本 & 中 \\
    GitHub 原生（本文） & 35--120 ms & 每次提交 & 高 \\
    \bottomrule
  \end{tabular}
\end{table}

GitHub 原生方案的延迟主要来自三次串行 API 调用：创建 blob、创建 tree/commit、更新 ref。由于 blob 可以并行上传，文件数量对延迟的影响小于预期。更重要的是，保存之后的版本不是一个只有专用工具才能读取的快照，而是一个包含完整源码与图片的 Git 提交。

\begin{theorem}[提交一致性]\label{thm:consistency}
若一次保存包含的文件集合为 $F$，且分支引用更新成功，则对于任意 $f \in F$，新提交中的 $f$ 与编辑器提交的内容一致；对于任意 $g \notin F$，新提交中的 $g$ 与父提交中的 $g$ 一致。
\end{theorem}

\begin{proof}
由 Git 树对象的构造方式，未被覆盖的路径继承自 \texttt{base\_tree}，被覆盖的路径指向新创建的 blob。分支引用更新是原子操作，因此读者要么看到旧提交，要么看到新提交，不会看到部分写入的中间状态。
\end{proof}

\subsection{讨论}

这一方案并非没有代价。GitHub API 有速率限制，仓库过大时克隆与读取也会变慢；浏览器端的排版器只能覆盖 \LaTeX{} 的一个子集；Actions 的排队时间可能从几十秒到几分钟不等。但对于以论文为单位的写作场景，这些代价换来的可迁移性与版本透明度是值得的。

另一个容易被忽略的好处是审稿与归档。论文被接收后，作者可以把仓库直接归档到 Zenodo 或 Software Heritage；合作者可以用任何 Git 客户端继续修改；期刊要求提交源码时，也不需要从某个云端服务导出。
`;

const DEMO_CONCLUSION = String.raw`\section{结论}\label{sec:conclusion}

本文把论文写作工具的存储层退回到最朴素的形态：一个 Git 仓库。编辑器、预览与编译都可以替换，仓库本身则保持可读、可克隆、可归档。实现表明，这条路径不需要后端，也不需要牺牲日常写作的流畅度。

未来的工作包括：更完整的 \LaTeX{} 语义支持、基于提交的评论与审阅流程，以及把编译产物与源码之间的对应关系可视化。我们希望这套工作流能提醒工具设计者：\emph{长寿的写作工具，应该把数据放在作者能够带走的地方}。

\section*{致谢}

感谢参与早期讨论的同事，以及所有把论文放在公开仓库中的研究者。本文的示例项目与模板均可在 Qelemchi 中直接打开。
`;

const DEMO_BIB = String.raw`@article{knuth1984,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111},
  doi     = {10.1093/comjnl/27.2.97}
}

@book{lamport1994,
  author    = {Lamport, Leslie},
  title     = {LaTeX: A Document Preparation System},
  publisher = {Addison-Wesley},
  address   = {Reading, MA},
  year      = {1994},
  edition   = {2}
}

@inproceedings{clark2020,
  author    = {Clark, David and Chen, Mira},
  title     = {Version Control for Research Artifacts},
  booktitle = {Proceedings of the Conference on Reproducible Research},
  pages     = {44--57},
  year      = {2020},
  publisher = {ACM}
}

@misc{github2026,
  author = {{GitHub}},
  title  = {Git Data API Reference},
  year   = {2026},
  url    = {https://docs.github.com/en/rest/git}
}
`;

const DEMO_README = String.raw`# 边注与提交

这是 Qelemchi 的中文示例论文，用来演示多文件项目、公式、图、表、定理、交叉引用和 BibTeX。

## 结构

- \`main.tex\` — 主文件
- \`sections/\` — 各章节
- \`figures/architecture.png\` — 示例图
- \`refs.bib\` — 参考文献

## 在 Qelemchi 中

直接打开示例即可编辑。连接 GitHub 仓库后，每次提交都会成为一次真实的 Git commit；点击“编译 PDF”会触发仓库中的 Actions 工作流，并把 \`build/main.pdf\` 提交回仓库。

> 示例文字是模板，不是真实论文。把标题、作者和摘要换成你的即可。
`;

const DEMO_FILES = [
  { path: 'main.tex', text: DEMO_MAIN },
  { path: 'sections/intro.tex', text: DEMO_INTRO },
  { path: 'sections/method.tex', text: DEMO_METHOD },
  { path: 'sections/results.tex', text: DEMO_RESULTS },
  { path: 'sections/conclusion.tex', text: DEMO_CONCLUSION },
  { path: 'refs.bib', text: DEMO_BIB },
  { path: 'README.md', text: DEMO_README },
  { path: 'figures/architecture.png', base64: DEMO_IMAGE_BASE64, mime: 'image/png' }
];

const BLANK_MAIN = String.raw`\documentclass[11pt,a4paper]{article}

\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}

\title{Untitled Paper}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
Write your abstract here. Keep it short, concrete and free of citations if possible.
\end{abstract}

\section{Introduction}
Start writing here.

\section{Method}
Describe your method.

\section{Results}
Present your results.

\section{Conclusion}
Summarize what you have learned.

\bibliographystyle{plain}
\bibliography{refs}

\end{document}
`;

const BLANK_BIB = String.raw`@article{example2026,
  author  = {Doe, Jane},
  title   = {An Example Reference},
  journal = {Journal of Examples},
  year    = {2026},
  volume  = {1},
  number  = {1},
  pages   = {1--10}
}
`;

const CONFERENCE_MAIN = String.raw`\documentclass[10pt,twocolumn]{article}

\usepackage[margin=1.9cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}

\title{A Compact Conference Paper Template}
\author{First Author \\ Affiliation \and Second Author \\ Affiliation}
\date{}

\begin{document}

\maketitle

\begin{abstract}
This is a compact conference-style template. The browser preview is single-column, while the final PDF is produced by the two-column article class. Use the GitHub Actions build for the exact layout.
\end{abstract}

\section{Introduction}
Introduce the problem and your contribution.

\section{Related Work}
Position your work against prior research.

\section{Method}
Present the technical approach.

\section{Experiments}
Report the setup and results.

\section{Conclusion}
Close with limitations and future work.

\bibliographystyle{plain}
\bibliography{refs}

\end{document}
`;

const TEMPLATES = {
  demo: { id: 'demo', name: '中文论文示例', description: '多文件、公式、图、表、定理与 BibTeX', files: DEMO_FILES, mainPath: 'main.tex' },
  blank: { id: 'blank', name: '空白论文', description: '最小 article 项目，适合从零开始', mainPath: 'main.tex', files: [
    { path: 'main.tex', text: BLANK_MAIN },
    { path: 'refs.bib', text: BLANK_BIB },
    { path: 'README.md', text: '# My Paper\n\nA clean LaTeX project managed by Qelemchi.\n' }
  ] },
  conference: { id: 'conference', name: '会议论文模板', description: '双栏 article 结构，最终 PDF 由 Actions 生成', mainPath: 'main.tex', files: [
    { path: 'main.tex', text: CONFERENCE_MAIN },
    { path: 'refs.bib', text: BLANK_BIB },
    { path: 'README.md', text: '# Conference Paper\n\nEdit `main.tex`, then compile with GitHub Actions.\n' }
  ] }
};

function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.demo;
}

function demoProjectFiles() {
  return DEMO_FILES.map((f) => Object.assign({}, f));
}

function templateFilesFor(id) {
  const template = getTemplate(id);
  return template.files.map((f) => Object.assign({}, f));
}

function templateMeta(id) {
  const template = getTemplate(id);
  return { id: template.id, name: template.name, description: template.description, mainPath: template.mainPath };
}
