# 移动端适配方案(iOS / Android)

> 状态:**方案 + 脚手架计划**(尚未动代码)。路线 = **Capacitor**;首版 = **MVP(看 / 改 / 本地文件)**。
> 铁律:**不碰、不破坏现有 Windows / macOS 桌面功能**。桌面走 Electron 那套完全不动。

## 0. 为什么是 Capacitor

HorseMD 的渲染层(React + Vite + **Milkdown Crepe**)是纯 Web/DOM 的,桌面只是用
Electron 当壳、用 `window.api`(白名单 IPC)桥接原生能力。Capacitor 同样是"原生壳
包 WebView",于是**整个渲染层可以原样复用**,我们要做的只是给 `window.api` 这套
**契约**再写一个用 Capacitor 插件实现的版本。Milkdown 是 DOM 编辑器,RN 得塞进
WebView,得不偿失;Tauri Mobile 生态尚不成熟;PWA 进不了商店。故选 Capacitor。

## 1. 核心思路:给 `window.api` 写第二套实现(shim)

桌面端 `window.api` 由 `src/preload/index.js` 注入。移动端没有 Electron preload,
所以我们在渲染层启动时检测:**若 `window.api` 不存在**,就挂一个用 Capacitor 插件
实现同样接口的 shim。这样 `App.jsx` 等业务代码**几乎不用改**——它们只认契约。

```
桌面:  preload(Electron IPC) ──┐
                               ├──►  window.api (同一套接口)  ──► App.jsx 不变
移动:  capacitor-api.js(shim)─┘
```

新增文件(不动现有文件结构):

```
src/renderer/src/platform/
  capacitor-api.js     // 用 Capacitor 插件实现 window.api 契约 + capabilities
  index.js             // 启动时:if (!window.api) window.api = makeCapacitorApi()
capacitor.config.ts    // Capacitor 配置(appId / webDir / 插件设置)
```

`src/renderer/src/main.jsx` 顶部 `import './platform'`(在 React 挂载前装好 shim)。

## 2. 接口逐项映射(以 preload 的契约为准)

| `window.api` 方法 | 桌面(Electron) | 移动(Capacitor) |
|---|---|---|
| `readFile / writeFile` | fs | `@capacitor/filesystem` `readFile/writeFile`(UTF-8) |
| `createFile / createDir / deleteItem / rename / duplicate` | fs | Filesystem 对应方法 |
| `readDir / listFiles / openFolderTree` | fs 递归 | Filesystem `readdir`(仅 App 私有库 + SAF 授权目录) |
| `openFiles` | 系统对话框 | `@capawesome/capacitor-file-picker` 选 .md |
| `openFolder` | 系统对话框 | Android: SAF 选目录;iOS: 文档目录(无任意目录概念) |
| `saveAs` | 对话框 | Share / 另存到文档目录 |
| `uploadImage`(exec 命令) | Node `exec` | **移动端不可用** → 禁用(未来可做 HTTP 上传) |
| `themesList / themeRead / themesReveal` | userData/themes | App 私有 `themes/` 目录(reveal 无意义→禁用) |
| `watchStart/Stop/File`、`onWatch*/onFileChanged` | chokidar | **no-op**(移动端无文件监听;靠重新进入前台时刷新) |
| `window*`(最小化/最大化/关闭) | BrowserWindow | **no-op**(移动端无窗口控件) |
| `exportPDF` | 主进程打印 | **MVP 先禁用**(后续可用系统分享/打印) |
| `openExternal / showInFolder` | shell | `@capacitor/browser`;showInFolder 禁用 |
| `checkUpdate` | net.fetch GitHub | 复用 `@capacitor/app` 版本 + 同样的 GitHub 检查(可保留) |
| `confirmAppClose / cancelAppClose / onAppCloseRequest` | 关闭拦截 | **no-op**(移动端无"关窗"语义) |
| `onOpenPaths / onOpenFolderPath` | argv / 单实例转发 | `@capacitor/app` `appUrlOpen` / 文件关联 intent |
| `onMenu` | 应用菜单加速器 | **no-op**(移动端无菜单;改用顶栏/手势) |
| `platform` | `'win32'|'darwin'` | `'ios'|'android'`(由 `Capacitor.getPlatform()`) |

