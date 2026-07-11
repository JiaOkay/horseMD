import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { iconMarkup } from './icons.jsx'
import {
  closeReviewGroupState,
  cycleReviewGroupActiveIndex,
  getReviewGroupRemovalMeta,
  mapReviewTextblockGroupState,
  normalizeReviewPluginState,
  resolveReviewGroupActiveIndex
} from './editor-review-model.js'
import { collectReviewDecorations } from './editor-review-decorations.js'
import {
  REVIEW_KINDS,
  buildReviewAiPromptForSnippet,
  makeHighlightCommentMarkup,
  removeReviewMarker,
  replaceReviewMarker,
  wrapReviewSelection
} from '../reviewMarkup.js'

export { REVIEW_KINDS }
export {
  cycleReviewGroupActiveIndex,
  getReviewGroupRemovalMeta,
  groupReviewAnnotationParts,
  mapReviewTextblockGroupState,
  parseParsedHighlightCommentClose,
  resolveReviewGroupActiveIndex
} from './editor-review-model.js'

const REVIEW_PLUGIN_KEY = new PluginKey('hm-review-markup')

function t(options, key, fallback, vars) {
  const getT = options?.getT
  let value = getT ? getT(key, fallback) : fallback
  value = !value || value === key ? fallback : value
  if (vars) {
    for (const name of Object.keys(vars)) {
      value = String(value).split(`{${name}}`).join(String(vars[name]))
    }
  }
  return value
}

function notify(options, key, fallback) {
  options?.notify?.(key, fallback)
}

function copyText(options, text, doneKey = 'review.copied', doneFallback = 'Copied') {
  options?.copyText?.(text, doneKey, doneFallback)
}

function stopWidgetMouseDown(event) {
  event.preventDefault()
  event.stopPropagation()
}

function stopWidgetEvent(event) {
  event.stopPropagation()
}

function markerForAnnotation(annotation, start = 0) {
  return {
    kind: REVIEW_KINDS.highlight,
    raw: annotation.raw,
    start,
    end: start + annotation.raw.length,
    content: {
      text: annotation.text,
      comment: annotation.comment
    }
  }
}

function getCurrentRangeText(view, annotation) {
  if (!view || !annotation) return null
  const { doc } = view.state
  if (annotation.from < 0 || annotation.to > doc.content.size || annotation.to <= annotation.from) {
    return null
  }
  return doc.textBetween(annotation.from, annotation.to, '\n')
}

function validateAnnotationRange(view, annotation) {
  const current = getCurrentRangeText(view, annotation)
  if (current == null) return false
  if (annotation.source === 'raw') return current === annotation.raw
  return current === `{${annotation.text}}{>>${annotation.comment}<<}`
}

