// Mode-switch anchors for rich↔source (#28 scroll / #41 caret).
//
// Two INDEPENDENT anchors, each restored without the other fighting it:
//   - CARET   : the text the caret sits on (capture → restore the selection).
//   - VIEWPORT: the text at the top of the scroll area (capture → restore the
//               scrollTop). This is the user's READING position, which is NOT
//               the caret when the user scrolled away to read.
//
// Why two anchors: a single caret anchor + scrollIntoView (the v0.5.25 root
// fix) yanked the viewport to the caret, so VIEWING with the caret off-screen
// made the content jump ("内容漂移"). The earlier #28 dual system fought itself
// because its SCROLL anchor was a coarse heading/ratio while the CARET anchor
// was a precise snippet — they landed on different spots. Here BOTH anchors are
// precise snippets, and they never interact: the caret restore only sets the
// selection (no scroll), the viewport restore only sets scrollTop. Order in the
// caller: caret first, then viewport (so the viewport scroll wins outright).
//
// The primary caret coordinate is a GLOBAL VISIBLE-CHAR index: markdown syntax
// is stripped on the source side, and PM text nodes are counted on the rich side.
// That avoids using text snippets as the normal path, so repeated words do not
// confuse caret restore. Snippets/context remain only as a fallback for parser
// edge cases where the visible streams cannot be aligned exactly.
import { TextSelection } from '@milkdown/prose/state'

const SNIPPET_LEN = 24 // ~24 visible chars: long enough to be unique, short enough to stay in-block
const VIEWPORT_LEN = 24