## 3. 能力探测(capabilities)+ 平台类名

新增 `window.api.capabilities`,渲染层据此隐藏/禁用桌面专属功能,而不是到处写
`if (platform==='ios')`:

```js
capabilities = {
  folderWorkspace,  // iOS 受限;Android(SAF)可
  watch,            // false(移动)
  windowControls,   // false
  pdfExport,        // false(MVP)
  imageHostExec,    // false
  nativeMenus,      // false
  externalShell,    // true(用浏览器插件)
  revealInFolder,   // false
}
```

沿用现有 `.app.is-win/.app.is-mac` 模式,新增根类 **`.app.is-ios` / `.app.is-android`**
(还有一个 `.app.is-mobile` 便于统一写移动样式)。移动专属 CSS 只写在这些选择器下,
**绝不影响桌面**。

## 4. 路径与"本地文件"模型(MVP)

移动端没有桌面那种稳定绝对路径。约定:**`path` 字段对渲染层是不透明字符串**,移动端
存 Capacitor Filesystem 的 URI / Android SAF content URI 即可,业务逻辑大多无感。

MVP 的文件来源两类:
1. **App 私有库**(默认,零授权,永远可用):`Directory.Documents` 下的 `HorseMD/`,
   新建 / 列表 / 编辑 / 保存都在这里。首页"最近文件"复用现有 recents。
2. **导入 / 打开外部文件**:文档选择器选 .md → 读入成一个标签;保存走"另存/分享"。

文件夹工作区(侧边树):iOS 先不做(沙盒无任意目录);Android 用 SAF 授权目录,
**MVP 可先只读列出**,后续再补写操作。

## 5. 移动端 UI(MVP,尽量复用现有布局)

- 顶栏:去掉窗口控件;标签条改为可横向滑动;`+` 新建保留。
- 活动栏 / 侧边栏:窄屏改为**抽屉**(覆盖式),手势或按钮唤出。
- **安全区**:适配刘海 / 底部 Home 指示条(`env(safe-area-inset-*)`)。
- 触摸:确认 Milkdown 的选中工具条、斜杠菜单、块拖拽手柄在触摸下可用(重点验证项)。
- 源码模式、主题切换、查找、大纲:纯渲染层,基本可直接用,按窄屏微调。
- 软键盘:输入时滚动让光标可见(`visualViewport` 适配)。

> MVP 不强求和桌面像素级一致,先保证"能在手机上真正写起来"。

## 6. 构建与工程接入(不影响桌面构建)

桌面构建仍是 `electron-vite`(`npm run dev/build/dist`),**完全不动**。移动端单独加:

```bash
# 依赖(仅移动端用到)
npm i @capacitor/core @capacitor/app @capacitor/filesystem @capacitor/browser
npm i -D @capacitor/cli @capacitor/ios @capacitor/android
npm i @capawesome/capacitor-file-picker

# 一个纯 Web 构建(只打渲染层 → dist-mobile/),不走 Electron
npm run build:mobile        # 新增脚本:vite build --config vite.mobile.config.mjs

# 同步到原生工程
npx cap add ios            # 需 Xcode(macOS 已具备)
npx cap add android        # 需 Android Studio / SDK
npx cap copy
npx cap open ios|android   # 出包 / 真机调试
```

新增脚手架文件:`vite.mobile.config.mjs`(只构建渲染层、`base: './'`、输出
`dist-mobile/`)、`capacitor.config.ts`(`webDir: 'dist-mobile'`、`appId`)。
`package.json` 加 `build:mobile`、`cap:*` 脚本。`.gitignore` 忽略 `dist-mobile/`
及原生构建产物(`ios/App/Pods`、`android/.gradle` 等;平台目录是否入库后续定)。

`appId` 建议 `net.yangsir.horsemd`;应用名 HorseMD;图标/启动屏复用 `build/icon.png`。

## 7. 文件关联("用 HorseMD 打开 .md")

