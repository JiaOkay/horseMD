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

## 2026-07-09 修复复盘

### 最终结论

这次问题不是单纯的“关键词匹配不准”,而是模式切换同时踩中了三类不稳定来源:

1. 源码模式卸载 Crepe,切回富文本时重建 ProseMirror 文档和图片布局,大文档布局不具备确定性。
2. 源码和富文本不是同一个线性文本流。图片、链接、标题标记、表格管道、HTML、frontmatter 等在源码里占 raw 字符,在富文本里可能是 atom node 或完全不同的可见文本。
3. “用户在编辑”与“用户在滚动阅读”的状态判断混在一起。源码 textarea 的 selection、scroll 事件和程序化恢复滚动会互相污染,导致本来应该跟随光标的场景被当成阅读态,或者反过来。

最终修复思路是:保持富文本编辑器挂载,并把光标定位从“关键词/全局可见字符猜测”升级为“Markdown raw offset 与 ProseMirror position 的块级映射”。

### 关键改动

#### 1. 源码模式不再卸载富文本编辑器

`EditorArea.jsx` 中把源码模式拆成两层:

- 源码 textarea 作为当前可见编辑面。
- Crepe/ProseMirror 仍保持挂载,只是隐藏。

这样未编辑源码时切回富文本,不需要重新解析整篇 Markdown,也不会重新加载 183 张远程图片。富文本 selection 和 scrollTop 可以直接保留。

#### 2. 只在源码真正修改后同步到 Crepe

`App.jsx` 增加 `syncSourceToRich(id)`:

- textarea 内容等于 baseline 时不写回 Crepe。
- 内容变化时调用 Editor API `replaceMarkdown(next)`。
- 如果 Crepe 还没 ready,才退回 reloadNonce 触发下一次挂载消费新内容。

这避免了“只是切换视图”也触发文档更新和 dirty 状态。

#### 3. 新增块级源码映射模块

新增 `src/renderer/src/components/editor-source-map.js`,核心职责:

- 用 Milkdown 当前 `remarkCtx` 解析 Markdown,收集 mdast block 的 raw offset 范围和可见文本。
- 遍历 ProseMirror doc,收集 textblock/atom block 的 pos、contentPos、文本和类型。
- `markdownOffsetToPmPos(markdown, rawOffset, doc, remark)`:源码 raw offset → ProseMirror pos。
- `pmPosToMarkdownOffset(markdown, pmPos, doc, remark)`:ProseMirror pos →源码 raw offset。

匹配优先级:

1. 同类型 block 的完整可见文本精确匹配。
2. 重复文本按 occurrence index 选择。
3. contains fallback。
4. 同 index / 同 kind fallback。

这比关键词定位稳定,因为它先确定“哪个块”,再在块内按字符位置转换,不会因为全文里出现相同词而跳到别处。

#### 4. 双向切换都走 raw offset

源码 → 富文本:

- `captureSourceCaret()` 捕获 textarea 的 `selectionStart` 作为 `rawOffset`。
- `Editor.restoreMarkdownOffset(rawOffset, follow)` 使用块级映射恢复 ProseMirror selection。
- 图片等 atom block 用 `NodeSelection`,普通文本用 `TextSelection.near()`。

富文本 → 源码:

- `Editor.markdownOffsetFromSelection()` 读取当前 DOM/PM selection。
- 用 `pmPosToMarkdownOffset()` 反推 raw offset。
- `restoreSourceCaret()` 优先使用 `anchor.rawOffset`,不再优先使用全局可见字符 index。

这一步修掉了图片密集文档里的根本偏移:源码里图片 Markdown 会占很多字符,富文本里图片通常是 atom node,所以两边全局 index 从第一批图片后就不再等价。

#### 5. 区分源码“点击光标”和“滚动阅读”

`EditorArea.jsx` 给 textarea 维护轻量状态:

- `__horsemdSourceSelectionUser`:用户明确选择/点击/键盘移动过光标。
- `__horsemdSourceSelectionBaseline`:进入源码模式后的 selection 基线。
- `__horsemdSourceViewportMoved`:源码视口是否被用户滚动过。
- `__horsemdSourceSelectionAt`:选择发生时间,用于屏蔽选择后短时间内的惯性/程序化 scroll 事件。

