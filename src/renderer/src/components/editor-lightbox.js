import { useEffect } from 'react'

export function useEditorLightboxControls({ zoom, setZoom, scaleRef, translateRef, contentRef }) {
  // Close the lightbox on Escape and reset transform state when closed.
  useEffect(() => {
    if (!zoom) {
      scaleRef.current = 1
      translateRef.current = { x: 0, y: 0 }
      return
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setZoom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, setZoom, scaleRef, translateRef])

  // Ctrl+wheel zoom + drag-pan, scoped to the lightbox content.
  useEffect(() => {
    if (!zoom) return
    const applyTransform = (el) => {
      const { x, y } = translateRef.current
      el.style.transform = `translate(${x}px, ${y}px) scale(${scaleRef.current})`
      el.style.transformOrigin = 'center center'
    }
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const el = contentRef.current
      if (!el) return
      const delta = e.deltaY < 0 ? 0.1 : -0.1
      scaleRef.current = Math.min(10, Math.max(0.2, scaleRef.current + delta))
      applyTransform(el)
    }
    const onMouseDown = (e) => {
      const el = contentRef.current
      if (!el || !el.contains(e.target) || e.button !== 0) return
      e.preventDefault()
      el.style.cursor = 'grabbing'
      const startX = e.clientX - translateRef.current.x
      const startY = e.clientY - translateRef.current.y
      let dragged = false
      const onMove = (ev) => {
        dragged = true
        translateRef.current = { x: ev.clientX - startX, y: ev.clientY - startY }
        applyTransform(el)
      }
      const onUp = () => {
        el.style.cursor = 'grab'
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (dragged) {
          // Suppress the click that follows a drag so it doesn't close the lightbox.
          window.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true })
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true, passive: false })
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [zoom, scaleRef, translateRef, contentRef])
}
