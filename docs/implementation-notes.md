# 实现笔记：踩过的坑、根因与决策

这份文档记录开发过程中发现的关键问题、根本原因、修复方式，以及一些设计决策。很多 bug 是用 CDP 端到端实测（见 [development.md](./development.md)）才定位到的。

---

## 致命 bug 1：所有"视图相关"功能静默失效

**现象**：改标题层级的按钮"点不动"、`Ctrl+1/2/3` 没反应（数字还被打进正文）、右键菜单不弹、选中浮条不出现、Ctrl+点链接/富文本复制/图片解析全不工作。

**根因**：这些功能都依赖底层 ProseMirror 的 `EditorView`，而代码用 `crepe.editor.view` 取它 —— 在本项目的 Milkdown 版本里这是 `undefined`。于是所有 `if (view) { … }` 的逻辑从未执行，监听器一个都没挂上。

**修复**（`Editor.jsx`）：
```js
import { editorViewCtx } from '@milkdown/kit/core'
const view = crepe.editor.ctx.get(editorViewCtx)   // 不是 crepe.editor.view
```

**教训**：一个底层引用取错，会让一大片上层功能"看起来各自坏了"，其实是同一个根。

---

## 致命 bug 2：编辑内容不同步、保存会丢编辑

**现象**：编辑器里改了内容，但大纲不更新、字数不变、"● 已修改"不亮 —— 最严重的是 `Ctrl+S` 会把文件存回**初始内容**，悄悄丢掉所有编辑。

**根因**：内容变更回调 `markdownUpdated` 注册在 `crepe.create()` **之后**。Crepe 在 `create()` 时就把监听器接好了，之后再注册的永远不触发，于是 `tab.content` 一直停在打开时的初始值，所有派生状态（大纲/字数/脏标记/保存内容）都跟着冻结。

**修复**（`Editor.jsx`）：把 `crepe.on(markdownUpdated)` 移到 `create()` **之前**。

```js
crepe.on((api) => api.markdownUpdated((_ctx, md) => { if (ready) onChange?.(md, false) }))
await crepe.create()
```

---

## bug 3：选中/双击时内容整体上移 + 表格里看不见光标

**现象**：在编辑器里选中段落或双击时，内容会"整体向上跳"；表格单元格里完全看不到光标。

**根因**：Crepe 默认开启 **virtual cursor**（`prosemirror-virtual-cursor`），用一个自定义元素替换原生光标。它在选区/聚焦时往文本流里插入元素 → 触发回流（内容跳动）；同时把原生光标设为透明 → 表格里看不见。

**修复**：
- `Editor.jsx` 关闭该特性：`[CrepeFeature.Cursor]: false`，改用原生光标
- `styles/app.css` 给原生光标上色：`caret-color: var(--accent)`，并显式覆盖表格单元格
- 顺手去掉 `.editor-scroll` 的 `scroll-behavior: smooth`（它把每次隐式滚动变成肉眼可见的滑动），加 `overflow-anchor: none`

---

## bug 4：选中浮条永远不出现

**现象**：选中文字后，自研的浮动控件不显示。

**根因**：判断条件用了 `sel instanceof TextSelection`，而 Crepe 自带一份打包好的 `prosemirror-state`，view 的 selection 是它那份 `TextSelection` 的实例，跟我们 `import` 的不是同一个类 → `instanceof` 永远 false。

**修复**：改成鸭子类型判断（`sel.empty || sel.from === sel.to`），不依赖 `instanceof`。

> 后来该浮条整体被"工具条注入按钮"方案替代（见下）。

---

## bug 5：右键菜单/上下文相关的时序假象

**现象**：自动化测试里右键菜单"没打开"。

**根因**：是测试脚本的时序问题 —— 原生监听器调 React `setState` 是异步渲染，脚本同步查 DOM 太早。给测试加上等待后即正常。

**教训**：区分"真 bug"和"测试方法的假象"很重要。多个最初看似失败的项（键盘转换、浮条、图片）最后都被证明是 CDP 合成事件的局限（合成拖拽不驱动 ProseMirror 选区、`requestAnimationFrame` 在窗口被遮挡时被节流等），而非应用本身的问题。

---

## bug 6：标签去重竞态（会话恢复出现重复标签）

**现象**：恢复会话时出现多个重复的 README 标签。

**根因**：`openPaths` 用 `setTabs` 回调异步读 `existing`，但紧接着同步判断，读不到刚加的，导致同一文件被重复打开。

**修复**：用一个始终最新的 `tabsRef` 同步快照来去重 + 调用内 `seen` 集合去重。会自愈（下次恢复时折叠重复项）。

---

## 决策：改标题层级整合进 Crepe 工具条

需求是把"改层级"做成加粗/斜体工具条里的一个按钮，悬浮展开 H1/H2/H3/¶。Crepe 工具条的 `buildToolbar` 只支持扁平的"图标+点击"，**不支持子菜单**。

**做法**：用 `MutationObserver` 监听 `.milkdown-toolbar` 出现，往里注入自己的 `.hm-heading-item` DOM，CSS `:hover` 展开子菜单。两个坑：
- Crepe 工具条 `overflow: hidden` 会裁掉子菜单 → 覆盖成 `overflow: visible`
- 注入用了 `requestAnimationFrame` 节流，但窗口被遮挡时 rAF 几乎不触发 → 改成同步注入（幂等）

---

## bug 7：Ctrl+B 切侧边栏时灵时不灵

**现象**：按 `Ctrl+B` 想切侧边栏，但经常不生效，或被编辑器拿去加粗。

**根因**：`Ctrl+B` 在主进程菜单注册成了加速器，而编辑器（ProseMirror）也把 `Mod-B` 绑成加粗 —— 冲突，编辑器经常先吃掉这个按键。

**修复**：
- 主进程移除 `Toggle Sidebar` 的 `CmdOrCtrl+B` 加速器（避免和渲染层双触发）
- 渲染层在 **捕获阶段** 监听 `Ctrl/Cmd+B`，先于编辑器处理：切侧边栏 + `preventDefault/stopPropagation`（编辑器收不到 → 不加粗）
- `metaKey` 一并判断，macOS 的 `Cmd+B` 同样生效

---

## 决策：应用图标

- 源图 `icon.png`，用脚本生成多分辨率 `build/icon.ico`（16–256），并裁出 **22% 圆角**（圆角外透明），避免硬直角
- `package.json` 的 `build.win.icon` / `nsis` / 文件关联都指向它
- 首页 logo 用图标副本 `src/renderer/src/assets/logo.png`（CSS 加圆角）

> 注意：`System.Drawing.Icon` 解码不了 PNG 内嵌的 ICO 帧（会渲染成噪点），这是验证工具的局限，不代表 ICO 坏了 —— Windows / electron-builder 能正常读。

---

## 决策：窗口拖拽区域

无边框标题栏下，拖拽区由 `-webkit-app-region` 决定。最初 `.tabs` 被设成 `no-drag`，而标签容器占了顶栏绝大部分宽度 → 几乎整条顶栏不能拖。改成：标签**容器背景**可拖（`.tabs/.tabs-scroll`），只有标签页/按钮 `no-drag`；活动栏空白也可拖。
