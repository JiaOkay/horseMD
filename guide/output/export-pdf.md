---
title: 导出 PDF
description: 将当前 HorseMD 文档导出为干净的 PDF 文件。
---

# 导出 PDF

<span class="version-badge">适用于 HorseMD v0.6.0</span>

桌面端按 `Ctrl/Cmd+Shift+E`，使用文件菜单、命令面板或标签右键菜单中的“导出为 PDF”。选择保存位置后，HorseMD 会生成 PDF 并使用系统默认程序打开。

导出内容来自当前富文本结构，但会移除：

- 代码块工具栏和复制按钮。
- 表格拖拽手柄。
- 块菜单、加号按钮和编辑器辅助控件。
- 查找高亮等临时界面状态。

CodeMirror 代码块会转换为普通 `<pre><code>`，确保打印内容稳定。PDF 使用 A4 页面和专用打印样式，并保留本地或网络图片。

## 分屏时导出

先点击需要导出的编辑栏，再执行导出。HorseMD 会读取当前聚焦文档，不会固定导出左栏或第一个标签。

::: info 移动端
iOS 和 Android 不提供桌面 PDF 导出。可以通过系统分享把 Markdown 发送到支持打印或 PDF 转换的应用。
:::
