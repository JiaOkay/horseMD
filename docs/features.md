# 功能与实现

下面按功能列出**怎么用**和**怎么实现的**（附对应文件）。

---

## 1. 标签页 / 单窗口多文件

- 打开多个 `.md` 在同一窗口，`Ctrl+Tab` / `Ctrl+Shift+Tab` 循环切换
- 在资源管理器双击 `.md` → 不新开程序，而是在已有窗口加一个标签

**实现**：
- 主进程 `requestSingleInstanceLock()` + `second-instance` 事件，把第二次启动的 argv 转发给已有窗口（`src/main/index.js`）
- 渲染层 `openPaths()` 用 `tabsRef` 同步快照去重，避免 setState 竞态导致重复标签（`App.jsx`）

## 2. 文件夹工作区（侧边栏文件树）

- `Ctrl+Shift+O` 打开文件夹，左侧树状浏览；右键可新建/重命名/删除/在资源管理器中显示
- 外部增删文件会自动刷新树

**实现**：`Sidebar.jsx` + 主进程 `fs:readDir` / `watch:start`（chokidar 监听文件夹，去抖后推 `watch:changed`）

## 3. 所见即所得编辑 + 块级控件

WYSIWYG 由 Milkdown Crepe 提供。在它之上自研了**改标题层级**的多种入口（共用一条 `setBlock` → `convertBlock` 路径）：

| 入口 | 用法 |
| --- | --- |
| 键盘 | `Ctrl+1`…`Ctrl+6` 设标题、`Ctrl+0` 转正文 |
| 选中工具条 | 选中文字 → Crepe 工具条里注入的 **H** 按钮，悬浮展开 H1/H2/H3/¶ |
| 右键菜单 | 编辑区右键 → "转换为" 列出全部类型 |
| 状态栏切换器 | 右下角常驻显示当前块类型，点开可切换 |
| Crepe 原生 | 行首 `/` 斜杠菜单、行首 `# `、左侧块手柄 |

**实现**（`Editor.jsx`）：
- `convertBlock(view, type, attrs)` → `view.dispatch(state.tr.setNodeMarkup(pos, targetType, attrs))`，作用于光标所在的 textblock
- 工具条按钮：用 `MutationObserver` 监听 `.milkdown-toolbar` 出现，注入自定义 `.hm-heading-item`，CSS `:hover` 展开子菜单（并覆盖 Crepe 工具条的 `overflow:hidden` 以免裁掉子菜单）
- 块类型定义集中在 `blocks.js`，标签文案走 i18n

## 4. 当前文件自动刷新（外部修改）

外部程序（如 agent、其它编辑器）改了正在打开的文件 → 编辑器自动重载，无需手动关开。

**实现**：
- 主进程对每个打开的文件单独 chokidar 监听（`watch:file`），`change` 时推 `file:changed {path, mtimeMs}`（`src/main/index.js`）
- 渲染层 `App.jsx` 为打开的文件挂/卸监听，收到变更后：
  - 若该标签**有未保存修改** → 不覆盖（保护你的编辑）
  - 否则从磁盘重载，并 bump `reloadNonce` 让 Editor 重挂载
  - 忽略自己保存产生的回声（比对 mtime）

## 5. Ctrl/Cmd + 点击链接

按住 `Ctrl`(Win)/`Cmd`(Mac) 点链接 → 系统浏览器打开。

**实现**：`Editor.jsx` 在 `view.dom` 捕获阶段拦截 `click`，命中 `http(s):`/`mailto:` 链接走 `shell.openExternal`。

## 6. 富文本复制（带 inline style）

复制内容时，剪贴板 HTML 版本注入内联样式，粘到微信公众号/邮件/Notion 等不读外部 CSS 的地方也能保留格式（加粗、标题大小、行内代码、代码块灰底、引用、表格边框等）。

**实现**：`Editor.jsx` 拦截 `copy` 事件，对选区 HTML 逐元素套用固定浅色配色的内联样式（`COPY_STYLES`），写入 `text/html`；CodeMirror 代码块内的复制交还给它自己处理。

## 7. 相对路径图片解析

`![](./img/foo.png)` 这类相对路径图片，按当前文件所在文件夹解析成 `file://` 绝对路径并正常显示。

