// Smart paste for Markdown.
//
// Milkdown's default paste does NOT parse pasted Markdown source — pasting a doc
// with `#` headings / tables / blockquotes / `$$` math / ```fences lands as flat
// text. This handler turns pasted Markdown into real nodes by running it through
// Milkdown's own remark parser (the same one used when opening a file), so it
// renders with full fidelity. Scoped triggers (we only take over when the
// clipboard clearly IS Markdown, and never when pasting INTO a code block):
//   (1) raw mermaid code that starts with a diagram header → a mermaid block;
//   (2) any strong Markdown block marker (heading / fence / quote / table / list
//       / `$$` math / `---`) → parse the whole clipboard as Markdown.
// Otherwise we leave it to Milkdown (plain text, or rich HTML from a webpage).
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Slice, Fragment } from '@milkdown/prose/model'
import { startsAsMermaid } from './editor-mermaid.js'

// True if `text` contains a strong Markdown block marker (vs ordinary prose).
function looksLikeMarkdown(text) {
  if (/^#{1,6}\s/m.test(text)) return true // heading
  if (/^```/m.test(text)) return true // fenced code
  if (/^>\s/m.test(text)) return true // blockquote
  if (/^\|.*\|.*\n/m.test(text)) return true // table row
  if (/^([-*+]\s|\d+\.\s)/m.test(text)) return true // list item
  if (/\$\$/.test(text)) return true // block math
  if (/^(\*\*\*|---)\s*$/m.test(text)) return true // horizontal rule
  return false
}

export function createMdPastePlugin(parse) {
  // `parse(markdown) -> Doc | null`: runs Milkdown's remark parser on the string.
  return new Plugin({
    key: new PluginKey('hm-md-paste'),
    props: {
      handlePaste(view, event) {
        // Pasting INTO a code block should append code, not restructure. (The
        // mermaid "two diagrams in one block" mashup is handled by the split
        // plugin.)
        if (view.state.selection.$from.parent.type.name === 'code_block') return false
        const text = event.clipboardData?.getData('text/plain') || ''
        if (!text) return false
        const schema = view.state.schema

        // (1) Raw mermaid code (no fence) → a mermaid code_block.
        if (startsAsMermaid(text)) {
          const body = text.replace(/\s+$/, '')
          const node = schema.nodes.code_block.create(
            { language: 'mermaid' },
            body ? schema.text(body) : null
          )
          return insert(view, Fragment.from(node))
        }

        // (2) Markdown source → parse with Milkdown and insert the resulting nodes.
        if (looksLikeMarkdown(text)) {
          const doc = parse(text)
          if (doc && doc.content && doc.content.size > 0) {
            return insert(view, doc.content)
          }
        }

        return false
      }
    }
  })
}

// Replace the selection with a block fragment; return true on success.
function insert(view, fragment) {
  try {
    const tr = view.state.tr.replaceSelection(new Slice(fragment, 0, 0))
    tr.scrollIntoView()
    view.dispatch(tr)
    return true
  } catch {
    return false
  }
}
