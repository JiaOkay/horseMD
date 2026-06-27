// Smart paste for fenced code blocks (e.g. ```mermaid … ```).
//
// Milkdown's default paste does NOT parse pasted Markdown fences — pasting a
// ```mermaid block mangles it (the fence peels off its content: stray text + an
// empty block). This handler detects a complete ```…``` fence on the clipboard
// (when NOT pasting into a code block — there you want to append) and turns it
// into real code_block nodes, so pasted diagrams render. Surrounding text
// becomes paragraphs. Scoped to "clipboard has at least two ``` lines" to avoid
// hijacking ordinary text that merely mentions a backtick fence.
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Slice, Fragment } from '@milkdown/prose/model'
import { startsAsMermaid } from './editor-mermaid.js'

const FENCE_OPEN = /^```([\w+#.-]*)\s*$/
const FENCE_CLOSE = /^```\s*$/

// Turn clipboard text into block nodes: code_block for each ```…``` fence,
// paragraph for the text between (single newlines → spaces).
function buildNodes(text, schema) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const nodes = []
  const para = []
  const flushPara = () => {
    if (!para.length) return
    para
      .join('\n')
      .split(/\n{2,}/)
      .forEach((block) => {
        const t = block.replace(/\n/g, ' ').trim()
        if (t) {
          try {
            nodes.push(schema.nodes.paragraph.create(null, schema.text(t)))
          } catch {
            /* skip a paragraph that doesn't validate */
          }
        }
      })
    para.length = 0
  }

  for (let i = 0; i < lines.length; ) {
    const m = lines[i].match(FENCE_OPEN)
    if (m) {
      flushPara()
      const language = m[1] || ''
      i += 1
      const code = []
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1 // consume the closing ```
      const body = code.join('\n')
      try {
        // code_block is `code: true`, so its text may contain newlines.
        nodes.push(schema.nodes.code_block.create({ language }, body ? schema.text(body) : null))
      } catch {
        /* skip a block that doesn't validate */
      }
    } else {
      para.push(lines[i])
      i += 1
    }
  }
  flushPara()
  return nodes
}

export function createMdPastePlugin() {
  return new Plugin({
    key: new PluginKey('hm-md-paste'),
    props: {
      handlePaste(view, event) {
        // Pasting INTO a code block should append code, not split into nodes.
        // (The mermaid "two diagrams in one block" mashup is handled separately
        // by the split plugin.)
        if (view.state.selection.$from.parent.type.name === 'code_block') return false
        const text = event.clipboardData?.getData('text/plain') || ''
        const schema = view.state.schema

        // (1) Pasted raw mermaid code (starts with a diagram header, e.g.
        // `flowchart TD` / `sequenceDiagram`) → a mermaid code_block, so it
        // renders instead of becoming plain text.
        if (startsAsMermaid(text)) {
          const body = text.replace(/\s+$/, '')
          const node = schema.nodes.code_block.create(
            { language: 'mermaid' },
            body ? schema.text(body) : null
          )
          const tr = view.state.tr.replaceSelection(new Slice(Fragment.from(node), 0, 0))
          tr.scrollIntoView()
          view.dispatch(tr)
          return true
        }

        // (2) A complete ```…``` fence on the clipboard → code_block nodes.
        const fenceLines = text.split('\n').filter((l) => FENCE_OPEN.test(l) || FENCE_CLOSE.test(l)).length
        if (fenceLines < 2) return false
        const nodes = buildNodes(text, schema)
        if (!nodes.length) return false
        const tr = view.state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0))
        tr.scrollIntoView()
        view.dispatch(tr)
        return true
      }
    }
  })
}