**实现**：`Editor.jsx` 用 `MutationObserver` 把相对路径 `<img>` 的 `src` 改写成 `file://`。**只改 DOM 显示，不动文档模型** —— 保存时磁盘里仍是相对路径，不污染文件。

## 8. 大纲 / 命令面板 / 查找

- 大纲（`Ctrl+Shift+L`）：从内容解析标题，点击跳转，随编辑实时更新（`Outline.jsx`）
- 命令面板（`Ctrl+P`）：模糊搜索文件与命令（`CommandPalette.jsx`）
- 查找（`Ctrl+F`）：文档内查找（`App.jsx` findbar + `window.find`）

## 9. 主题（含莫兰迪）

6 套配色：暖光、暖夜、莫兰迪·灰绿 / 豆沙 / 雾蓝 / 暮。右下角状态栏带色块的主题选择器；`Ctrl+Shift+T` 循环切换。

**实现**：
- `themes.js` 注册表，每套主题 = 一个 `base`（light/dark，驱动 Crepe 明暗规则）+ 可选 `theme-*` 类（覆盖调色板变量）
- `applyTheme(id)` 设置 `body.className = base [+ ' theme-*']`
- 调色板变量在 `styles/app.css`（`body.light` / `body.dark` / `body.theme-morandi*`）

## 10. 多语言（中 / 英）

整个界面可在英文/中文间实时切换，默认跟随系统语言。状态栏有 🌐 切换。

**实现**：
- `i18n.jsx`：`STRINGS{en,zh}` 翻译表 + `I18nProvider` 上下文 + `useI18n()` 的 `t(key, vars)`
- 各组件用 `t('...')` 取文案；`App.jsx` 自身用 `translate(lang, key)`
- 编辑器占位符通过 Crepe `featureConfigs[Placeholder].text` 本地化

## 11. 首次引导

全新安装首次打开 → 自动弹出本地化的《欢迎使用 HorseMD》文档（介绍软件、功能、快捷键）。只出现一次。

**实现**：`App.jsx` 检测 `localStorage` 无 `horsemd.onboarded.v1` 且无恢复标签时，把 `onboarding.js` 的内容作为一个标签打开。

## 12. 首页（欢迎页）+ 最近文件

无打开文件时显示欢迎页：Logo + 标题 + 标语 + 三个操作按钮 + **最近文件列表** + 快捷键提示。

**实现**（`App.jsx` 的 `Welcome` 组件）：
- 最近文件：每次打开文件时 `remember()` 记录 `{path, name, dir, openedAt}`，去重、上限 8、持久化在会话
- 相对时间 `relTime()`：刚刚 / N 分钟前 / N 小时前 / 昨天 / 日期（本地化）
- 点击条目打开文件；**没有"清空"按钮**（产品决策）

## 13. 新文件首行自动一级标题

新建/空文档时，第一行自动作为一级标题（Typora 式标题）。

**实现**：`Editor.jsx` 在 create 后、设基线前，若文档是单个空段落则把首块转为 H1（放在基线前以免标签被误标"已修改"）。

## 14. 窗口拖拽

顶栏空白处（含标签条背景）和活动栏空白都能拖动窗口；标签、按钮、输入框可点。

**实现**：`styles/app.css` 用 `-webkit-app-region` —— `.topbar / .tabs / .tabs-scroll / .activity-bar` 设 `drag`，`.tab / .tab-new / .drag-no / input / .activity-item` 设 `no-drag`。

## 快捷键一览

| 操作 | 快捷键 |
| --- | --- |
| 新建 / 打开文件 / 打开文件夹 | `Ctrl+N` / `Ctrl+O` / `Ctrl+Shift+O` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 关闭标签 / 循环标签 | `Ctrl+W` / `Ctrl+Tab` |
| 命令面板 / 查找 | `Ctrl+P` / `Ctrl+F` |
| 侧边栏 / 大纲 | `Ctrl+B` / `Ctrl+Shift+L` |
| 源码模式 / 主题 | `Ctrl+/` / `Ctrl+Shift+T` |
| 标题层级 / 正文 | `Ctrl+1`…`6` / `Ctrl+0` |

> 注：`Ctrl+B` 现在固定用于切换侧边栏（不再触发加粗）；加粗请用选中工具条的 **B** 按钮或 `**文字**` 语法。
