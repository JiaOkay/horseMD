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
// Anchor text is VISIBLE text (markdown syntax stripped on the source side) so
// the same landmark matches in both modes even when a link / code fence / list
// marker makes raw char offsets diverge. When the snippet occurs more than once,
// we pick the occurrence NEAREST the expected position (ratio*size) — not the
// last one — so a short snippet inside a table cell ("九") lands on the right
// cell instead of the last match.
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

// ---------------------------------- #41 caret ----------------------------------
// Capture/restore the CARET across rich↔source. The caret restore sets ONLY the
// selection — it does NOT scroll (the viewport anchor owns scroll). Anchor order
// on restore: SNIPPET (nearest expected pos) → heading → ratio. Returns null
// when there's nothing to anchor (caller skips the caret restore).

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
  if (blockText.length <= SNIPPET_LEN) return { snippet: blockText, snipOff: offsetInBlock }
  const snip = blockText.slice(Math.max(0, offsetInBlock - SNIPPET_LEN), offsetInBlock)
  return { snippet: snip, snipOff: snip.length }
}

// Visible-char offset of the caret from its textblock start. PM positions map
// 1:1 to visible chars inside a textblock (marks consume no positions), so
// head - start is the char count — UNLESS a hard-break / inline node sits in
// between, in which case it's off by one (acceptable for a caret anchor).
const headOffset = ($head) => $head.pos - $head.start()