`App.jsx` 退出源码模式时据此判断:

- 源码未改、未动 selection、未滚动:保留仍挂载的富文本 selection/scroll。
- 用户点击了源码光标:按 raw offset 恢复富文本光标,并跟随光标。
- 用户只是滚动源码阅读:不跟随旧光标,恢复视口锚点。

#### 6. 去掉源码自绘粗光标

之前的自绘 caret 用 mirror div 算 textarea 坐标。在超长、自动换行、滚动恢复的源码 textarea 中,它会滞后或算错,出现“光标压在文字上”或“光标在空白处”的视觉问题。

现在源码模式使用浏览器原生 textarea caret。

#### 7. 避免纯切换触发 dirty

相关改动:

- `Editor.jsx` 的 `markdownUpdated` 只在最近存在用户编辑意图时向外发 `onChange`。
- `useFileOps.js` 对相同内容 no-op,避免 Crepe 规范化输出把干净文档重新标 dirty。
- `App.jsx` 的 `commitLive()` 对相同内容 no-op。
- 移动端保存按钮在 clean 状态禁用。
- 源码模式审阅操作使用 textarea 当前 value,并同步写回 textarea,避免 stale tab content。

### 验证记录

基础验证:

```bash
npm run build
node scripts/test-strike-guard.mjs
```

结果:

- `npm run build` 通过。
- `test-strike-guard.mjs`:27 passed,0 failed。

真实大文档验证:

文档:

```bash
/Users/yangtingyi/vibe_everything/置身钉内/MinerU_markdown_置身钉内_14.34.50_2064164636132720640.md
```

启动方式:

```bash
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  /Users/yangtingyi/vibe_everything/horseMD \
  "/Users/yangtingyi/vibe_everything/置身钉内/MinerU_markdown_置身钉内_14.34.50_2064164636132720640.md" \
  --user-data-dir=/tmp/horsemd-final-test \
  --remote-debugging-port=9351
```

覆盖点:

- 源码 → 富文本:10 个光标位置通过。
- 富文本 → 源码:10 个光标位置通过。
- 覆盖前部、中部、后部,以及此前失败的 `智能是平权的`、`组织`、`业务`、`模型`。
- `业务` 位置单独复现过一次,确认光标落在正确段落并可见。

测试时注意:

- 多 tab 下不要直接 `document.querySelector('.ProseMirror')`,要筛 `offsetParent` 找可见编辑器。
- 源码 textarea 的程序化 scroll 会触发 scroll 事件,自动测试如果要模拟“用户点击源码光标”,要同时设置 selection intent,并避免把这类程序化 scroll 当成阅读态。
- 阅读态不能用 textarea scrollTop 按全文比例反推可见文本;图片密集文档的源码/富文本高度是非线性的,这种断言本身不可靠。

### 这次踩过的坑

- 只用关键词匹配不够。重复词、相邻段落、短标题都会造成误命中。
- 全局可见字符 index 也不够。图片和 atom node 让源码与富文本的文本流从结构上不等价。
- 源码 selection baseline 缺失时,会误把“用户在源码里点过光标”当作“只是查看源码”,从而保留旧富文本光标。
- textarea 自绘光标在大文档中风险高,尤其是在程序化滚动和换行测量叠加时。
- “是否 dirty”必须和“模式切换/编辑器规范化输出”解耦,否则只是切换视图也会把已保存状态变成可保存。

### 后续维护建议

- 不要再用全文关键词作为主路径恢复光标。关键词/上下文只能作为兜底。
- 如果新增 Markdown block 类型,需要同步检查 `editor-source-map.js` 的 mdast/PM kind 映射。
- 如果恢复源码粗光标,必须先建立 textarea 像素定位的独立回归测试,否则很容易重新出现遮字和空白光标。
- 模式切换回归最好固定使用真实大文档,小文档无法暴露图片、atom、chunk parse、远程资源加载带来的问题。
