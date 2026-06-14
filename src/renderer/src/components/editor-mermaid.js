// Live Mermaid rendering for ```mermaid code blocks.
//
// Crepe's CodeMirror feature owns the `code_block` node view, so we DON'T try to
// replace it. Instead a ProseMirror plugin paints a widget *decoration* right
// after each mermaid code block — the editable source stays a normal CodeMirror
// block, and the rendered diagram appears beneath it (Typora-style live preview).
// Decorations are PM's sanctioned channel for non-document DOM, so this never
// fights the editor's own DOM management.
//
// Mermaid is loaded lazily (dynamic import) only when a diagram is actually
// present, so the ~3 MB library doesn't weigh on startup for docs without one.
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'

// Rendered SVGs cached by `theme::code` so re-renders (every keystroke rebuilds
// the decoration set) reuse the previous SVG instead of re-running Mermaid, and
// light/dark variants don't clobber each other. Shared across editor instances.
const cache = new Map()
const pending = new Set()
let seq = 0
let mermaidMod = null

async function getMermaid() {
  if (mermaidMod) return mermaidMod
  const m = await import('mermaid')
  mermaidMod = m.default || m
  return mermaidMod
}

const curTheme = () => (document.body.classList.contains('dark') ? 'dark' : 'default')
const keyFor = (theme, code) => theme + '::' + code

// Render `code` to an SVG (async, cached). `refresh` re-dispatches the plugin so
// the freshly-cached SVG replaces the "rendering…" placeholder.
async function ensureRender(theme, code, refresh) {
  const k = keyFor(theme, code)
  if (cache.has(k) || pending.has(k)) return
  pending.add(k)
  const id = 'hm-mermaid-' + ++seq
  try {
    const mermaid = await getMermaid()
    // Re-initialize per render so the diagram matches the current theme.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
    const { svg } = await mermaid.render(id, code)
    cache.set(k, { svg })
  } catch (e) {
    cache.set(k, { error: (e && e.message) || String(e) })
  } finally {
    pending.delete(k)
    // Mermaid leaves a temporary element behind on syntax errors; clean it up.
    document.getElementById(id)?.remove()
    document.getElementById('d' + id)?.remove()
    refresh()
  }
}

function renderDom(code, refresh, t) {
  const wrap = document.createElement('div')
  wrap.className = 'hm-mermaid-preview'
  wrap.setAttribute('contenteditable', 'false')
  const trimmed = (code || '').trim()
  if (!trimmed) {
    wrap.classList.add('hm-mermaid-hint')
    wrap.textContent = t('mermaid.empty')
    return wrap
  }
  const theme = curTheme()
  const c = cache.get(keyFor(theme, trimmed))
  if (c && c.svg) {
    wrap.innerHTML = c.svg
  } else if (c && c.error) {
    wrap.classList.add('hm-mermaid-error')
    wrap.textContent = t('mermaid.error') + ' ' + c.error
  } else {
    wrap.classList.add('hm-mermaid-hint')
    wrap.textContent = t('mermaid.rendering')
    ensureRender(theme, trimmed, refresh)
  }
  return wrap
}

// Render status of a code, used in the decoration key so the widget DOM is
// recreated (toDOM re-runs) when the async render finishes — ProseMirror reuses a
// widget's DOM as long as its key is unchanged, so without this the "rendering…"
// placeholder would never be replaced by the finished SVG.
function statusFor(code) {
  const c = cache.get(keyFor(curTheme(), (code || '').trim()))
  if (!c) return 'wait'
  return c.svg ? 'done' : 'err'
}

function buildDecos(doc, refresh, t) {
  const decos = []
  doc.descendants((node, pos) => {
    if (
      node.type.name === 'code_block' &&
      String(node.attrs.language || '').toLowerCase() === 'mermaid'
    ) {
      const code = node.textContent
      decos.push(
        Decoration.widget(pos + node.nodeSize, () => renderDom(code, refresh, t), {
          side: 1,
          // Key changes when the source, theme, or render status changes — each of
          // which must re-run toDOM. (Same key → PM keeps the old widget DOM.)
          key: 'hm-mermaid:' + curTheme() + ':' + statusFor(code) + ':' + code
        })
      )
      return false // don't descend into the code block's text
    }
    return undefined
  })
  return DecorationSet.create(doc, decos)
}

// Build a per-editor plugin instance (the view reference it holds is per editor;
// several editor panes can be mounted at once). `getT` is the live translator.
export function createMermaidPlugin(getT) {
  const key = new PluginKey('hm-mermaid')
  const holder = {}
  const refresh = () => {
    const v = holder.view
    if (v && !v.isDestroyed) v.dispatch(v.state.tr.setMeta(key, true))
  }
  const t = (k) => (getT ? getT(k) : k)
  return new Plugin({
    key,
    state: {
      init: (_, state) => buildDecos(state.doc, refresh, t),
      apply: (tr, old, _o, newState) => {
        if (tr.docChanged || tr.getMeta(key)) return buildDecos(newState.doc, refresh, t)
        return old.map(tr.mapping, tr.doc)
      }
    },
    props: {
      decorations(state) {
        return key.getState(state)
      }
    },
    view(view) {
      holder.view = view
      // init() ran before the view existed, so diagrams present on first paint
      // never kicked off a render. Trigger one now that we can dispatch.
      Promise.resolve().then(refresh)
      return {
        destroy() {
          holder.view = null
        }
      }
    }
  })
}
