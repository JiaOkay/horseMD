// First-run onboarding document, shown as the first tab after install.
// Localized; introduces what HorseMD is, its features, and how to use it.

const EN = `# Welcome to HorseMD 🐎

**HorseMD** is a warm, modern **Markdown editor** — a Typora alternative built
around one idea: *every file opens as a tab in the same window*, not a new app
instance. Browse a whole folder in the sidebar, flip between files in tabs, and
write in a clean WYSIWYG editor.

> This page is just here to say hello. Edit it, or close the tab — you won't see
> it again on the next launch.

## A quick tour

Here's a taste of what renders live as you type.

**Highlights** — wrap text in \`==\` to mark it: this is ==important== and
==worth a second look==. Select any text and hit the highlighter button in the
toolbar to pick **yellow / red / blue**.

**Code blocks** get real syntax highlighting:

\`\`\`python
def fibonacci(n):
    seq = [0, 1]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq[:n]

print(fibonacci(10))
\`\`\`

**Mermaid diagrams** render right under the source — click *Edit code* to tweak,
*Hide code* to view only the picture:

\`\`\`mermaid
flowchart LR
    A[Idea] --> B[Draft]
    B --> C{Good?}
    C -- yes --> D[Publish]
    C -- no --> B
\`\`\`

**Math** via LaTeX: the famous $E = mc^2$, or a display block:

$$\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

**Review marks** — annotate a draft while keeping the original text. They render
live (below) and stay readable right in the Markdown source. Select text and use
the review commands in the command palette (\`Ctrl+P\`) to insert them; accept or
reject all from there too.

- Addition: {++new text++}
- Deletion: {--cut this--}
- Substitution: {~~old word~>new word~~}
- Highlight + comment: {==key point==}{>>a reviewer note<<}

| Feature | Try it |
| --- | --- |
| Tables | edit any cell |
| Task lists | - [ ] click me |
| Quotes | like this one |

## What you can do

- **WYSIWYG live preview** — type Markdown, see it render in place
- **Tabs** — many files in one window (\`Ctrl+Tab\` to cycle)
- **Folder workspace** — a file tree on the left; create, rename, delete in place
- **Command palette** (\`Ctrl+P\`) — fuzzy-jump to any file or command
- **Outline panel** — click a heading to jump; it follows your cursor live
- **Layout** — adjust font size, line height, paragraph spacing, and page width
  from the *Layout* button in the status bar
- **Themes** — Warm Light/Dark plus three **Morandi** palettes
- **Languages** — switch between English and 中文 anytime (bottom-right)

## Editing essentials

- Slash command menu (\`/\`) for inserting blocks
- Select text → formatting toolbar; the **H** button turns a block into H1…H6
- Or keyboard: \`Ctrl+1\`…\`Ctrl+6\` headings, \`Ctrl+0\` text
- **Ctrl/Cmd + Click** a link to open it in your browser
- Relative-path images (\`./img/pic.png\`) just work; pasted screenshots are
  saved next to the file
- Paste a whole Markdown document — headings, tables, code, diagrams all carry
  over

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New file | \`Ctrl+N\` |
| Open file / folder | \`Ctrl+O\` / \`Ctrl+Shift+O\` |
| Save / Save As | \`Ctrl+S\` / \`Ctrl+Shift+S\` |
| Command palette | \`Ctrl+P\` |
| Find in file | \`Ctrl+F\` |
| Toggle sidebar / outline | \`Ctrl+B\` / \`Ctrl+Shift+L\` |
| Toggle source mode | \`Ctrl+/\` |
| Cycle theme | \`Ctrl+Shift+T\` |

Happy writing! ✨
`

