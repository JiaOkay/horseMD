# 开发、构建与测试

## 本地开发

```bash
npm install
# 若 Electron 二进制下载被墙，先设镜像：
#   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   (Windows cmd)
#   $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" (PowerShell)
npm run dev
```

`npm run dev` 用 electron-vite 起开发模式：main/preload 用 esbuild 构建，renderer 用 Vite dev server（热重载）。

## 构建与打包

```bash
npm run build       # 构建到 out/（main + preload + renderer）
npm start           # 运行构建产物（electron-vite preview）
npm run dist        # 构建 + electron-builder 打 Windows NSIS 安装包 → dist/
npm run dist:dir    # 构建 + 打免安装目录版（dist/win-unpacked/）
```

打包时若 electron-builder 的二进制下载慢，加镜像环境变量：
```
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

> 打包常见报错 `app-builder ... CANNOT_EXECUTE` 通常是 `dist/win-unpacked/HorseMD.exe` 被占用（有实例在跑）—— 先关掉所有 HorseMD 实例再打。

### 打包配置（package.json → build）

```jsonc
"build": {
  "appId": "com.horsemd.app",
  "productName": "HorseMD",
  "files": ["out/**/*"],
  "icon": "build/icon.ico",
  "win": { "target": ["nsis"], "icon": "build/icon.ico", "fileAssociations": [/* .md/.markdown */] },
  "nsis": { "installerIcon": "build/icon.ico", "uninstallerIcon": "build/icon.ico" }
}
```

- 安装包**未签名**：首次运行 Windows SmartScreen 会提示"未知发布者"，点"更多信息 → 仍要运行"。需要正式签名得配证书。

### macOS 打包（待补）

当前 `build` 只配了 Windows。打 mac 版需要：

1. 在 `build` 里加 `mac` 配置（在 macOS 上构建，dmg 必须在 mac 上打）：
   ```jsonc
   "mac": { "target": ["dmg"], "icon": "build/icon.icns", "category": "public.app-category.productivity" }
   ```
2. 生成 `build/icon.icns`（可由现有 `icon.png` 转）：mac 上 `iconutil`，或跨平台用 `png2icns` / `electron-icon-builder`。
3. `npm run dist`（在 macOS 上）产出 `.dmg`。

> 代码本身已尽量跨平台：快捷键判断同时认 `Ctrl` 和 `Cmd`（`metaKey`），`open-file`（Finder 打开）事件已处理，标题栏在 darwin 用 `hiddenInset`。

## 自动化测试：CDP 端到端验证

项目没有传统单测，而是用 **Chrome DevTools Protocol** 连进运行中的 Electron，真实派发鼠标/键盘事件并回读 DOM —— 测的是"用户真实体验"。这套方法定位了好几个隐蔽 bug。

### 工具

- `scripts/etv.mjs` —— 端到端验证：命中测试每个按钮、读计算样式、检测 `-webkit-app-region`、驱动块切换器/右键菜单/选区等
- `scripts/inspect.mjs` —— 简易状态检查器

### 用法

```bash
# 1) 带远程调试端口启动（注意：要先关掉别的实例，否则单实例锁会转发到旧实例）
npx electron . --remote-debugging-port=9222 "path\to\some.md"

# 2) 跑验证
node scripts/etv.mjs
```

### 关键经验（CDP 的坑）

- **响应取值路径**：`Runtime.evaluate` 的值在 `msg.result.result.value`（别写成 `msg.result.value`）
- **合成事件的局限**：
  - `Input.dispatchMouseEvent` 的合成**拖拽不驱动 ProseMirror 的 `state.selection`**（DOM 有选区但 PM 内部是空的）→ 测选区相关功能要用**键盘选区**（Shift+方向键）
  - 合成点击会**绕过 OS 级 `-webkit-app-region` 的拖拽吞噬**，所以它不能证明"真实鼠标可点"；判断拖拽区要读计算样式
  - `requestAnimationFrame` 在窗口被遮挡时被节流到几乎不触发 → 别在初始化逻辑里依赖 rAF
  - 原生监听器调 React `setState` 是异步渲染，查 DOM 前要等一拍
- `/json/new` 在新版 Chromium 被限制；要新开页面截图可直接 `Page.navigate` 现有页到目标 URL
- `System.Drawing.Icon` 读不了 PNG 内嵌的 ICO 帧（渲染噪点），验证圆角时直接渲染源 PNG

## 数据/状态约定

- 会话存于 `localStorage`，键 `minimd.session.v1`：`{workspace, theme, lang, recents, sidebarOpen, sidebarMode, openPaths, activePath}`
- 首次引导标记：`localStorage['horsemd.onboarded.v1']`
- 主题以 `body` 的 class 表达：`light|dark` 基类 + 可选 `theme-*` 覆盖类
