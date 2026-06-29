import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import {
  REVIEW_KINDS,
  getReviewMarkupDisplayParts,
  wrapReviewSelection
} from '../reviewMarkup.js'

export { REVIEW_KINDS }

const REVIEW_PLUGIN_KEY = new PluginKey('hm-review-markup')

const REVIEW_CLASS_BY_ROLE = {
  syntax: 'hm-review-syntax',
  [REVIEW_KINDS.addition]: 'hm-review-mark hm-review-add',
  [REVIEW_KINDS.deletion]: 'hm-review-mark hm-review-del',
  'substitution-old': 'hm-review-mark hm-review-del hm-review-sub-old',
  'substitution-new': 'hm-review-mark hm-review-add hm-review-sub-new',
  [REVIEW_KINDS.highlight]: 'hm-review-mark hm-review-highlight'
}

function createReviewWidget(part) {
  const widget = document.createElement('span')
  widget.contentEditable = 'false'

  if (part.role === 'comment-margin') {
    widget.className = 'hm-review-widget hm-review-margin-note'
    widget.textContent = part.label || ''
    widget.title = part.title || ''
    widget.setAttribute(
      'aria-label',
      part.title
        ? `Review comment ${part.label}: ${part.title}`
        : `Review comment ${part.label}`
    )
    return widget
  }

  widget.className = 'hm-review-widget hm-review-sub-arrow'
  widget.textContent = part.label || '->'
  widget.setAttribute('aria-hidden', 'true')
  return widget
}

function getRevealRange(state, pos, textLength) {
  const nodeStart = pos
  const nodeEnd = pos + textLength
  const { from, to } = state.selection

  if (to < nodeStart || from > nodeEnd) return undefined

  const start = Math.max(0, Math.min(textLength, from - nodeStart))
  const end = Math.max(start, Math.min(textLength, to - nodeStart))
  return { start, end }
}

export function createReviewDecorationPlugin() {
  return new Plugin({
    key: REVIEW_PLUGIN_KEY,
    props: {
      decorations(state) {
        const decorations = []
        let commentNumber = 0

        state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return true

          const revealRange = getRevealRange(state, pos, node.text.length)

          for (const part of getReviewMarkupDisplayParts(node.text, { revealRange })) {
            if (part.type === 'widget') {
              const widgetPart =
                part.role === 'comment-margin'
                  ? { ...part, label: String(++commentNumber) }
                  : part
              decorations.push(
                Decoration.widget(pos + part.pos, () => createReviewWidget(widgetPart), {
                  key: `${widgetPart.role}:${pos + part.pos}:${widgetPart.title || ''}:${widgetPart.label || ''}`,
                  side: widgetPart.role === 'comment-margin' ? 1 : -1
                })
              )
              continue
            }

            const className = REVIEW_CLASS_BY_ROLE[part.role]
            if (!className || part.end <= part.start) continue
            decorations.push(
              Decoration.inline(pos + part.start, pos + part.end, {
                class: className
              })
            )
          }

          return true
        })

        return DecorationSet.create(state.doc, decorations)
      }
    }
  })
}

export function applyReviewMarkupInView(view, kind) {
  if (!view) return { ok: false, reason: 'no-view' }

  const { from, to } = view.state.selection
  const selected = view.state.doc.textBetween(from, to, '\n')
  const result = wrapReviewSelection(selected, 0, selected.length, kind)
  if (result.error) return { ok: false, reason: result.error }

  let tr = view.state.tr.insertText(result.text, from, to)
  tr = tr.setSelection(
    TextSelection.create(
      tr.doc,
      from + result.selectionStart,
      from + result.selectionEnd
    )
  )
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return { ok: true }
}