function replaceAnnotationRange(view, annotation, replacement, reviewMeta = null) {
  if (!validateAnnotationRange(view, annotation)) return false
  let tr = view.state.tr.insertText(replacement, annotation.from, annotation.to)
  if (reviewMeta) tr = tr.setMeta(REVIEW_PLUGIN_KEY, reviewMeta)
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

function removeAnnotationMarkup(view, part, options) {
  const annotation = part.annotation
  if (!validateAnnotationRange(view, annotation)) {
    notify(options, 'review.stale', 'Review note changed')
    return false
  }

  const replacement =
    annotation.source === 'raw'
      ? removeReviewMarker(annotation.raw, markerForAnnotation(annotation))
      : annotation.text
  return replaceAnnotationRange(view, annotation, replacement, getReviewGroupRemovalMeta(part))
}

function activateReviewGroupIndex(view, part, activeIndex) {
  const annotation = part.annotations?.[activeIndex]
  if (!annotation) return

  view?.dispatch(
    view.state.tr.setMeta(REVIEW_PLUGIN_KEY, {
      type: 'activate',
      groupKey: part.groupKey,
      activeKey: annotation.key,
      activeIndex
    })
  )
}

export function buildReviewParagraphSnippet(parentText, localFrom, localTo, markup) {
  if (
    typeof parentText !== 'string' ||
    typeof markup !== 'string' ||
    !Number.isInteger(localFrom) ||
    !Number.isInteger(localTo) ||
    localFrom < 0 ||
    localTo < localFrom ||
    localTo > parentText.length
  ) {
    return null
  }

  return `${parentText.slice(0, localFrom)}${markup}${parentText.slice(localTo)}`
}

function buildParagraphSnippetFromAnnotation(view, annotation, markup) {
  try {
    const $from = view.state.doc.resolve(annotation.from)
    if (annotation.to > $from.end()) return null

    const parentText = $from.parent.textBetween(0, $from.parent.content.size, '\n')
    return buildReviewParagraphSnippet(
      parentText,
      annotation.from - $from.start(),
      annotation.to - $from.start(),
      markup
    )
  } catch {
    return null
  }
}

function renderReadMode(card, view, part, options) {
  const annotation = part.annotation
  const annotations = Array.isArray(part.annotations)
    ? part.annotations
    : annotation
      ? [annotation]
      : []
  const activeIndex = Number.isInteger(part.activeIndex)
    ? part.activeIndex
    : resolveReviewGroupActiveIndex(annotations, annotation?.key, 0)
  card.replaceChildren()

  // Global note index/total (set by the decoration) for the X/Y display +
  // cross-note navigation. Fall back to per-group for safety.
  const noteIndex = Number.isInteger(part.noteIndex) ? part.noteIndex : activeIndex + 1
  const noteTotal = Number.isInteger(part.noteTotal) ? part.noteTotal : annotations.length

  const header = document.createElement('div')
  header.className = 'hm-review-card-head'
  const number = document.createElement('span')
  number.className = 'hm-review-card-number'
  number.textContent = `${noteIndex} / ${noteTotal}`
  const title = document.createElement('span')
  title.className = 'hm-review-card-title'
  title.textContent = t(options, 'review.cardTitle', 'Review note')
  header.append(number, title)

  // Cross-note navigation: jump to the previous/next review note in document
  // order (switches openGroupKey + scrolls the note into view).
  if (noteTotal > 1) {
    const nav = document.createElement('span')
    nav.className = 'hm-review-card-nav'

    const addNavButton = (iconName, key, fallback, groupKey, pos) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'hm-review-card-nav-button'
      button.innerHTML = iconMarkup(iconName, { size: 14 })
      button.title = t(options, key, fallback)
      button.disabled = !groupKey
      button.addEventListener('mousedown', stopWidgetMouseDown)
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!groupKey) return
        view?.dispatch(
          view.state.tr.setMeta(REVIEW_PLUGIN_KEY, {
            type: 'activate',
            groupKey,
            activeKey: null,
            activeIndex: 0
          })
        )
        if (Number.isInteger(pos)) scrollEditorToPos(view, pos)
      })
      nav.appendChild(button)
    }

    addNavButton('chevron-up', 'review.previous', 'Previous', part.prevNoteKey, part.prevNotePos)
    addNavButton('chevron-down', 'review.next', 'Next', part.nextNoteKey, part.nextNotePos)
    header.appendChild(nav)
  }

  const textLabel = document.createElement('div')
  textLabel.className = 'hm-review-card-label'
  textLabel.textContent = t(options, 'review.highlightedText', 'Highlighted')
  const text = document.createElement('div')
  text.className = 'hm-review-card-text'
  text.textContent = annotation.text

  const commentLabel = document.createElement('div')
  commentLabel.className = 'hm-review-card-label'
  commentLabel.textContent = t(options, 'review.commentText', 'Comment')
  const comment = document.createElement('div')
  comment.className = 'hm-review-card-comment hm-review-card-comment-prominent'
  comment.textContent = annotation.comment

  const actions = document.createElement('div')
  actions.className = 'hm-review-card-actions'

  // Icon action buttons (with text tooltips). Pass null icon for a text button.
  const addButton = (iconName, key, fallback, onClick, className) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `hm-review-card-action${className ? ` ${className}` : ''}`
    const label = t(options, key, fallback)
    button.title = label
    if (iconName) button.innerHTML = iconMarkup(iconName, { size: 15 })
    else button.textContent = label
    button.addEventListener('mousedown', stopWidgetMouseDown)
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onClick()
    })
    actions.appendChild(button)
  }

  addButton('pencil', 'review.editMarkup', 'Edit markup', () => renderEditMode(card, view, part, options))
  addButton(
    'check',
    'review.doneMarkup',
    'Done',
    () => removeAnnotationMarkup(view, part, options),
    'hm-review-card-primary'
  )
  addButton(
    'close',
    'review.deleteMarkup',
    'Delete',
    () => removeAnnotationMarkup(view, part, options),
    'hm-review-card-action-danger'
  )
  addButton('copy', 'review.copyMarkup', 'Copy markup', () => {
    if (!validateAnnotationRange(view, annotation)) {
      notify(options, 'review.stale', 'Review note changed')
      return
    }
    copyText(options, makeHighlightCommentMarkup(annotation.text, annotation.comment))
  })
  addButton('sparkle', 'review.copyMarkupAi', 'Copy markup for AI', () => {
    if (!validateAnnotationRange(view, annotation)) {
      notify(options, 'review.stale', 'Review note changed')
      return
    }
    const markup = makeHighlightCommentMarkup(annotation.text, annotation.comment)
    copyText(options, buildReviewAiPromptForSnippet(markup, 'markup'), 'review.promptCopied', 'Review prompt copied')
  })
  addButton('file', 'review.copyParagraphAi', 'Copy paragraph for AI', () => {
    if (!validateAnnotationRange(view, annotation)) {
      notify(options, 'review.stale', 'Review note changed')
      return
    }
    const markup = makeHighlightCommentMarkup(annotation.text, annotation.comment)
    const snippet = buildParagraphSnippetFromAnnotation(view, annotation, markup)
    if (!snippet) {
      notify(options, 'review.stale', 'Review note changed')
      return
    }
    copyText(
      options,
      buildReviewAiPromptForSnippet(snippet, 'paragraph'),
      'review.promptCopied',
      'Review prompt copied'
    )
  })

  card.append(header, textLabel, text, commentLabel, comment, actions)
}