// ATX headings in raw markdown: `^#{1,6}\s+text$` at line start. Used by the
// source-mode outline (#40), the source heading jump, and the caret anchors.
// Constructed fresh inside parseSourceHeadings (not a module-level `g`-flag
// regex) so a stateful `lastIndex` can never leak between calls. (Source-mode
// regex can't see inside fenced code blocks — a `#` comment there is a false
// positive, same limit the source anchor always had; rich mode uses the DOM.)
export function parseSourceHeadings(md) {
  if (!md) return []
  const out = []
  const re = /^(#{1,6})[ \t]+(.+)$/gm
  let m
  while ((m = re.exec(md)) !== null) {
    out.push({ level: m[1].length, text: m[2].trim(), charOffset: m.index })
  }
  return out
}

// Scroll the SOURCE textarea to a heading by text (via char-ratio). Used by the
// source-mode outline jump (#40). Returns true on success.
export function scrollSourceToHeading(textarea, md, text) {
  if (!textarea || !md || !text) return false
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^#{1,6}\\s+${escaped}$`, 'm')
  const m = re.exec(md)
  if (!m) return false
  const denom = textarea.scrollHeight - textarea.clientHeight
  if (denom > 0) textarea.scrollTop = (m.index / md.length) * denom
  return true
}

// --------------------------- shared snippet matching ---------------------------

// Strip markdown syntax so a SOURCE-side snippet matches the rich doc's visible
// text (which has no link/emphasis/code/heading syntax). ORDER MATTERS: strip
// structural markers (heading/blockquote/list) BEFORE emphasis — otherwise the
// emphasis `\*` eats a bullet-list `*` first and leaves the trailing space.
const stripMdForSnippet = (s) => s
  .replace(/^\s{0,3}#{1,6}\s*/gm, '')         // heading markers
  .replace(/^\s{0,3}>\s?/gm, '')              // blockquote markers
  .replace(/^\s{0,3}[-*+]\s+/gm, '')          // bullet list markers
  .replace(/^\s{0,3}\d+\.\s+/gm, '')          // ordered list markers
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // image ![alt](url) → alt
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // link [text](url) → text
  .replace(/```[\s\S]*?```/g, '')            // fenced code blocks
  .replace(/[`]+/g, '')                       // inline code backticks
  .replace(/\*\*|__|~~|\*|_/g, '')            // emphasis (after markers, so it
                                              // can't swallow a bullet `*`)

// All PM-position spans where `snippet` occurs in the doc's visible text. Walks
// the text nodes once, then indexOf-loops over the joined chars. [] if absent.
const visibleOccurrences = (doc, snippet) => {
  if (!snippet) return []
  let chars = ''
  const starts = [] // starts[i] = PM position of visible char i
  doc.descendants((node, pos) => {
    if (node.isText) {
      const t = node.text
      for (let i = 0; i < t.length; i++) { starts.push(pos + i); chars += t[i] }
      return false
    }
    return true
  })
  const out = []
  let from = 0
  for (;;) {
    const idx = chars.indexOf(snippet, from)
    if (idx < 0) break
    out.push({ start: starts[idx], end: starts[idx + snippet.length - 1] + 1 })
    from = idx + 1 // overlap-by-one so adjacent repeats each match
  }
  return out
}

// First PM position (snippet START) nearest `nearestTo` — used by the caret
// restore (caret = snippetStart + snipOff) and the viewport restore (the
// snippet's start goes to the top). Falls back to the FIRST occurrence when no
// hint is given.
const posAtText = (doc, snippet, nearestTo = -1) => {
  const occ = visibleOccurrences(doc, snippet)
  if (!occ.length) return -1
  if (nearestTo < 0) return occ[0].start
  let best = occ[0]
  let bd = Infinity
  for (const o of occ) {
    const d = Math.abs(o.start - nearestTo)
    if (d < bd) { bd = d; best = o }
  }
  return best.start
}

// Char index of the `needle` occurrence in `hay` nearest `nearestTo` (last one
// when no hint). Source-side twin of posAtText for the textarea.
const nearestIndexOf = (hay, needle, nearestTo = -1) => {
  if (!needle) return -1
  const occ = []
  let from = 0
  for (;;) {
    const i = hay.indexOf(needle, from)
    if (i < 0) break
    occ.push(i)
    from = i + 1
  }
  if (!occ.length) return -1
  if (nearestTo < 0) return occ[occ.length - 1]
  let best = occ[0]
  let bd = Infinity
  for (const o of occ) {
    const d = Math.abs(o - nearestTo)
    if (d < bd) { bd = d; best = o }
  }
  return best
}

const appendInlineVisible = (out, raw, base = 0) => {
  let i = 0
  const push = (ch, rawIndex) => {
    out.text += ch
    out.map.push(rawIndex)
  }
  while (i < raw.length) {
    if (raw.startsWith('![', i)) {
      const close = raw.indexOf(']', i + 2)
      if (close >= 0 && raw[close + 1] === '(') {
        const end = raw.indexOf(')', close + 2)
        if (end >= 0) {
          for (let j = i + 2; j < close; j++) push(raw[j], base + j)
          i = end + 1
          continue
        }
      }
    }
    if (raw[i] === '[') {
      const close = raw.indexOf(']', i + 1)
      if (close >= 0 && raw[close + 1] === '(') {
        const end = raw.indexOf(')', close + 2)
        if (end >= 0) {
          for (let j = i + 1; j < close; j++) push(raw[j], base + j)
          i = end + 1
          continue
        }
      }
    }
    if (raw[i] === '`') {
      i++
      continue
    }
    if (raw[i] === '<') {
      const end = raw.indexOf('>', i + 1)
      if (end >= 0) {
        i = end + 1
        continue
      }
    }
    if ((raw[i] === '*' || raw[i] === '_' || raw[i] === '~') && raw[i + 1] === raw[i]) {
      i += 2
      continue
    }
    if (raw[i] === '*' || raw[i] === '_' || raw[i] === '~') {
      i++
      continue
    }
    push(raw[i], base + i)
    i++
  }
}

const appendRawVisible = (out, raw, base = 0) => {
  for (let i = 0; i < raw.length; i++) {
    out.text += raw[i]
    out.map.push(base + i)
  }
}

// Markdown source does not have the same text stream as ProseMirror: table pipes,
// heading hashes, list markers, link URLs and emphasis markers exist only in
// source. Build a lightweight "visible source text" buffer plus a visible-char →
// raw-char map so a rich caret snippet can land on the textarea char that renders
// that same visible text.
const sourceVisibleIndex = (md) => {
  const out = { text: '', map: [] }
  if (!md) return out
  const lines = md.split(/(\n)/)
  let rawPos = 0
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '\n') {
      if (inFence) {
        out.text += line
        out.map.push(rawPos)
      }
      rawPos += 1
      continue
    }
    const lineStart = rawPos
    rawPos += line.length
    const fence = line.match(/^\s*(```|~~~)/)
    if (fence) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      appendRawVisible(out, line, lineStart)
      continue
    }
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) continue
    const tableLike = /^\s*\|.*\|\s*$/.test(line)
    if (tableLike) {
      let cursor = 0
      const cells = line.split('|')
      for (const cell of cells) {
        const cellRawStart = cursor
        cursor += cell.length + 1
        const leading = cell.match(/^\s*/)?.[0].length || 0
        const trailing = cell.match(/\s*$/)?.[0].length || 0
        const core = cell.slice(leading, Math.max(leading, cell.length - trailing))
        if (core) appendInlineVisible(out, core, lineStart + cellRawStart + leading)
      }
      continue
    }
    const marker = line.match(/^(\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+))/)
    const offset = marker ? marker[0].length : 0
    appendInlineVisible(out, line.slice(offset), lineStart + offset)
  }
  return out
}

const visibleSourcePosition = (md, snippet, snipOff = 0, nearestTo = -1) => {
  if (!md || !snippet) return -1
  const idx = sourceVisibleIndex(md)
  const occ = []
  let from = 0
  for (;;) {
    const i = idx.text.indexOf(snippet, from)
    if (i < 0) break
    const rawStart = idx.map[i]
    const rawTarget = idx.map[Math.min(i + snipOff, idx.map.length - 1)]
    if (rawStart != null && rawTarget != null) occ.push({ rawStart, rawTarget })
    from = i + 1
  }
  if (!occ.length) return -1
  let best = occ[0]
  let bd = Infinity
  for (const o of occ) {
    const d = nearestTo >= 0 ? Math.abs(o.rawStart - nearestTo) : 0
    if (d < bd) { bd = d; best = o }
  }
  return best.rawTarget
}

const sourceVisiblePositionAtRaw = (md, rawPos) => {
  const idx = sourceVisibleIndex(md)
  const map = idx.map
  if (!map.length) return { visibleIndex: 0, visibleAffinity: 'forward' }
  const raw = Math.max(0, Math.min(rawPos || 0, md.length))
  let lo = 0
  let hi = map.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (map[mid] < raw) lo = mid + 1
    else hi = mid
  }
  return {
    visibleIndex: lo,
    visibleAffinity: map[lo] === raw ? 'forward' : 'backward'
  }
}

const sourceRawFromVisibleIndex = (md, visibleIndex, affinity = 'forward') => {
  const idx = sourceVisibleIndex(md)
  const map = idx.map
  if (!map.length) return 0
  const v = Math.max(0, Math.min(Math.round(visibleIndex || 0), map.length))
  if (affinity === 'backward' && v > 0) return Math.min(md.length, map[v - 1] + 1)
  if (v < map.length) return map[v]
  return Math.min(md.length, map[map.length - 1] + 1)
}

const richVisiblePositionAtPos = (doc, pmPos) => {
  let acc = 0
  let found = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isText) return true
    const len = node.text.length
    if (pmPos <= pos) {
      found = { visibleIndex: acc, visibleAffinity: 'forward' }
    } else if (pmPos < pos + len) {
      found = { visibleIndex: acc + (pmPos - pos), visibleAffinity: 'forward' }
    } else if (pmPos === pos + len) {
      found = { visibleIndex: acc + len, visibleAffinity: 'backward' }
    }
    acc += len
    return false
  })
  return found || { visibleIndex: acc, visibleAffinity: 'backward' }
}

const richDomVisiblePositionAtSelection = (view) => {
  try {
    const root = view?.dom
    const doc = root?.ownerDocument
    const win = doc?.defaultView
    const sel = doc?.getSelection?.()
    if (!root || !doc || !win || !sel || !sel.rangeCount || !sel.isCollapsed || !root.contains(sel.anchorNode)) return null
    const cm = sel.anchorNode.nodeType === 1
      ? sel.anchorNode.closest?.('.cm-editor')
      : sel.anchorNode.parentElement?.closest?.('.cm-editor')
    if (!cm) return null
    const codeBlock = cm.closest('.milkdown-code-block')
    if (!codeBlock) return null
    const textOffsetIn = (container, target, targetOffset) => {
      const walker = doc.createTreeWalker(container, win.NodeFilter.SHOW_TEXT)
      let offset = 0
      let node
      while ((node = walker.nextNode())) {
        if (node === target) return offset + Math.max(0, Math.min(targetOffset || 0, node.nodeValue.length))
        offset += node.nodeValue.length
      }
      return offset
    }
    const lines = [...cm.querySelectorAll('.cm-content .cm-line')]
    let local = 0
    let found = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.contains(sel.anchorNode)) {
        local += textOffsetIn(line, sel.anchorNode, sel.anchorOffset)
        found = true
        break
      }
      local += line.textContent.length
      if (i < lines.length - 1) local += 1
    }
    if (!found) return null
    const blockPos = view.posAtDOM(codeBlock, 0)
    const base = richVisiblePositionAtPos(view.state.doc, blockPos + 1)
    return { visibleIndex: base.visibleIndex + local, visibleAffinity: 'forward' }
  } catch {
    return null
  }
}

const richPointerVisiblePosition = (view) => {
  try {
    const pointer = view?.dom?.__horsemdLastPointerDown
    if (!pointer || Date.now() - pointer.at > 2500) return null
    const doc = view.dom.ownerDocument
    const hit = doc.elementFromPoint(pointer.left, pointer.top)
    if (!hit || !view.dom.contains(hit)) return null
    if (!hit.closest?.('td,th')) return null
    const at = view.posAtCoords({ left: pointer.left, top: pointer.top })
    if (!at || !Number.isFinite(at.pos)) return null
    return richVisiblePositionAtPos(view.state.doc, at.pos)
  } catch {
    return null
  }
}

const richPosFromVisibleIndex = (doc, visibleIndex, affinity = 'forward') => {
  const v = Math.max(0, Math.round(visibleIndex || 0))
  let acc = 0
  let fallback = 1
  let target = null
  doc.descendants((node, pos) => {
    if (target != null) return false
    if (!node.isText) return true
    const len = node.text.length
    if (v < acc + len) {
      target = pos + (v - acc)
    } else if (v === acc + len) {
      if (affinity === 'forward') {
        fallback = pos + len
      } else {
        target = pos + len
      }
    }
    acc += len
    fallback = pos + len
    return false
  })
  return target != null ? target : fallback
}

// ---------------------------------- #41 caret ----------------------------------
// Capture/restore the CARET across rich↔source. Two strategies, picked by whether
// the caret was VISIBLE at toggle time (isRichCaretVisible / isSourceCaretVisible):
//   - caret visible (user was editing): restore the caret AND follow it —
//     scrollIntoView + focus (rich) / focus-scroll (source). The viewport goes to
//     the caret; the caret stays where the user was typing.
//   - caret off-screen (user was reading): restore the caret selection WITHOUT
//     scrolling/focusing; the viewport anchor owns scroll. (A focus here would
//     async-scroll to the off-screen caret and drift on large docs.)
// Anchor order on restore: visible-char index → context/snippet fallback →
// heading → ratio.

// Is the rich caret inside the scroller's visible viewport? (PM coordsAtPos.)
// This is the "was the user editing or reading" signal: a visible caret means
// the user just placed it to type; an off-screen caret means they scrolled away
// to read.
export function isRichCaretVisible(view, scroller) {
  if (!view || !scroller) return false
  const sr = scroller.getBoundingClientRect()
  try {
    const c = view.coordsAtPos(view.state.selection.head)
    if (c.bottom > sr.top + 4 && c.top < sr.bottom - 4) return true
  } catch {
    /* fall through to DOM fallback */
  }
  try {
    const at = view.domAtPos(view.state.selection.head)
    const base = at.node.nodeType === 1 ? at.node : at.node.parentElement
    const el = base?.closest?.('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre')
    if (el && view.dom.contains(el)) {
      const er = el.getBoundingClientRect()
      if (er.bottom > sr.top + 4 && er.top < sr.bottom - 4) return true
    }
  } catch {
    /* fall through to DOM selection fallback */
  }
  try {
    const sel = scroller.ownerDocument.getSelection()
    if (!sel || !sel.rangeCount || !view.dom.contains(sel.anchorNode)) return false
    const range = sel.getRangeAt(0)
    const rects = Array.from(range.getClientRects())
    const rect = rects.find((r) => r.height > 0 && r.width >= 0)
    if (rect && rect.bottom > sr.top + 4 && rect.top < sr.bottom - 4) return true
    const el = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest?.('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre')
    if (!el || !view.dom.contains(el)) return false
    const er = el.getBoundingClientRect()
    return er.bottom > sr.top + 4 && er.top < sr.bottom - 4
  } catch { return false }
}

// The pixel Y (content-top relative, incl. padding) of a source char, via a
// single-point mirror div (same idea as editor-source-caret.js). Single-point,
// so the textarea's scrollbar-reduced wrapping width doesn't compound the way a
// full-doc mirror would.
const sourceCaretY = (textarea, charIdx) => {
  const doc = textarea.ownerDocument
  const cs = doc.defaultView.getComputedStyle(textarea)
  const STYLES = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
    'line-height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-left-width', 'box-sizing', 'white-space',
    'word-wrap', 'word-break', 'overflow-wrap', 'tab-size', 'text-indent', 'width'
  ]
  let css = ''
  for (const k of STYLES) css += `${k}:${cs.getPropertyValue(k)};`
  css += 'position:absolute;visibility:hidden;white-space:pre-wrap;top:0;left:0;'
  const m = doc.createElement('div')
  m.style.cssText = css
  m.textContent = (textarea.value || '').slice(0, charIdx)
  const marker = doc.createElement('span')
  marker.textContent = '​'
  m.appendChild(marker)
  doc.body.appendChild(m)
  let y = -1
  try { y = marker.getBoundingClientRect().top - m.getBoundingClientRect().top } catch {}
  m.remove()
  return y
}

// Is the source caret inside the textarea's visible viewport? (single-point
// mirror Y vs scrollTop range.) Conservative: on any measurement failure, treat
// as visible (follow the caret) so editing isn't disrupted.
export function isSourceCaretVisible(textarea) {
  if (!textarea) return true
  try {
    const y = sourceCaretY(textarea, textarea.selectionStart)
    if (y < 0) return true
    return y >= textarea.scrollTop && y <= textarea.scrollTop + textarea.clientHeight
  } catch { return true }
}

// Build a { snippet, snipOff } caret anchor for the current textblock, where
// snipOff = the caret's visible-char offset from the snippet START.
//   - Short block (≤ SNIPPET_LEN, e.g. a table cell "九十五" or a heading):
//     snippet = the FULL block text — unique enough to pick the right cell, so a
//     short snippet like "九" no longer collides with the "九" in "九十分".
//   - Long block (a paragraph): snippet = the ≤ SNIPPET_LEN chars immediately
//     before the caret within the block; snipOff = snippet.length (caret lands
//     right after it). Within one block the visible text is identical in both
//     modes, so it matches verbatim even past a URL link / code span.
const richBlockAnchor = (doc, $head) => {
  const start = $head.start() // deepest textblock content start (a cell's <p>, a paragraph, a heading)
  // $head.parent is the innermost node holding the caret — the textblock itself
  // (a cell's paragraph, a normal paragraph, a heading). Its textContent is the
  // block's visible text. We CANNOT use $head.end() for the block end: for a
  // table cell it can resolve to the whole table, making blockText the entire
  // table and collapsing every cell into one long snippet whose pipes/spaces
  // never match the source — so the caret always fell back to ratio and drifted.
  const blockText = ($head.parent && $head.parent.textContent) || ''
  const offsetInBlock = headOffset($head) // visible chars from block start → caret
  const ctxBefore = blockText.slice(Math.max(0, offsetInBlock - SNIPPET_LEN), offsetInBlock)
  const ctxAfter = blockText.slice(offsetInBlock, offsetInBlock + SNIPPET_LEN)
  const context = ctxBefore + ctxAfter
  const contextOff = ctxBefore.length
  if (blockText.length <= SNIPPET_LEN) return { snippet: blockText, snipOff: offsetInBlock, context, contextOff }
  const snip = blockText.slice(Math.max(0, offsetInBlock - SNIPPET_LEN), offsetInBlock)
  if (!snip.replace(/\s/g, '')) {
    const after = blockText.slice(offsetInBlock, offsetInBlock + SNIPPET_LEN)
    if (after.replace(/\s/g, '')) return { snippet: after, snipOff: 0, context, contextOff }
  }
  return { snippet: snip, snipOff: snip.length, context, contextOff }
}

// Visible-char offset of the caret from its textblock start. PM positions map
// 1:1 to visible chars inside a textblock (marks consume no positions), so
// head - start is the char count — UNLESS a hard-break / inline node sits in
// between, in which case it's off by one (acceptable for a caret anchor).
const headOffset = ($head) => $head.pos - $head.start()

const domCaretAnchor = (view) => {
  try {
    const sel = view.dom.ownerDocument.getSelection()
    if (!sel || !sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    if (!range.collapsed || !view.dom.contains(range.startContainer)) return null
    const node = range.startContainer
    if (node.nodeType !== 3) return null
    const text = node.nodeValue || ''
    const offset = range.startOffset || 0
    let before = text.slice(Math.max(0, offset - SNIPPET_LEN), offset)
    let after = text.slice(offset, offset + SNIPPET_LEN)
    const doc = view.dom.ownerDocument
    if (before.length < SNIPPET_LEN) {
      const w = doc.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT)
      let prev = null
      while (w.nextNode()) {
        if (w.currentNode === node) break
        if ((w.currentNode.nodeValue || '').replace(/\s/g, '')) prev = w.currentNode
      }
      if (prev) before = (prev.nodeValue || '').slice(-(SNIPPET_LEN - before.length)) + before
    }
    if (after.length < SNIPPET_LEN) {
      const w = doc.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT)
      w.currentNode = node
      const next = w.nextNode()
      if (next) after += (next.nodeValue || '').slice(0, SNIPPET_LEN - after.length)
    }
    const context = before + after
    if (!context.replace(/\s/g, '')) return null
    if (before.replace(/\s/g, '')) return { snippet: before, snipOff: before.length, context, contextOff: before.length }
    return { snippet: after, snipOff: 0, context, contextOff: 0 }
  } catch { return null }
}

export function captureRichCaret(view) {
  if (!view) return null
  try {
    const doc = view.state.doc
    let head = view.state.selection.head // ProseMirror: .head directly (no .main)
    try {
      const sel = view.dom.ownerDocument.getSelection()
      if (sel && sel.rangeCount && sel.isCollapsed && view.dom.contains(sel.anchorNode)) {
        head = view.posAtDOM(sel.anchorNode, sel.anchorOffset)
      }
    } catch {
      /* use PM selection */
    }
    const $head = doc.resolve(head)
    const blockAnchor = richBlockAnchor(doc, $head)
    const { snippet, snipOff, context, contextOff } = blockAnchor
    const pointerVisible = richPointerVisiblePosition(view)
    const domVisible = richDomVisiblePositionAtSelection(view)
    const { visibleIndex, visibleAffinity } = pointerVisible || domVisible || richVisiblePositionAtPos(doc, head)
    const heads = []
    doc.descendants((node, pos) => {
      if (node.type.name === 'heading') { heads.push({ pos, text: node.textContent }); return false }
      return true
    })
    let pick = null
    for (const h of heads) { if (h.pos <= head) pick = h; else break }
    const size = doc.content.size
    const ratio = size > 0 ? head / size : 0
    if (pick) {
      const offset = doc.textBetween(pick.pos, head, '\n').length
      return { heading: pick.text, offset, ratio, snippet, snipOff, context, contextOff, pmPos: head, visibleIndex, visibleAffinity }
    }
    return size > 0 ? { ratio: head / size, snippet, snipOff, context, contextOff, pmPos: head, visibleIndex, visibleAffinity } : null
  } catch { return null }
}

// Source → ? : capture from the textarea. In a GFM table row the cell text is
// the right anchor (a row-prefix snippet "| 张三 | 数学 | 九" has pipes/spaces
// that don't exist in the rich rendering, so it never matches); elsewhere the
// current line is the block. Nearest heading via parseSourceHeadings as a fallback.
export function captureSourceCaret(textarea) {
  if (!textarea) return null
  const md = textarea.value || ''
  const start = textarea.selectionStart || 0
  const lineStart = md.lastIndexOf('\n', start - 1) + 1
  const lineEndRel = md.indexOf('\n', start)
  const lineEnd = lineEndRel < 0 ? md.length : lineEndRel
  const fullLine = md.slice(lineStart, lineEnd)
  let snippet, snipOff
  let context, contextOff
  if (/^\|.*\|\s*$/.test(fullLine)) {
    // Table row: anchor on the CURRENT cell only.
    const col = start - lineStart
    const cellStart = fullLine.lastIndexOf('|', col - 1) + 1
    const cellEndRel = fullLine.indexOf('|', col)
    const cellEnd = cellEndRel < 0 ? fullLine.length : cellEndRel
    const cell = fullLine.slice(cellStart, cellEnd)
    snippet = stripMdForSnippet(cell).trim()
    snipOff = stripMdForSnippet(fullLine.slice(cellStart, col)).trim().length
    const before = stripMdForSnippet(cell.slice(0, col - cellStart)).trim().slice(-SNIPPET_LEN)
    const after = stripMdForSnippet(cell.slice(col - cellStart)).trim().slice(0, SNIPPET_LEN)
    context = before + after
    contextOff = before.length
  } else {
    const stripped = stripMdForSnippet(md.slice(lineStart, start))
    const strippedAfter = stripMdForSnippet(md.slice(start, Math.min(md.length, lineEnd)))
    const before = stripped.slice(-SNIPPET_LEN)
    const after = strippedAfter.slice(0, SNIPPET_LEN)
    context = before + after
    contextOff = before.length
    snippet = stripped.length <= SNIPPET_LEN ? stripped : stripped.slice(-SNIPPET_LEN)
    snipOff = snippet.length
    if (!snippet.replace(/\s/g, '')) {
      const after = stripMdForSnippet(md.slice(start, Math.min(md.length, start + SNIPPET_LEN * 4))).replace(/^\s+/, '')
      if (after) {
        snippet = after.slice(0, SNIPPET_LEN)
        snipOff = 0
      }
    }
  }
  let pick = null
  for (const h of parseSourceHeadings(md)) {
    if (h.charOffset <= start) pick = h
    else break
  }
  const ratio = md ? start / md.length : 0
  const { visibleIndex, visibleAffinity } = sourceVisiblePositionAtRaw(md, start)
  if (pick) return { heading: pick.text, offset: start - pick.charOffset, ratio, snippet, snipOff, context, contextOff, visibleIndex, visibleAffinity, rawOffset: start }
  return md ? { ratio, snippet, snipOff, context, contextOff, visibleIndex, visibleAffinity, rawOffset: start } : null
}

// ? → Source: caret at global visible-char index first, then snippet fallback,
// heading, ratio. `follow` = true (user was editing): focus scrolls the textarea
// to the caret (viewport follows). `follow` = false (user was reading):
// preventScroll — the viewport anchor owns scroll.
export function restoreSourceCaret(textarea, anchor, follow = false) {
  if (!textarea || !anchor) return false
  try {
    const md = textarea.value || ''
    const hint = anchor.ratio != null ? anchor.ratio * md.length : -1
    let target
    if (Number.isFinite(anchor.visibleIndex)) {
      target = sourceRawFromVisibleIndex(md, anchor.visibleIndex, anchor.visibleAffinity)
    }
    if (target == null && Number.isFinite(anchor.rawOffset)) {
      target = Math.max(0, Math.min(anchor.rawOffset, md.length))
    }
    if (target == null && anchor.context) {
      const idx = nearestIndexOf(md, anchor.context, hint)
      if (idx >= 0) {
        const off = anchor.contextOff != null ? anchor.contextOff : 0
        target = Math.min(idx + off, md.length)
      }
      if (target == null) {
        const off = anchor.contextOff != null ? anchor.contextOff : 0
        const visibleTarget = visibleSourcePosition(md, anchor.context, off, hint)
        if (visibleTarget >= 0) target = Math.min(visibleTarget, md.length)
      }
    }
    if (target == null && anchor.snippet) {
      const idx = nearestIndexOf(md, anchor.snippet, hint)
      if (idx >= 0) {
        const off = anchor.snipOff != null ? anchor.snipOff : anchor.snippet.length
        target = Math.min(idx + off, md.length)
      }
      if (target == null) {
        const off = anchor.snipOff != null ? anchor.snipOff : anchor.snippet.length
        const visibleTarget = visibleSourcePosition(md, anchor.snippet, off, hint)
        if (visibleTarget >= 0) target = Math.min(visibleTarget, md.length)
      }
    }
    if (target == null && anchor.heading) {
      const h = parseSourceHeadings(md).find((x) => x.text === anchor.heading)
      if (h) {
        // Heading text starts AFTER the "# " marker — charOffset points at the
        // line start (with the marker), so skip it.
        const m = md.slice(h.charOffset).match(/^#{1,6}[ \t]+/)
        const textOff = h.charOffset + (m ? m[0].length : 0)
        target = Math.min(textOff + (anchor.offset || 0), md.length)
      }
    }
    if (target == null) target = Math.round((anchor.ratio || 0) * md.length)
    textarea.setSelectionRange(target, target)
    textarea.focus({ preventScroll: !follow })
    return true
  } catch { return false }
}

// ? → Rich: caret at global visible-char index first, then snippet fallback,
// heading, ratio. TextSelection.near snaps to the closest valid text
// position. `follow` selects the strategy:
//   - true  (user was editing — caret was visible): scrollIntoView + focus so the
//     viewport FOLLOWS the caret (caret stays visible, ready to type). The caret
//     is in-viewport here, so focusing can't yank the viewport elsewhere.
//   - false (user was reading — caret was off-screen): set the selection only,
//     NO scrollIntoView / NO focus. The viewport anchor owns scroll; a focus here
//     would async-scroll to the off-screen caret and drift on large docs.
export function restoreRichCaret(view, anchor, follow = false) {
  if (!view || !anchor) return false
  try {
    const doc = view.state.doc
    const size = doc.content.size
    const hint = anchor.ratio != null ? anchor.ratio * size : -1
    let target
    if (Number.isFinite(anchor.pmPos) && anchor.pmPos > 0 && anchor.pmPos <= size) {
      target = anchor.pmPos
    }
    if (target == null && Number.isFinite(anchor.visibleIndex)) {
      target = richPosFromVisibleIndex(doc, anchor.visibleIndex, anchor.visibleAffinity)
    }
    if (target == null && anchor.context) {
      const s = posAtText(doc, anchor.context, hint)
      if (s >= 0) {
        const off = anchor.contextOff != null ? anchor.contextOff : 0
        target = Math.min(s + off, size)
      }
    }
    if (target == null && anchor.snippet) {
      const s = posAtText(doc, anchor.snippet, hint)
      if (s >= 0) {
        const off = anchor.snipOff != null ? anchor.snipOff : anchor.snippet.length
        target = Math.min(s + off, size)
      }
    }
    if (target == null && anchor.heading) {
      let hpos = -1
      doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && node.textContent === anchor.heading) { hpos = pos; return false }
        return true
      })
      // +1 skips the heading node's open token (descendants gives the position
      // before the node; content starts at +1).
      if (hpos >= 0) target = Math.min(hpos + 1 + (anchor.offset || 0), size)
    }
    if (target == null) target = Math.round((anchor.ratio || 0) * size)
    const $pos = doc.resolve(Math.max(1, Math.min(target, size)))
    const tr = view.state.tr.setSelection(TextSelection.near($pos))
    if (follow) tr.scrollIntoView()
    view.dispatch(tr)
    if (follow) view.focus()
    return true
  } catch { return false }
}

// --------------------------------- #28 viewport ---------------------------------
// Capture/restore the SCROLL position via the visible text at the top of the
// viewport. Independent of the caret: when the user scrolled away to read, the
// caret sits elsewhere and we must NOT yank the viewport to it. The snippet is
// the reading landmark; restore scrolls it back to the top. Falls back to a
// scrollTop ratio when no snippet matches.

// The rich viewport anchor is PURE DOM (no ProseMirror dependency): it reads
// the text node at the top of the scroller and, on restore, finds that text in
// the DOM and scrolls it back to the top. This is deliberately NOT routed
// through view.posAtDOM / view.state.doc.textBetween / posAtText, because on a
// large, image-dense doc (hundreds of remote <img>s, 100k+ chars) the PM doc ↔
// DOM mapping can land on the wrong spot or drift as heights settle — whereas
// the DOM text itself is stable and exactly what the user sees. The caret
// anchor still uses PM (it needs precise selection math); the viewport anchor
// only needs "show the same screenful of text", which DOM does best.

// The .ProseMirror content element inside the scroller. All viewport text
// walking is scoped to it (NOT the whole scroller, NOT caretPositionFromPoint's
// arbitrary hit) so capture and restore see the SAME node set — otherwise the
// captured snippet could come from an overlay/adjacent surface and never appear
// in the restore buffer.
const pmContent = (scroller) => (scroller && scroller.querySelector('.ProseMirror')) || null

// The topmost visible text node + char offset, scoped to .ProseMirror. Prefers
// caretPositionFromPoint (char-precise) but ONLY accepts it when the node is
// inside .ProseMirror; otherwise a TreeWalker over .ProseMirror finds the first
// text node whose bottom crosses the top edge (the first visible line).
const topTextNode = (pm, sr) => {
  const doc = pm.ownerDocument
  const cp = doc.caretPositionFromPoint ? doc.caretPositionFromPoint(sr.left + sr.width / 2, sr.top + 6) : null
  // Reject whitespace-only hits (list/block indentation at the viewport top):
  // a whitespace snippet never matches on restore -> ratio fallback -> jump.
  // Fall through to the TreeWalker, which skips whitespace-only nodes.
  if (cp && cp.offsetNode && cp.offsetNode.nodeType === 3 && pm.contains(cp.offsetNode) && cp.offsetNode.nodeValue.replace(/\s/g, '')) {
    return { node: cp.offsetNode, off: cp.offset }
  }
  const w = doc.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) {
    const tn = w.currentNode
    if (!tn.nodeValue.replace(/\s/g, '')) continue
    const rr = doc.createRange(); rr.selectNodeContents(tn)
    if (rr.getBoundingClientRect().bottom > sr.top + 1) return { node: tn, off: 0 }
  }
  return null
}

// `len` RAW chars starting at (node, off), reaching into FOLLOWING text nodes of
// `pm` when the start node is shorter. Crossing nodes is required because
// viewport-top text is often split by inline marks (code, links): "。以 " |
// "skills" | " 为例…" — a single-node slice would be the tiny "。以 ", which
// isn't unique. Restore mirrors this with a concatenated buffer over the same
// `pm`, so a cross-node snippet still matches. RAW (no normalization) so capture
// and restore are byte-identical.
const forwardDomText = (pm, node, off, len) => {
  let s = node.nodeValue.slice(off)
  if (s.length < len) {
    const w = pm.ownerDocument.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
    w.currentNode = node
    while (s.length < len && w.nextNode()) s += w.currentNode.nodeValue
  }
  return s.slice(0, len)
}

// Advance (node, off) past leading whitespace — within the node, then into the
// following text nodes — so the snippet starts on real text. The viewport top of
// a list / indented block is often indentation whitespace; a whitespace snippet
// matches the first whitespace run in the doc (near the top) and yanks the
// restore there.
const skipLeadingWs = (pm, node, off) => {
  const doc = pm.ownerDocument
  while (node) {
    const v = node.nodeValue
    while (off < v.length && /\s/.test(v[off])) off++
    if (off < v.length) return { node, off } // found a non-ws char
    const w = doc.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
    w.currentNode = node
    node = w.nextNode()
    off = 0
  }
  return null
}

export function captureRichViewport(scroller, _view) {
  if (!scroller) return null
  const denom = scroller.scrollHeight - scroller.clientHeight
  const ratio = denom > 0 ? scroller.scrollTop / denom : 0
  const pm = pmContent(scroller)
  if (!pm) return { snippet: null, ratio }
  const top = topTextNode(pm, scroller.getBoundingClientRect())
  const real = top ? skipLeadingWs(pm, top.node, top.off) : null
  if (!real) return { snippet: null, ratio }
  const snippet = forwardDomText(pm, real.node, real.off, VIEWPORT_LEN) || null
  return { snippet, ratio }
}

// ----- textarea char ↔ pixel -----
// A textarea exposes no char↔pixel API and its line height is NON-uniform (long
// lines wrap; an image line `![1.00](url)` is one short source line but renders
// as a tall rich <img>), so the source viewport anchor is inherently less
// precise than the rich (DOM) side. We use char-ratio + a snippet; the rich side
// (pure DOM) carries the precision. (A mirror-div measurement was tried but its
// wrapping width doesn't match the textarea's scroll-reduced content width, so
// the cumulative char-Y error across a 100k-char doc was worse than ratio.)

export function captureSourceViewport(textarea) {
  if (!textarea) return null
  const md = textarea.value || ''
  const denom = textarea.scrollHeight - textarea.clientHeight
  const ratio = denom > 0 ? textarea.scrollTop / denom : 0
  // Approx the char at the viewport top (linear ratio). Skip past image/URL
  // syntax so we anchor on prose that exists in the rich rendering — a viewport
  // top landing on `![alt](url)` would otherwise capture the URL, which has no
  // rich counterpart and never matches.
  let pos = denom > 0 ? Math.round(ratio * md.length) : 0
  const ahead = md.slice(pos, pos + 120)
  const imgRel = ahead.search(/!\[[^\]]*\]\([^)]*\)/)
  if (imgRel >= 0 && imgRel < 30) pos += imgRel + ahead.slice(imgRel).match(/!\[[^\]]*\]\([^)]*\)/)[0].length
  const snippet = stripMdForSnippet(md.slice(pos, pos + 80)).replace(/\s+/g, ' ').trim().slice(0, VIEWPORT_LEN) || null
  return { snippet, ratio }
}

// Scroll the rich editor so the viewport-top snippet is back at the top. Builds
// a RAW concatenated buffer of every text node + an offsets table, so a snippet
// that SPANS mark/node boundaries (prose with inline code/links) — which no
// single text node contains — still matches. Among all matches it picks the one
// whose absolute top is nearest the expected (ratio) position, then aligns it to
// the scroller's top edge. Pure DOM — robust on large/image-dense docs. Ratio
// fallback when the snippet isn't found.
export function restoreRichViewport(scroller, _view, anchor) {
  if (!scroller || !anchor) return false
  const pm = pmContent(scroller)
  if (!pm) {
    const denom0 = scroller.scrollHeight - scroller.clientHeight
    if (denom0 > 0) scroller.scrollTop = (anchor.ratio || 0) * denom0
    return true
  }
  try {
    const doc = pm.ownerDocument
    const sr = scroller.getBoundingClientRect()
    const denom = scroller.scrollHeight - scroller.clientHeight
    if (!anchor.snippet) {
      if (denom > 0) scroller.scrollTop = (anchor.ratio || 0) * denom
      return true
    }
    const snip = anchor.snippet
    // Concatenate .ProseMirror text-node values into one buffer (same scope as
    // capture, so the snippet is guaranteed findable); remember each node's
    // [start, len) so a buffer index maps back to (node, char offset).
    const w = doc.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
    let buf = ''
    const segs = [] // { node, start, len }
    while (w.nextNode()) {
      const tn = w.currentNode
      const nv = tn.nodeValue
      if (!nv) continue
      segs.push({ node: tn, start: buf.length, len: nv.length })
      buf += nv
    }
    // binary-search segs for the segment containing a buffer index
    const nodeAt = (bi) => {
      let lo = 0
      let hi = segs.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const s = segs[mid]
        if (bi < s.start) hi = mid - 1
        else if (bi >= s.start + s.len) lo = mid + 1
        else return { node: s.node, off: bi - s.start }
      }
      return null
    }
    const expected = anchor.ratio != null && denom > 0 ? anchor.ratio * scroller.scrollHeight : -1
    // Find the buffer occurrence nearest the expected position. Try the full
    // snippet first; if it isn't present (a re-render split a mark differently,
    // shifting the snippet's tail), fall back to shorter prefixes — the head is
    // stable and still unique enough with the position hint.
    let bestBi = -1
    let bd = Infinity
    const findNearest = (needle) => {
      if (!needle) return
      let from = 0
      let idx
      while ((idx = buf.indexOf(needle, from)) >= 0) {
        const at = nodeAt(idx)
        if (at) {
          const r = doc.createRange(); r.setStart(at.node, at.off)
          const absTop = r.getBoundingClientRect().top + scroller.scrollTop
          const d = expected > 0 ? Math.abs(absTop - expected) : 0
          if (bestBi < 0 || d < bd) { bd = d; bestBi = idx }
        }
        from = idx + 1
      }
    }
    findNearest(snip)
    if (bestBi < 0) findNearest(snip.slice(0, Math.ceil(snip.length / 2)))
    if (bestBi >= 0) {
      const at = nodeAt(bestBi)
      const r = doc.createRange(); r.setStart(at.node, at.off)
      scroller.scrollTop = scroller.scrollTop + (r.getBoundingClientRect().top - sr.top)
      return true
    }
    if (denom > 0) scroller.scrollTop = (anchor.ratio || 0) * denom
    return true
  } catch { return false }
}

// Scroll the source textarea so the viewport-top snippet is back at the top.
// Finds the snippet's char (nearest expected), then scrollTop = char-ratio * denom.
export function restoreSourceViewport(textarea, anchor) {
  if (!textarea || !anchor) return false
  try {
    const md = textarea.value || ''
    const hint = anchor.ratio != null ? anchor.ratio * md.length : -1
    let charPos = anchor.snippet ? nearestIndexOf(md, anchor.snippet, hint) : -1
    if (charPos < 0) charPos = Math.round((anchor.ratio || 0) * md.length)
    const denom = textarea.scrollHeight - textarea.clientHeight
    textarea.scrollTop = denom > 0 ? (charPos / md.length) * denom : 0
    return true
  } catch { return false }
}
