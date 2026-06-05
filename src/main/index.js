import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import chokidar from 'chokidar'

const __dirname = dirname(fileURLToPath(import.meta.url))

let mainWindow = null
const watchers = new Map() // folder path -> watcher
const fileWatchers = new Map() // file path -> { watcher, timer }

// ---- Single instance: route any second launch into the existing window ----
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const files = extractMarkdownArgs(argv)
    focusMainWindow()
    if (files.length) sendToRenderer('open-paths', files)
  })
}

function extractMarkdownArgs(argv) {
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && /\.(md|markdown|mdx|txt)$/i.test(a) && existsSync(a))
}

function focusMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#1a1b20',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    // macOS: place the traffic lights at a fixed spot so the renderer can
    // reserve a matching gap (see `.app.is-mac` rules in app.css). y centers the
    // ~12px buttons within the 40px top bar.
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 14 } : undefined,
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: '#00000000', symbolColor: '#9aa0aa', height: 38 }
        : false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      spellcheck: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    focusMainWindow()
    const files = extractMarkdownArgs(process.argv)
    if (files.length) sendToRenderer('open-paths', files)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// macOS: opening a file from Finder
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (mainWindow) {
    focusMainWindow()
    sendToRenderer('open-paths', [path])
  } else {
    app.whenReady().then(() => sendToRenderer('open-paths', [path]))
  }
})

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ----------------------------- IPC: file system -----------------------------

ipcMain.handle('dialog:openFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return res.canceled ? [] : res.filePaths
})

ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return res.canceled ? null : res.filePaths[0]
})

ipcMain.handle('dialog:saveAs', async (_e, defaultName) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'Untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  })
  return res.canceled ? null : res.filePath
})

ipcMain.handle('fs:readFile', async (_e, path) => {
  const content = await fs.readFile(path, 'utf8')
  const stat = await fs.stat(path)
  return { content, mtimeMs: stat.mtimeMs }
})

ipcMain.handle('fs:writeFile', async (_e, path, content) => {
  await fs.writeFile(path, content, 'utf8')
  const stat = await fs.stat(path)
  return { mtimeMs: stat.mtimeMs }
})

ipcMain.handle('fs:rename', async (_e, oldPath, newPath) => {
  await fs.rename(oldPath, newPath)
  return true
})

ipcMain.handle('fs:delete', async (_e, path) => {
  await shell.trashItem(path)
  return true
})

ipcMain.handle('fs:createFile', async (_e, path, content = '') => {
  await fs.writeFile(path, content, { flag: 'wx' })
  return true
})

ipcMain.handle('fs:createDir', async (_e, path) => {
  await fs.mkdir(path, { recursive: true })
  return true
})

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '.obsidian', 'out', 'dist'])

async function readTree(dir, depth = 0) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes = []
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitignore') continue
    if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: full, type: 'dir', children: null })
    } else if (/\.(md|markdown|mdx|txt)$/i.test(e.name)) {
      nodes.push({ name: e.name, path: full, type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

ipcMain.handle('fs:readDir', async (_e, dir) => readTree(dir))

async function listFilesFlat(root, dir, acc, depth) {
  if (depth > 12 || acc.length > 5000) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue
      await listFilesFlat(root, full, acc, depth + 1)
    } else if (/\.(md|markdown|mdx|txt)$/i.test(e.name)) {
      acc.push({ name: e.name, path: full, rel: full.slice(root.length + 1).replace(/\\/g, '/') })
    }
  }
}

ipcMain.handle('fs:listFiles', async (_e, root) => {
  const acc = []
  await listFilesFlat(root, root, acc, 0)
  return acc
})

ipcMain.handle('fs:openFolderTree', async (_e, dir) => ({
  root: { name: basename(dir), path: dir, type: 'dir' },
  children: await readTree(dir)
}))

// Watch a folder; notify renderer on changes (debounced lightly by chokidar)
ipcMain.handle('watch:start', async (_e, dir) => {
  if (watchers.has(dir)) return true
  const w = chokidar.watch(dir, {
    ignored: (p) => /(^|[\\/])\.(git|obsidian)|node_modules/.test(p),
    ignoreInitial: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })
  let timer = null
  const ping = () => {
    clearTimeout(timer)
    timer = setTimeout(() => sendToRenderer('watch:changed', dir), 120)
  }
  w.on('add', ping).on('unlink', ping).on('addDir', ping).on('unlinkDir', ping)
  watchers.set(dir, w)
  return true
})

ipcMain.handle('watch:stop', async (_e, dir) => {
  const w = watchers.get(dir)
  if (w) {
    await w.close()
    watchers.delete(dir)
  }
  return true
})

// Watch a single open file for external content changes (e.g. an agent edits
// the file on disk). Emits `file:changed` with the new mtime so the renderer
// can reload the tab.
ipcMain.handle('watch:file', async (_e, path) => {
  if (fileWatchers.has(path)) return true
  const w = chokidar.watch(path, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })
  const entry = { watcher: w, timer: null }
  const notify = async () => {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(async () => {
      let mtimeMs = 0
      try {
        mtimeMs = (await fs.stat(path)).mtimeMs
      } catch {
        /* file may have been removed */
      }
      sendToRenderer('file:changed', { path, mtimeMs })
    }, 80)
  }
  w.on('change', notify).on('add', notify)
  fileWatchers.set(path, entry)
  return true
})

ipcMain.handle('watch:unfile', async (_e, path) => {
  const entry = fileWatchers.get(path)
  if (entry) {
    clearTimeout(entry.timer)
    await entry.watcher.close()
    fileWatchers.delete(path)
  }
  return true
})

ipcMain.handle('shell:openExternal', async (_e, url) => shell.openExternal(url))
ipcMain.handle('shell:showInFolder', async (_e, path) => shell.showItemInFolder(path))

// Menu actions are forwarded to renderer as commands.
function menuCmd(cmd) {
  return () => sendToRenderer('menu', cmd)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: menuCmd('new') },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: menuCmd('open') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: menuCmd('openFolder') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: menuCmd('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: menuCmd('saveAs') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: menuCmd('closeTab') },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: menuCmd('find') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+P', click: menuCmd('palette') },
        // Sidebar toggle is handled in the renderer (capture phase) so it wins
        // over the editor's Ctrl/Cmd+B "bold" binding instead of conflicting.
        { label: 'Toggle Sidebar', click: menuCmd('toggleSidebar') },
        { label: 'Toggle Outline', accelerator: 'CmdOrCtrl+Shift+L', click: menuCmd('toggleOutline') },
        { label: 'Toggle Source Mode', accelerator: 'CmdOrCtrl+/', click: menuCmd('toggleSource') },
        { type: 'separator' },
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+Shift+T', click: menuCmd('toggleTheme') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
