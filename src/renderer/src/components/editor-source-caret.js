// A THICKER caret for the source-mode textarea.
//
// Native textarea carets can't be thickened via CSS (`caret-color` only sets
// color), so we hide the native caret (caret-color: transparent on .source-editor
// while this is active) and draw our own: a 2px-wide blinking bar positioned at
// the caret's pixel coordinates.
//
// Position is computed with the classic "mirror div" technique: an invisible
// clone of the textarea (same font/padding/width/wrapping) is filled with the
// text up to the caret + a marker span; the marker's offsetLeft/Top within the
// mirror = the caret's position within the textarea. Synced (rAF-throttled) on
// every event that moves the caret or the viewport.
//
// Robustness: any sync error hides the bar for that frame (the user briefly sees
// no caret, never a misplaced one). On detach the native caret is restored.
const CARET_WIDTH = 2 // px (native is ~1px)
// CSS property names MUST be kebab-case — getPropertyValue('paddingTop') returns
// "" (camelCase isn't recognized), which leaves the mirror unstyled and the
// measured caret position off (e.g. ignoring the 40px top padding).
const STYLES_TO_CLONE = [
  'direction', 'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'line-height', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width',
  'border-left-width', 'box-sizing', 'white-space', 'word-wrap', 'word-break',
  'overflow-wrap', 'tab-size', 'text-indent', 'width',
]

export function attachSourceCaret(textarea) {
  if (!textarea) return () => {}
  const doc = textarea.ownerDocument

  const bar = doc.createElement('div')
  bar.className = 'hm-source-caret'
  bar.style.display = 'none'
  doc.body.appendChild(bar)

  const mirror = doc.createElement('div')
  mirror.className = 'hm-source-caret-mirror'
  doc.body.appendChild(mirror)

  let raf = 0
  const hide = () => { bar.style.display = 'none' }

  const sync = () => {
    raf = 0
    try {
      if (doc.activeElement !== textarea) return hide()
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      // Only show for a collapsed caret (a selection range has no blinking caret).
      if (start !== end) return hide()
      const cs = doc.defaultView.getComputedStyle(textarea)
      // Clone the box-model-affecting styles so wrapping matches exactly.
      let css = ''
      for (const k of STYLES_TO_CLONE) css += `${k}:${cs.getPropertyValue(k)};`
      // position the mirror invisibly at a fixed origin; width is cloned so wrapping matches.
      css += 'position:absolute;visibility:hidden;white-space:pre-wrap;top:0;left:0;'
      mirror.style.cssText = css
      const val = textarea.value
      mirror.textContent = val.slice(0, start)
      const marker = doc.createElement('span')
      marker.textContent = '​' // zero-width — gives us a measurable anchor
      mirror.appendChild(marker)
      const mRect = marker.getBoundingClientRect()
      const baseRect = mirror.getBoundingClientRect()
      const taRect = textarea.getBoundingClientRect()
      // caret position within textarea content = marker offset within mirror.
      const xInMirror = mRect.left - baseRect.left
      const yInMirror = mRect.top - baseRect.top
      // Translate to screen, accounting for the textarea's own scroll + borders.
      const screenX = taRect.left + xInMirror - textarea.scrollLeft
      const screenY = taRect.top + yInMirror - textarea.scrollTop
      // The marker span's rect top sits ~half the line-leading below the glyph
      // top (line-box vs text-top), which made the bar look too low + too tall
      // (full line height). Size to the glyph + nudge up by half the leading so
      // the bar aligns with the text like the native caret.
      const fontPx = parseFloat(cs.fontSize) || 14
      const linePx = parseFloat(cs.lineHeight) || fontPx * 1.75
      const halfLead = Math.max(0, (linePx - fontPx) / 2)
      bar.style.left = Math.round(screenX) + 'px'
      bar.style.top = Math.round(screenY - halfLead) + 'px'
      bar.style.height = Math.round(fontPx + 2) + 'px'
      bar.style.display = ''
    } catch {
      hide()
    }
  }

  const schedule = () => { if (!raf) raf = doc.defaultView.requestAnimationFrame(sync) }

  const events = ['input', 'click', 'keydown', 'keyup', 'select', 'scroll', 'focus', 'blur']
  events.forEach((e) => textarea.addEventListener(e, schedule, { passive: true }))
  doc.defaultView.addEventListener('resize', schedule)
  // Also re-sync on any selectionchange (covers arrow-key moves without a dedicated event).
  doc.addEventListener('selectionchange', schedule)

  // Hide the native caret while we're drawing ours.
  textarea.classList.add('hm-source-caret-on')
  schedule()

  return () => {
    if (raf) doc.defaultView.cancelAnimationFrame(raf)
    events.forEach((e) => textarea.removeEventListener(e, schedule))
    doc.defaultView.removeEventListener('resize', schedule)
    doc.removeEventListener('selectionchange', schedule)
    textarea.classList.remove('hm-source-caret-on')
    bar.remove()
    mirror.remove()
  }
}