function renderEditMode(card, view, part, options) {
  const annotation = part.annotation
  card.replaceChildren()

  const header = document.createElement('div')
  header.className = 'hm-review-card-head'
  const number = document.createElement('span')
  number.className = 'hm-review-card-number'
  number.textContent = part.indexLabel || ''
  const title = document.createElement('span')
  title.className = 'hm-review-card-title'
  title.textContent = t(options, 'review.editMarkup', 'Edit markup')
  header.append(number, title)

  const textLabel = document.createElement('label')
  textLabel.className = 'hm-review-card-label'
  textLabel.textContent = t(options, 'review.highlightedText', 'Highlighted')
  const textInput = document.createElement('input')
  textInput.className = 'hm-review-card-input'
  textInput.type = 'text'
  textInput.value = annotation.text
  textLabel.appendChild(textInput)

  const commentLabel = document.createElement('label')
  commentLabel.className = 'hm-review-card-label'
  commentLabel.textContent = t(options, 'review.commentText', 'Comment')
  const commentInput = document.createElement('textarea')
  commentInput.className = 'hm-review-card-textarea'
  commentInput.rows = 3
  commentInput.value = annotation.comment
  commentLabel.appendChild(commentInput)

  ;[textInput, commentInput].forEach((field) => {
    field.addEventListener('mousedown', stopWidgetEvent)
    field.addEventListener('click', stopWidgetEvent)
    field.addEventListener('keydown', stopWidgetEvent)
    field.addEventListener('input', stopWidgetEvent)
  })

  const actions = document.createElement('div')
  actions.className = 'hm-review-card-actions'

  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'hm-review-card-action hm-review-card-primary'
  save.textContent = t(options, 'review.save', 'Save')
  save.addEventListener('mousedown', stopWidgetMouseDown)
  save.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    let replacement
    try {
      if (!textInput.value || !commentInput.value) throw new Error('empty')
      replacement =
        annotation.source === 'raw'
          ? replaceReviewMarker(
              annotation.raw,
              markerForAnnotation(annotation),
              { text: textInput.value, comment: commentInput.value }
            )
          : makeHighlightCommentMarkup(textInput.value, commentInput.value)
    } catch {
      notify(options, 'review.invalid', 'Invalid markup fields')
      return
    }
    if (!replacement) {
      notify(options, 'review.invalid', 'Invalid markup fields')
      return
    }
    if (!replaceAnnotationRange(view, annotation, replacement)) {
      notify(options, 'review.stale', 'Review note changed')
    }
  })

  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'hm-review-card-action'
  cancel.textContent = t(options, 'review.cancel', 'Cancel')
  cancel.addEventListener('mousedown', stopWidgetMouseDown)
  cancel.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    renderReadMode(card, view, part, options)
  })

  actions.append(save, cancel)
  card.append(header, textLabel, commentLabel, actions)
  textInput.focus()
  textInput.select()
}