- iOS:`Info.plist` 注册 `CFBundleDocumentTypes`(public.markdown / .md)。
- Android:`AndroidManifest.xml` intent-filter(`text/markdown`、`.md`)。
- 两端经 `@capacitor/app` 的 `appUrlOpen` 回调 → 映射到现有 `onOpenPaths`。

## 8. 分阶段落地(确认后按此执行)

1. **脚手架**:装 Capacitor、`vite.mobile.config.mjs`、`capacitor.config.ts`、
   `build:mobile` 脚本;`npx cap add ios/android`;先跑通"空壳 + 现有渲染层能起来"。
2. **shim 最小集**:`platform/` + capabilities + 平台类名;先实现
   `readFile/writeFile/openFiles` + App 私有库 `readDir/createFile`,其余 no-op。
   目标:**能打开、编辑、保存一个本地 .md**。
3. **能力门控**:渲染层按 capabilities 隐藏窗口控件、PDF、图床、文件夹树(iOS)、
   监听相关 UI;加移动响应式样式 + 安全区。
4. **触摸 / 键盘打磨**:Milkdown 触摸交互、软键盘滚动、抽屉式侧栏。
5. **文件关联 + 更新检查**:intent / appUrlOpen;GitHub 更新检查复用。
6. **真机验证 + 出包**:iOS 模拟器/真机、Android 模拟器/真机;图标启动屏;商店素材。

## 9. 风险与注意

- **桌面零回归**:shim 仅在 `window.api` 缺失时挂载;移动样式仅在 `.is-mobile`
  选择器下;移动依赖不进 Electron 包。每步都要回归桌面 `npm run build`。
- **iOS 沙盒 / Android 分区存储**:任意目录访问受限,故 MVP 以 App 私有库为主。
- **Milkdown 触摸交互**是最大不确定项(选中工具条 / 拖拽手柄 / 长按),需尽早真机验证。
- **包体**:KaTeX / Mermaid 较大,移动端继续保持 `import()` 懒加载。
- **图床 exec 不可用**:移动端无 Node 子进程,MVP 禁用;未来做纯 HTTP 上传版本。
- **iOS 上架**需 Apple 开发者账号($99/年)与签名;Android 需 keystore。桌面那条
  "未签名"经验不适用,移动端商店强制签名。

## 10. 打包发布(Android / iOS)

### Android —— 出可下载的签名 APK
1. **生成 keystore(一次性,务必备份;丢了就无法用同一身份更新 App)**:
   ```bash
   keytool -genkeypair -v -keystore android/app/horsemd.keystore \
     -alias horsemd -keyalg RSA -keysize 2048 -validity 10000 \
     -dname "CN=HorseMD, O=HorseMD, C=CN"
   ```
   按提示设一个口令(自己记牢)。
2. 复制 `android/key.properties.example` → `android/key.properties`,填入口令(此文件已 gitignore)。
3. 出包:
   ```bash
   JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" npm run dist:android
   ```
   产物:`android/app/build/outputs/apk/release/app-release.apk`(签名、可分发)。
4. 上 **Google Play** 用 `./gradlew bundleRelease` 出 `.aab`。

> 没有 `key.properties` 时,release 不签名、debug 不受影响(`assembleDebug` 仍照常)。
> keystore / key.properties **永不入库**。

### iOS —— TestFlight / App Store(需 Apple 开发者账号 $99/年)
1. 注册 [Apple Developer Program](https://developer.apple.com/programs/)。
2. 在 [App Store Connect](https://appstoreconnect.apple.com) 新建一个 App 记录(Bundle ID = `com.horsemd.app`)。
3. Xcode:`npx cap sync ios` → 打开 `ios/App/App.xcodeproj` → 设好 Team(付费账号)、版本号/构建号 → 顶部设备选 **Any iOS Device** → **Product → Archive**。
4. Archive 完成 → **Distribute App** → **TestFlight & App Store** → 上传。之后在 App Store Connect 里发 TestFlight 测试或提交审核上架。

> iOS 无法像安卓那样发文件随便装;分发只能走 TestFlight / App Store /(Ad Hoc 限指定 UDID)。免费账号仅能装自己设备、7 天过期。
