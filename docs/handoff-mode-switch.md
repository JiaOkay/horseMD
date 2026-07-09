# 模式切换位置漂移 — 交接说明

## 应用背景

HorseMD:Electron + Vite + React + Milkdown Crepe(ProseMirror)的 Markdown 编辑器。
底部按钮 / `Ctrl+/` 在「富文本」和「源码」两种视图间切换。
仓库根:`/Users/yangtingyi/vibe_everything/horseMD`,分支 `main`。

## 需求(用户原话精简)

切换时,根据用户当前**是否有光标**,分两种行为:

1. **无光标 / 光标不在可视区**(用户在滚动阅读):双向切换,视图内容(滚动位置)都不应跳。
2. **有光标在可视区**(用户点过光标、在编辑):光标应保持在原处,且视图跟随光标(光标始终可见)。

## 现状

- 第 1 条已基本可用(光标离屏时,视口保持)。
- **第 2 条在小文档上完美,但在大文档(约 12 万字 + 183 张远程图片)上偶尔会偏** —— 光标或视口落到邻近段落。

## 根因(关键)

`src/renderer/src/components/shell/EditorArea.jsx` 约 L85:

```js
const usesTextarea = isPlainTextDoc(tab) || heavyAsSource || (sourceMode && isLeft)
```

进入源码模式时 `usesTextarea` 为真 → 提前 return 渲染 `<textarea>`,**把 Crepe 富文本编辑器整个卸载**;切回富文本时再重新挂载 Crepe → **每次切换都重新解析整篇文档 + 重新加载所有图片**。这次重渲染的布局是非确定的(图片加载时序、分块解析),所以即便用文字锚点去对齐,光标/视口也会偏。源码端 ↔ 富文本端的滚动映射在这种文档上也是非线性的(图片在源码里一行,在富文本里是高高的 `<img>`),进一步放大误差。

## 建议方向(供参考,可自行设计)

让 Crepe 在切换源码时**保持挂载**(只 `display:none`,不卸载),仅在「源码被真正编辑过」时才把新内容同步进已挂载的 Crepe。这样切回富文本不重新解析,光标和滚动位置天然保留,上面两种需求都能精确成立。

注意处理好:源码编辑的内容同步、单实例/内存,以及不要破坏现有功能(标签、查找、保存、审阅、设置、移动端、代码块、Mermaid、图片粘贴等都得正常)。

## 关键文件

- `src/renderer/src/components/shell/EditorArea.jsx`(L85 卸载/挂载逻辑,重构主战场)
- `src/renderer/src/components/Editor.jsx`(Crepe 创建/销毁/内容,~1513 行)
- `src/renderer/src/App.jsx`(`toggleSource` + `[sourceMode]` effect,目前的光标/视口锚点恢复逻辑)
- `src/renderer/src/scrollAnchor.js`(光标/视口锚点的 capture/restore,纯函数,可复用)

## 怎么验证

真实大文档测:`/Users/yangtingyi/vibe_everything/置身钉内/MinerU_markdown_置身钉内_14.34.50_2064164636132720640.md`(12 万字、183 张远程图)。

CDP 启动:`npx electron . <doc> --user-data-dir=/tmp/x --remote-debugging-port=9222`;切换用点底部 `.status-btn[title*='Ctrl+/']`。注意多 tab 时 `querySelector('.ProseMirror')` 可能命中隐藏的,要用 `offsetParent` 找可见的那个。

两类场景:
1. 滚到中后部、不点光标、切换 → 视口应不动。
2. 在可见处点光标、切换 → 光标留在原处且可见。
