import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // dialogs
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveAs: (defaultName) => ipcRenderer.invoke('dialog:saveAs', defaultName),

  // fs
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
  rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  deleteItem: (path) => ipcRenderer.invoke('fs:delete', path),
  createFile: (path, content) => ipcRenderer.invoke('fs:createFile', path, content),
  createDir: (path) => ipcRenderer.invoke('fs:createDir', path),
  readDir: (dir) => ipcRenderer.invoke('fs:readDir', dir),
  listFiles: (root) => ipcRenderer.invoke('fs:listFiles', root),
  openFolderTree: (dir) => ipcRenderer.invoke('fs:openFolderTree', dir),

  // watch
  watchStart: (dir) => ipcRenderer.invoke('watch:start', dir),
  watchStop: (dir) => ipcRenderer.invoke('watch:stop', dir),

  // shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showInFolder: (path) => ipcRenderer.invoke('shell:showInFolder', path),

  // events from main
  onOpenPaths: (cb) => {
    const fn = (_e, paths) => cb(paths)
    ipcRenderer.on('open-paths', fn)
    return () => ipcRenderer.removeListener('open-paths', fn)
  },
  onMenu: (cb) => {
    const fn = (_e, cmd) => cb(cmd)
    ipcRenderer.on('menu', fn)
    return () => ipcRenderer.removeListener('menu', fn)
  },
  onWatchChanged: (cb) => {
    const fn = (_e, dir) => cb(dir)
    ipcRenderer.on('watch:changed', fn)
    return () => ipcRenderer.removeListener('watch:changed', fn)
  },

  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
