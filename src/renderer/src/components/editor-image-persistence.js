import { uniqueImageName } from './editor-images.js'

// Read an image file as a base64 data: URL — the last-resort persistent src
// (survives save & reload, unlike a blob: URL) for untitled docs / mobile.
const fileToDataUrl = (file) =>
  new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => resolve(URL.createObjectURL(file))
    r.readAsDataURL(file)
  })

// Turn a pasted / dropped / picked image file into a *persistable* src so it
// never dies on reload:
//   1. image-host command configured -> upload, use returned URL
//   2. saved document -> write into ./assets and use a relative path
//   3. unsaved doc with desktop paste folder -> temporary file:// URL
//   4. mobile / any failure -> inline base64 data: URL
export function createImagePersister({ docPath, getUploadCommand, getT, notify }) {
  return async function persistImage(file, fromClipboard = false) {
    // Clipboard screenshots default to collision-prone names (image.png,
    // QQ_*.png). Stamp a Typora-style timestamp so they never overwrite a
    // same-named file on the host. Dropped/picked files keep their real name.
    const name = fromClipboard ? uniqueImageName(file.name) : (file.name || 'image.png')
    const cmd = (getUploadCommand?.() || '').trim()
    if (cmd) {
      notify?.(getT('imghost.uploading'))
      try {
        const buf = await file.arrayBuffer()
        const res = await window.api.uploadImage(cmd, name, new Uint8Array(buf))
        if (res?.ok && res.url) {
          notify?.(getT('imghost.uploaded'))
          return res.url
        }
        // Surface the actual error so image-host failures (PicGo server down,
        // wrong port, R2 auth, 404, ...) are diagnosable instead of a generic
        // "failed". Sticky so it stays readable until dismissed.
        const detail = String(res?.error || '').slice(0, 240).trim()
        notify?.({
          msg: detail ? `${getT('imghost.failed')}\n${detail}` : getT('imghost.failed'),
          sticky: true
        })
      } catch (e) {
        const detail = String(e?.message || e || '').slice(0, 240).trim()
        notify?.({
          msg: detail ? `${getT('imghost.failed')}\n${detail}` : getT('imghost.failed'),
          sticky: true
        })
      }
      // Upload failed — fall through to local persistence so it isn't lost.
    }
    if (window.api.saveImage && docPath) {
      // Saved doc -> write straight into ./assets, use a relative path.
      try {
        const buf = await file.arrayBuffer()
        const res = await window.api.saveImage(docPath, name, new Uint8Array(buf))
        if (res?.ok && res.path) return res.path
      } catch {
        /* fall through */
      }
    } else if (window.api.savePaste) {
      // Unsaved doc -> park in the global paste folder and use a file:// path,
      // relocated into ./assets on first save.
      try {
        const buf = await file.arrayBuffer()
        const res = await window.api.savePaste(name, new Uint8Array(buf))
        if (res?.ok && res.url) return res.url
      } catch {
        /* fall through */
      }
    }
    return fileToDataUrl(file)
  }
}
