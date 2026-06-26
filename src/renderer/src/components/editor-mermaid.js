// Live Mermaid rendering for ```mermaid code blocks, with a collapsible source —
// like LaTeX, the rendered diagram shows by default and the code is hidden until
// you click to edit it.
//
// Crepe's CodeMirror feature owns the `code_block` node view, so we DON'T replace
// it. Instead:
//   - a widget decoration after each mermaid block paints the rendered diagram
//     (plus a small toggle);
//   - a node decoration adds `hm-mermaid-collapsed` to the code block when the
//     source is hidden, so CSS hides the CodeMirror editor.
// Decorations are PM's sanctioned channel for non-document DOM, so this never
// fights the editor's own DOM management. Mermaid is loaded lazily (dynamic
// import) only when a diagram is present.
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'

// Rendered SVGs cached by `theme::code` so re-renders (every keystroke rebuilds
// the decoration set) reuse the previous SVG instead of re-running Mermaid, and
// light/dark variants don't clobber each other. Shared across editor instances.
const cache = new Map()
const pending = new Set()
const retried = new Set() // keys whose first render errored and get a one-shot retry
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
// the freshly-cached SVG replaces the "rendering…" placeholder. The FIRST render
// right after the lazy import can race with Mermaid's own init and fail — so on
// error we retry once before caching the error (otherwise a flaky first render
// stuck the block on "rendering…" until the source changed).
async function ensureRender(theme, code, refresh) {
  const k = keyFor(theme, code)
  if (cache.has(k) || pending.has(k)) return
  pending.add(k)
  const id = 'hm-mermaid-' + ++seq
  let result = null
  try {
    const mermaid = await getMermaid()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
    const { svg } = await mermaid.render(id, code)
    result = { svg }
    retried.delete(k)
  } catch (e) {
    if (!retried.has(k)) {
      retried.add(k)
      pending.delete(k)
      document.getElementById(id)?.remove()
      document.getElementById('d' + id)?.remove()
      setTimeout(refresh, 300)
      return
    }
    result = { error: (e && e.message) || String(e) }
    retried.delete(k)
  } finally {
    if (result) cache.set(k, result)
    pending.delete(k)
    document.getElementById(id)?.remove()
    document.getElementById('d' + id)?.remove()
    refresh()
  }
}

function diagramDom(code, refresh, t) {
  const wrap = document.createElement('div')
  wrap.className = 'hm-mermaid-diagram'
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

// Render status of a code, used in the widget key so the widget DOM is recreated
// when the async render finishes (PM reuses a widget's DOM while its key is
// unchanged, so without this the "rendering…" placeholder would never update).
function statusFor(code) {
  const c = cache.get(keyFor(curTheme(), (code || '').trim()))
  if (!c) return 'wait'
  return c.svg ? 'done' : 'err'
}

function isMermaidBlock(node) {
  return (
    node.type.name === 'code_block' &&
    String(node.attrs.language || '').toLowerCase() === 'mermaid'
  )
}

// Build the decoration set + the per-block toggle widget. `expanded` is a Set of
// block-start positions whose source is shown (default: collapsed/hidden).
function buildDecos(doc, expanded, refresh, t) {
  const decos = []
  doc.descendants((node, pos) => {
    if (!isMermaidBlock(node)) return undefined
    const code = node.textContent
    const isOpen = expanded.has(pos)

    // Hide the CodeMirror source when collapsed.
    if (!isOpen) {
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, { class: 'hm-mermaid-collapsed' })
      )
    }

    // The widget (diagram + toggle) right after the block.
    decos.push(
      Decoration.widget(
        pos + node.nodeSize,
        () => {
          const card = document.createElement('div')
          card.className = 'hm-mermaid-preview' + (isOpen ? ' expanded' : ' collapsed')
          card.setAttribute('contenteditable', 'false')

          const bar = document.createElement('div')
          bar.className = 'hm-mermaid-bar'
          const toggle = document.createElement('button')
          toggle.type = 'button'
          toggle.className = 'hm-mermaid-toggle'
          toggle.textContent = isOpen ? t('mermaid.hideCode') : t('mermaid.editCode')
          // Toggle this block's expanded state. `pos` is closed over from the
          // current build; PM recreates the widget when the doc changes, so it
          // stays valid until the next rebuild.
          toggle.addEventListener('mousedown', (e) => e.preventDefault())
          toggle.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            const v = refresh._view
            if (v && !v.isDestroyed) {
              v.dispatch(v.state.tr.setMeta(toggleKey, pos))
            }
          })
          bar.appendChild(toggle)
          card.appendChild(bar)
          card.appendChild(diagramDom(code, refresh, t))
          return card
        },
        {
          side: 1,
          key:
            'hm-mermaid:' + curTheme() + ':' + statusFor(code) + ':' + (isOpen ? 'o' : 'c') + ':' + code
        }
      )
    )
    return false // don't descend into the code block's text
  })
  return DecorationSet.create(doc, decos)
}

const renderKey = new PluginKey('hm-mermaid')
const toggleKey = new PluginKey('hm-mermaid-toggle')

// Build a per-editor plugin instance (the view reference it holds is per editor;
// several editor panes can be mounted at once). `getT` is the live translator.
export function createMermaidPlugin(getT) {
  const holder = {}
  const refresh = () => {
    const v = holder.view
    if (v && !v.isDestroyed) v.dispatch(v.state.tr.setMeta(renderKey, true))
  }
  refresh._view = null
  const t = (k) => (getT ? getT(k) : k)
  return new Plugin({
    key: renderKey,
    state: {
      init: (_, state) => ({ decos: buildDecos(state.doc, new Set(), refresh, t), expanded: new Set() }),
      apply: (tr, value, _oldState, newState) => {
        // Map expanded block positions through this transaction.
        let expanded = value.expanded
        const togglePos = tr.getMeta(toggleKey)
        const renderTick = tr.getMeta(renderKey)
        if (tr.docChanged) {
          expanded = new Set()
          for (const p of value.expanded) {
            const mapped = tr.mapping.map(p)
            // Keep only positions that still start a mermaid block.
            const node = newState.doc.nodeAt(mapped)
            if (node && isMermaidBlock(node)) expanded.add(mapped)
          }
        }
        if (togglePos !== undefined) {
          expanded = new Set(expanded)
          if (expanded.has(togglePos)) expanded.delete(togglePos)
          else expanded.add(togglePos)
        }
        if (tr.docChanged || togglePos !== undefined || renderTick) {
          return { decos: buildDecos(newState.doc, expanded, refresh, t), expanded }
        }
        return { decos: value.decos.map(tr.mapping, tr.doc), expanded }
      }
    },
    props: {
      decorations(state) {
        return renderKey.getState(state)?.decos
      }
    },
    view(view) {
      holder.view = view
      refresh._view = view
      // init() ran before the view existed, so diagrams present on first paint
      // never kicked off a render. Trigger one now that we can dispatch.
      Promise.resolve().then(refresh)
      return {
        destroy() {
          holder.view = null
          refresh._view = null
        }
      }
    }
  })
}