const ZH = `# 欢迎使用 HorseMD 🐎

**HorseMD** 是一款温暖、现代的 **Markdown 编辑器** —— Typora 的替代品。核心理念
只有一个：*每个文件都在同一个窗口里作为标签页打开*，而不是新开一个程序。在侧边栏
浏览整个文件夹，用标签页切换文件，在干净的所见即所得编辑器里写作。

> 这一页只是用来打个招呼。你可以编辑它，或者直接关掉这个标签 —— 下次启动不会再出现。

## 快速一览

下面这些都是边写边渲染出来的效果。

**高亮** —— 用 \`==\` 包住文字即可：这是==重点内容==，==值得再看一眼==。
选中任意文字，点工具栏上的高亮笔按钮，还能选 **黄 / 红 / 蓝** 三种颜色。

**代码块** 自带语法高亮：

\`\`\`python
def fibonacci(n):
    seq = [0, 1]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq[:n]

print(fibonacci(10))
\`\`\`

**Mermaid 图表** 在源码下方实时渲染 —— 点「编辑代码」可改，点「隐藏代码」只看图：

\`\`\`mermaid
flowchart LR
    A[想法] --> B[草稿]
    B --> C{满意?}
    C -- 是 --> D[发布]
    C -- 否 --> B
\`\`\`

**数学公式** 用 LaTeX 写：质能方程 $E = mc^2$，或者块级公式：

$$\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

**审阅标记** —— 在草稿上批注而不丢失原文。它们会实时渲染（见下），并且始终以源码可读的形式留在 Markdown 里。选中文字后用命令面板（\`Ctrl+P\`）里的审阅命令插入，也能在里面一键全部接受 / 拒绝。

- 新增：{++新增的文字++}
- 删除：{--要删掉的文字--}
- 替换：{~~旧词~>新词~~}
- 高亮 + 评论：{==关键这句==}{>>一句批注<<}

| 功能 | 试试看 |
| --- | --- |
| 表格 | 双击任意单元格编辑 |
| 任务清单 | - [ ] 点我 |
| 引用 | 就像这一段 |

## 你能做什么

- **所见即所得实时预览** —— 输入 Markdown，原地渲染
- **标签页** —— 多个文件在一个窗口里打开（\`Ctrl+Tab\` 循环切换）
- **文件夹工作区** —— 左侧文件树，可原地新建 / 重命名 / 删除
- **命令面板**（\`Ctrl+P\`）—— 模糊跳转到任意文件或命令
- **大纲面板** —— 点击标题跳转，并随光标实时高亮当前位置
- **排版** —— 状态栏「排版」按钮可调字号、行间距、段落间距、页宽
- **多套主题** —— 暖光 / 暖夜，外加三套**莫兰迪**配色
- **多语言** —— 随时在英文和中文之间切换（右下角）

## 编辑要点

- 行首输入斜杠 \`/\` 调出块菜单插入各种内容
- 选中文字会弹出格式工具条；其中 **H** 按钮能把当前段落变成 H1…H6
- 也可以用键盘：\`Ctrl+1\`…\`Ctrl+6\` 设标题，\`Ctrl+0\` 转正文
- 按住 **Ctrl/Cmd 点击**链接，用系统浏览器打开
- 相对路径图片（\`./img/pic.png\`）开箱即用；**粘贴的截图**会自动存到文件同目录
- **粘贴整篇 Markdown** —— 标题、表格、代码、图表都会正确识别并渲染

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建文件 | \`Ctrl+N\` |
| 打开文件 / 文件夹 | \`Ctrl+O\` / \`Ctrl+Shift+O\` |
| 保存 / 另存为 | \`Ctrl+S\` / \`Ctrl+Shift+S\` |
| 命令面板 | \`Ctrl+P\` |
| 文件内查找 | \`Ctrl+F\` |
| 切换侧边栏 / 大纲 | \`Ctrl+B\` / \`Ctrl+Shift+L\` |
| 切换源码模式 | \`Ctrl+/\` |
| 切换主题 | \`Ctrl+Shift+T\` |

祝写作愉快！✨
`

export function welcomeDoc(lang) {
  return {
    title: lang === 'zh' ? '欢迎使用 HorseMD.md' : 'Welcome to HorseMD.md',
    content: lang === 'zh' ? ZH : EN
  }
}