export function captureRichCaret(view) {
  if (!view) return null
  try {
    const head = view.state.selection.head // ProseMirror: .head directly (no .main)
    const doc = view.state.doc
    const $head = doc.resolve(head)
    const { snippet, snipOff } = richBlockAnchor(doc, $head)
    const heads = []
    doc.descendants((node, pos) => {
      if (node.type.name === 'heading') { heads.push({ pos, text: node.textContent }); return false }
      return true
    })
    let pick = null
    for (const h of heads) { if (h.pos <= head) pick = h; else break }
    if (pick) {
      const offset = doc.textBetween(pick.pos, head, '\n').length
      return { heading: pick.text, offset, snippet, snipOff }
    }
    const size = doc.content.size
    return size > 0 ? { ratio: head / size, snippet, snipOff } : null
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
  if (/^\|.*\|\s*$/.test(fullLine)) {
    // Table row: anchor on the CURRENT cell only.
    const col = start - lineStart
    const cellStart = fullLine.lastIndexOf('|', col - 1) + 1
    const cellEndRel = fullLine.indexOf('|', col)
    const cellEnd = cellEndRel < 0 ? fullLine.length : cellEndRel
    const cell = fullLine.slice(cellStart, cellEnd)
    snippet = stripMdForSnippet(cell).trim()
    snipOff = stripMdForSnippet(fullLine.slice(cellStart, col)).trim().length
  } else {
    const stripped = stripMdForSnippet(md.slice(lineStart, start))
    snippet = stripped.length <= SNIPPET_LEN ? stripped : stripped.slice(-SNIPPET_LEN)
    snipOff = snippet.length
  }
  let pick = null
  for (const h of parseSourceHeadings(md)) {
    if (h.charOffset <= start) pick = h
    else break
  }
  if (pick) return { heading: pick.text, offset: start - pick.charOffset, snippet, snipOff }
  return md ? { ratio: start / md.length, snippet, snipOff } : null
}

// ? → Source: caret at snippetStart + snipOff (nearest expected occurrence), else
// heading, else ratio. Sets the selection WITHOUT scrolling (preventScroll) — the
// viewport anchor owns scroll.
export function restoreSourceCaret(textarea, anchor) {
  if (!textarea || !anchor) return false
  try {
    const md = textarea.value || ''
    const hint = anchor.ratio != null ? anchor.ratio * md.length : -1
    let target
    if (anchor.snippet) {
      const idx = nearestIndexOf(md, anchor.snippet, hint)
      if (idx >= 0) {
        const off = anchor.snipOff != null ? anchor.snipOff : anchor.snippet.length
        target = Math.min(idx + off, md.length)
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
    textarea.focus({ preventScroll: true })
    return true
  } catch { return false }
}

// ? → Rich: caret at snippetStart + snipOff (nearest expected occurrence), else
// heading, else ratio. TextSelection.near snaps to the closest valid text
// position. Sets the selection WITHOUT scrolling — the viewport anchor owns scroll.
export function restoreRichCaret(view, anchor) {
  if (!view || !anchor) return false
  try {
    const doc = view.state.doc
    const size = doc.content.size
    const hint = anchor.ratio != null ? anchor.ratio * size : -1
    let target
    if (anchor.snippet) {
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
    view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)))
    view.focus()
    return true
  } catch { return false }
}

// --------------------------------- #28 viewport ---------------------------------
// Capture/restore the SCROLL position via the visible text at the top of the
// viewport. Independent of the caret: when the user scrolled away to read, the
// caret sits elsewhere and we must NOT yank the viewport to it. The snippet is
// the reading landmark; restore scrolls it back to the top. Falls back to a
// scrollTop ratio when no snippet matches.

// ~VIEWPORT_LEN chars of visible text starting at the top of the rich scroller.
// caretPositionFromPoint(top-center) gives the exact start position; a TreeWalker
// fallback finds the first text node whose bottom crosses the top edge (the
// point API can return null over the editor's padding). null if nothing's there.
const richViewportSnippet = (scroller, view) => {
  if (!scroller || !view) return null
  const doc = scroller.ownerDocument
  const sr = scroller.getBoundingClientRect()
  let node = null
  let off = 0
  const cp = doc.caretPositionFromPoint ? doc.caretPositionFromPoint(sr.left + sr.width / 2, sr.top + 6) : null
  if (cp && cp.offsetNode && cp.offsetNode.nodeType === 3) { node = cp.offsetNode; off = cp.offset }
  else {
    const w = doc.createTreeWalker(scroller, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const tn = w.currentNode
      if (!tn.nodeValue.replace(/\s/g, '')) continue
      const rr = doc.createRange(); rr.selectNodeContents(tn)
      if (rr.getBoundingClientRect().bottom > sr.top + 1) { node = tn; off = 0; break }
    }
  }
  if (!node) return null
  let pos
  try { pos = view.posAtDOM(node, off) } catch { return null }
  const size = view.state.doc.content.size
  // Forward text from the viewport top, whitespace-normalized so it matches the
  // source side (whose block gaps differ). Visible text only (no markdown).
  const fwd = view.state.doc.textBetween(pos, Math.min(pos + 60, size)).replace(/\s+/g, ' ').trim()
  return fwd.slice(0, VIEWPORT_LEN) || null
}

export function captureRichViewport(scroller, view) {
  const snippet = richViewportSnippet(scroller, view)
  if (!scroller) return null
  const denom = scroller.scrollHeight - scroller.clientHeight
  const ratio = denom > 0 ? scroller.scrollTop / denom : 0
  return { snippet, ratio }
}

export function captureSourceViewport(textarea) {
  if (!textarea) return null
  const md = textarea.value || ''
  const denom = textarea.scrollHeight - textarea.clientHeight
  const approx = denom > 0 ? Math.round((textarea.scrollTop / denom) * md.length) : 0
  // Strip syntax so the snippet matches the rich doc's visible text.
  const snippet = stripMdForSnippet(md.slice(approx, approx + 80)).replace(/\s+/g, ' ').trim().slice(0, VIEWPORT_LEN) || null
  const ratio = denom > 0 ? textarea.scrollTop / denom : 0
  return { snippet, ratio }
}

// Scroll the rich editor so the viewport-top snippet is back at the top. Finds
// the occurrence nearest the expected (ratio) position, gets its DOM node, and
// aligns it to the scroller's top edge. Ratio fallback when the snippet is gone.
export function restoreRichViewport(scroller, view, anchor) {
  if (!scroller || !view || !anchor) return false
  try {
    const doc = view.state.doc
    const size = doc.content.size
    let pos = -1
    if (anchor.snippet) pos = posAtText(doc, anchor.snippet, anchor.ratio != null ? anchor.ratio * size : -1)
    if (pos < 0) pos = Math.round((anchor.ratio || 0) * size)
    if (pos < 0) return false
    const dom = view.domAtPos(Math.max(0, Math.min(pos, size)))
    const el = dom.node.nodeType === 3 ? dom.node.parentElement : dom.node
    if (!el) return false
    const sr = scroller.getBoundingClientRect()
    scroller.scrollTop = scroller.scrollTop + (el.getBoundingClientRect().top - sr.top)
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
