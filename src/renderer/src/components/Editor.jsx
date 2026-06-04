import { useEffect, useRef } from 'react'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import '@milkdown/crepe/theme/common/link-tooltip.css'

/**
 * Enhanced editor with block type conversion
 * - Selection toolbar: select text to see formatting options
 * - Slash commands: type '/' at line start to convert block type
 * - Shortcuts: Ctrl+1/2/3 for headings, Ctrl+0 for paragraph
 */
export default function Editor({ initialContent, onChange, onReady }) {
  const hostRef = useRef(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let ready = false
    let destroyed = false

    const crepe = new Crepe({
      root: host,
      defaultValue: initialContent || '',
      features: {
        [CrepeFeature.SelectionTooltip]: true,
        [CrepeFeature.SlashCommand]: true,
        [CrepeFeature.BlockEdit]: true,
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.Table]: true,
        [CrepeFeature.InlineCode]: true,
        [CrepeFeature.LinkTooltip]: true
      }
    })

    crepe
      .create()
      .then(() => {
        if (destroyed) {
          crepe.destroy()
          return
        }

        // Add keyboard shortcuts after editor is ready
        const editor = crepe.editor
        if (editor) {
          const view = editor.view
          if (view) {
            view.dom.addEventListener('keydown', (e) => {
              const { state } = view
              const { selection } = state
              const { $from } = selection

              // Ctrl+1/2/3: Convert to heading
              // Ctrl+0: Convert to paragraph
              if (e.ctrlKey || e.metaKey) {
                if (e.key === '1') {
                  e.preventDefault()
                  convertBlock(state, $from, 'heading', { level: 1 })
                  view.focus()
                } else if (e.key === '2') {
                  e.preventDefault()
                  convertBlock(state, $from, 'heading', { level: 2 })
                  view.focus()
                } else if (e.key === '3') {
                  e.preventDefault()
                  convertBlock(state, $from, 'heading', { level: 3 })
                  view.focus()
                } else if (e.key === '0') {
                  e.preventDefault()
                  convertBlock(state, $from, 'paragraph', {})
                  view.focus()
                }
              }
            })
          }
        }

        const md = crepe.getMarkdown()
        onChange?.(md, true)
        ready = true
        onReady?.(crepe, host)
      })
      .catch((err) => console.error('Crepe init failed', err))

    // Content change callback
    crepe.on((api) => {
      api.markdownUpdated((_ctx, md) => {
        if (ready) onChange?.(md, false)
      })
    })

    return () => {
      destroyed = true
      try {
        crepe.destroy()
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="editor-host" ref={hostRef} />
}

// Helper: Convert current block to different type
function convertBlock(state, $pos, typeName, attrs = {}) {
  const { tr, schema } = state
  const node = $pos.parent

  if (!node) return

  const targetType = schema.nodes[typeName]
  if (!targetType) return

  // Don't convert if same type
  if (node.type.name === typeName) {
    if (typeName === 'heading' && node.attrs.level === attrs.level) return
    if (typeName === 'paragraph') return
  }

  const pos = $pos.before($pos.depth)
  tr.setNodeMarkup(pos, targetType, attrs, node.childNodes)
  const newTr = tr.map(state.doc.mapping)
  state.doc = newTr.doc
  newTr.apply()
}