// Scroll the editor's scroll container so the given doc position is centered.
// Used by the review card's prev/next note navigation.
function scrollEditorToPos(view, pos) {
  try {
    const coords = view.coordsAtPos(pos)
    const scroller = view.dom.closest && view.dom.closest('.editor-scroll')
    if (!scroller) return
    const sr = scroller.getBoundingClientRect()
    const targetTop = (coords.top + coords.bottom) / 2 - (sr.top + sr.bottom) / 2
    scroller.scrollTop += targetTop
  } catch {
    /* pos out of range / view tearing down */
  }
}

function createReviewWidget(part, options = {}, view) {
  const widget = document.createElement('span')
  widget.contentEditable = 'false'

  if (part.role === 'comment-stack') {
    // A stack of all the comment-margin notes on one line, anchored to the
    // right margin. Badges fan (overlap) when collapsed; CSS spreads them on
    // hover. Hovering/clicking a badge opens that note's card.
    widget.className = `hm-review-widget hm-review-margin-note hm-review-stack${part.openNote ? ' hm-review-margin-note-open' : ''}`
    const badges = document.createElement('span')
    badges.className = 'hm-review-stack-badges'
    part.notes.forEach((note, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'hm-review-note-button'
      btn.textContent = String(note.noteIndex || i + 1)
      btn.style.setProperty('--i', i)
      const open = () =>
        view?.dispatch(
          view.state.tr.setMeta(REVIEW_PLUGIN_KEY, {
            type: 'activate',
            groupKey: note.groupKey,
            activeKey: note.annotation?.key,
            activeIndex: 0
          })
        )
      btn.addEventListener('mousedown', stopWidgetMouseDown)
      btn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        open()
      })
      badges.appendChild(btn)
    })
    widget.appendChild(badges)

    // Card for the open note (if any) — reuses renderReadMode (number X/Y,
    // nav, icon actions, prominent comment).
    if (part.openNote) {
      const card = document.createElement('span')
      card.className = 'hm-review-card'
      card.setAttribute('role', 'dialog')
      card.setAttribute('aria-label', t(options, 'review.cardTitle', 'Review note'))
      card.addEventListener('mousedown', stopWidgetEvent)
      card.addEventListener('click', stopWidgetEvent)
      renderReadMode(card, view, part.openNote, options)
      widget.appendChild(card)
    }

    // Keep the card open while the pointer is over the stack/card; close on leave.
    // Also toggle an "expanded" class (not CSS :hover) to spread the badges —
    // :hover flickered when the pointer crossed gaps between circular badges.
    let closeTimer = 0
    widget.addEventListener('mouseenter', () => {
      window.clearTimeout(closeTimer)
      widget.classList.add('hm-review-stack-expanded')
    })
    widget.addEventListener('mouseleave', () => {
      widget.classList.remove('hm-review-stack-expanded')
      closeTimer = window.setTimeout(() => {
        view?.dispatch(view.state.tr.setMeta(REVIEW_PLUGIN_KEY, { type: 'close' }))
      }, 220)
    })
    return widget
  }

  if (part.role === 'comment-margin') {
    widget.className = `hm-review-widget hm-review-margin-note${part.crowded ? ' hm-review-margin-crowded' : ''}${part.open ? ' hm-review-margin-note-open' : ''}`
    widget.title = part.title || ''
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'hm-review-note-button'
    button.textContent = part.label || ''
    const noteCount = Array.isArray(part.annotations)
      ? part.annotations.length
      : Number(part.label) || 1
    button.setAttribute('aria-expanded', part.open ? 'true' : 'false')
    button.setAttribute(
      'aria-label',
      t(
        options,
        noteCount === 1 ? 'review.groupAriaLabelOne' : 'review.groupAriaLabelMany',
        noteCount === 1 ? 'Open 1 review comment' : 'Open {count} review comments',
        { count: noteCount }
      )
    )
    button.addEventListener('mousedown', stopWidgetMouseDown)
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      view?.dispatch(
        view.state.tr.setMeta(REVIEW_PLUGIN_KEY, {
          type: 'toggle',
          groupKey: part.groupKey,
          activeKey: part.annotation?.key,
          activeIndex: Number.isInteger(part.activeIndex) ? part.activeIndex : 0
        })
      )
    })
    // Hover to expand (desktop): enter the widget (button or card) opens it
    // after a short delay; leaving closes it after a delay. Timers tolerate the
    // visual gap between button and card. Click (above) still works for touch.
    let openTimer = 0
    let closeTimer = 0
    widget.addEventListener('mouseenter', () => {
      window.clearTimeout(closeTimer)
      if (part.open) return
      openTimer = window.setTimeout(() => {
        view?.dispatch(
          view.state.tr.setMeta(REVIEW_PLUGIN_KEY, {
            type: 'toggle',
            groupKey: part.groupKey,
            activeKey: part.annotation?.key,
            activeIndex: Number.isInteger(part.activeIndex) ? part.activeIndex : 0
          })
        )
      }, 120)
    })
    widget.addEventListener('mouseleave', () => {
      window.clearTimeout(openTimer)
      closeTimer = window.setTimeout(() => {
        view?.dispatch(view.state.tr.setMeta(REVIEW_PLUGIN_KEY, { type: 'close' }))
      }, 220)
    })
    widget.appendChild(button)

    if (part.open && part.annotation) {
      const card = document.createElement('span')
      card.className = 'hm-review-card'
      card.setAttribute('role', 'dialog')
      card.setAttribute('aria-label', t(options, 'review.cardTitle', 'Review note'))
      card.addEventListener('mousedown', stopWidgetEvent)
      card.addEventListener('click', stopWidgetEvent)
      renderReadMode(card, view, part, options)
      widget.appendChild(card)
    }
    return widget
  }

  if (part.role === 'substitution-replacement') {
    widget.className = 'hm-review-widget hm-review-sub-replacement'

    const oldText = document.createElement('span')
    oldText.className = 'hm-review-mark hm-review-del hm-review-sub-render-old'
    oldText.textContent = part.oldText || ''

    const arrow = document.createElement('span')
    arrow.className = 'hm-review-sub-arrow'
    arrow.textContent = '->'
    arrow.setAttribute('aria-hidden', 'true')

    const newText = document.createElement('span')
    newText.className = 'hm-review-mark hm-review-add hm-review-sub-render-new'
    newText.textContent = part.newText || ''

    widget.append(oldText, arrow, newText)
    widget.setAttribute(
      'aria-label',
      `Review substitution: ${part.oldText || ''} to ${part.newText || ''}`
    )
    return widget
  }

  widget.className = 'hm-review-widget hm-review-sub-arrow'
  widget.textContent = part.label || '->'
  widget.setAttribute('aria-hidden', 'true')
  return widget
}

