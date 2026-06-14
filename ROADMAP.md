# HorseMD 路线图 / Roadmap

> 这里记录 HorseMD 的方向与优先级。顺序大致代表优先级,但会随实际情况调整;
> 欢迎在 [Issues](https://github.com/BND-1/horseMD/issues) 里提想法。
>
> *This is the project roadmap (Chinese-first). Items are roughly ordered by
> priority and may change. Ideas welcome via Issues.*

---

## ✅ 已完成 / 已发布

桌面端(Windows + macOS,Electron):

- 标签式多文件编辑(所有 `.md` 开在同一个窗口,而不是开新进程)
- 文件树工作区、命令面板、大纲面板、会话恢复、单实例文件关联
- Typora 风格所见即所得(Milkdown Crepe)、源码模式
- 暖色主题 + 莫兰迪四色、明暗、i18n(中/英)
- 分屏(两个文档并排,各自可编辑,可拖动比例)
- 导出 PDF
- 外部修改自动重载、关闭未保存提醒
- 大文件极速纯文本模式

### 0.2.0(本次发布)

- **可配置图床**:类 Typora 的自定义上传命令(粘贴/拖入/上传图片自动走命令并插入返回链接)
- **自定义页面宽度**:状态栏分段预设 + 微调滑块
- **自定义主题**:把 `.css`(或整个下载来的主题文件夹)放进主题文件夹即可(可直接迁移 Typora 主题),或从 [theme.typora.io](https://theme.typora.io) 下载
- **Mermaid 图表**实时渲染、**LaTeX 公式**(KaTeX)
- **表格单元格内换行**(`<br>` 干净往返)、更紧凑的表格排版
- **Intel(x64)macOS 构建**
- **更新提示展示更新内容**(自动读取 GitHub release notes)
- 修复:表格文字超列宽重叠、长公式右侧重叠、图片选中线框、切主题丢全宽设置等

---

## 🚧 近期计划(桌面端)

- **macOS 签名 + 公证** —— 解决 Gatekeeper "打不开/已损坏",免去手动右键打开
  ([#1](https://github.com/BND-1/horseMD/issues/1))
- **Front matter 支持** —— 识别顶部 YAML、渲染为独立信息块、原样往返保存
  ([#8](https://github.com/BND-1/horseMD/issues/8))
- **Linux 版本** —— 加构建目标 + CI,并补齐 Linux 的窗口/标题栏等适配(暂缓)
- 持续打磨:更多键盘快捷键、查找替换、导出选项等

---

## 🔭 远期 / 探索中

### 📱 移动端适配:Android 与 iOS

把 HorseMD 的写作体验带到手机和平板上 —— 这是当前桌面版稳定后的下一个大方向。

- **目标**:在移动端获得一致的 Typora 风格所见即所得编辑,并能与桌面端共享文档。
- **思路(待评估)**:
  - 复用现有渲染层(React + Milkdown)的编辑器内核,替换掉 Electron 外壳;
  - 候选技术:Capacitor / Tauri Mobile 等(把 Web 编辑器装进原生壳,接入移动端文件系统与分享);
  - 移动端重做交互层:触摸友好的工具栏、虚拟键盘适配、手势,而非照搬桌面 UI。
- **挑战**:移动端文件访问权限模型、性能(大文档)、输入法/选区行为、与桌面端的同步方式。
- **节奏**:桌面端功能与稳定性达标后启动;会先出技术预研与最小可用版本(MVP)。

> 这一块尚在规划,具体技术选型与时间表会在桌面版成熟后另行确定。

---

## 参与

有想法或需求?欢迎到 [Issues](https://github.com/BND-1/horseMD/issues) 提;
变更记录见 [CHANGELOG.md](./CHANGELOG.md)。