function addActiveAnnotationDecoration(decorations, annotation) {
  if (!annotation?.text) return
  const from = annotation.source === 'raw' ? annotation.from + 3 : annotation.from + 1
  const to = from + annotation.text.length
  if (to <= from) return
  decorations.push(
    Decoration.inline(from, to, {
      class: 'hm-review-mark-active'
    })
  )
}

export function createReviewDecorationPlugin(options = {}) {
  return new Plugin({
    key: REVIEW_PLUGIN_KEY,
    state: {
      init() {
        return closeReviewGroupState()
      },
      apply(tr, pluginState) {
        const meta = tr.getMeta(REVIEW_PLUGIN_KEY)
        const state = normalizeReviewPluginState(pluginState)
        if (meta?.type === 'toggle') {
          if (state.openGroupKey === meta.groupKey) {
            return closeReviewGroupState()
          }

          return {
            openGroupKey: meta.groupKey || null,
            activeKey: meta.activeKey || null,
            activeIndex: Number.isInteger(meta.activeIndex) ? meta.activeIndex : 0
          }
        }
        if (meta?.type === 'activate') {
          return {
            openGroupKey: meta.groupKey || state.openGroupKey,
            activeKey: meta.activeKey || null,
            activeIndex: Number.isInteger(meta.activeIndex) ? meta.activeIndex : state.activeIndex
          }
        }
        if (meta?.type === 'close') return closeReviewGroupState()
        if (meta) return state
        if (tr.docChanged) {
          return mapReviewTextblockGroupState(state, tr.mapping, tr.doc.content.size)
        }
        return state
      }
    },
    props: {
      // A mousedown anywhere in the editor that isn't on the margin-note button
      // or the card itself closes any open review card. Using handleDOMEvents
      // (not handleClick) so it fires reliably for every editor click — headings,
      // paragraphs, code, etc. — not just position-mapped text clicks.
      handleDOMEvents: {
        mousedown(view, event) {
          if (event?.target?.closest?.('.hm-review-note-button, .hm-review-card')) return false
          const st = REVIEW_PLUGIN_KEY.getState(view.state)
          if (st?.openGroupKey) {
            view.dispatch(view.state.tr.setMeta(REVIEW_PLUGIN_KEY, { type: 'close' }))
          }
          return false
        }
      },
      decorations(state) {
        const pluginState = REVIEW_PLUGIN_KEY.getState(state) || closeReviewGroupState()
        const { decorations, widgetList } = collectReviewDecorations(state, pluginState)

        // Global note list (for X/Y numbering + cross-note prev/next nav).
        // widgetList is already sorted by pos, so comment-margin widgets here
        // are in document order.
        const notes = widgetList.filter((w) => w.part?.role === 'comment-margin' && w.part.groupKey)
        const noteTotal = notes.length
        notes.forEach((w, i) => {
          const prev = i > 0 ? notes[i - 1] : null
          const next = i < notes.length - 1 ? notes[i + 1] : null
          w.part.noteIndex = i + 1
          w.part.noteTotal = noteTotal
          w.part.prevNoteKey = prev ? prev.part.groupKey : null
          w.part.nextNoteKey = next ? next.part.groupKey : null
          w.part.prevNotePos = prev ? prev.pos : null
          w.part.nextNotePos = next ? next.pos : null
        })

        // Group comment-margin notes by paragraph (textblock) → render ONE
        // stack widget per paragraph (all the line's badges in one container,
        // fanned + hover-expandable) instead of one widget per note. A single
        // note is just a stack of 1 (same right-margin look as before).
        const stacksByParent = new Map()
        for (const item of widgetList) {
          if (item.part?.role !== 'comment-margin') continue
          let parentStart = item.pos
          try {
            const $pos = state.doc.resolve(item.pos)
            parentStart = $pos.start($pos.depth)
          } catch { /* fallback to pos */ }
          if (!stacksByParent.has(parentStart)) stacksByParent.set(parentStart, [])
          stacksByParent.get(parentStart).push(item)
        }

        // Non-comment-margin parts (substitution etc.): one widget each, unchanged.
        widgetList.forEach(({ pos, part }) => {
          if (part.role === 'comment-margin') return // rendered as a stack below
          decorations.push(
            Decoration.widget(pos, (view) => createReviewWidget(part, options, view), {
              key: `${part.role}:${pos}:${part.groupKey || part.title || ''}`,
              side: -1,
              marks: [],
              stopEvent: (event) => Boolean(event.target?.closest?.('.hm-review-card, .hm-review-note-button'))
            })
          )
        })

        // One stack widget per paragraph (positioned at the paragraph's last note).
        for (const [parentStart, items] of stacksByParent) {
          const last = items[items.length - 1]
          const stackNotes = items.map((it) => it.part)
          const openNote = stackNotes.find((n) => n.open) || null
          if (openNote?.annotation) addActiveAnnotationDecoration(decorations, openNote.annotation)
          const stackPart = { role: 'comment-stack', notes: stackNotes, openNote, groupKey: stackNotes[0]?.groupKey }
          decorations.push(
            Decoration.widget(last.pos, (view) => createReviewWidget(stackPart, options, view), {
              key:
                `comment-stack:${parentStart}:${stackNotes.length}:` +
                `${openNote?.groupKey || 'closed'}:${stackNotes.map((n) => n.noteIndex ?? '').join(',')}`,
              side: 1,
              marks: [],
              stopEvent: (event) =>
                Boolean(event.target?.closest?.('.hm-review-card, .hm-review-note-button, .hm-review-stack'))
            })
          )
        }

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
