// The "排版" status-bar button: a popover holding the editor layout adjusters
// — font size, line height, paragraph spacing, and page width. Extracted from
// StatusBar so the bar component stays small; StatusBar just renders this.
//
// Each adjuster is the same shape (segmented presets + a fine-tune slider), so
// AdjustGroup is generic over a numeric value and its presets.
import { useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { useI18n } from '../i18n.jsx'
import { usePopover } from '../hooks/usePopover.js'
import {
  PAGE_WIDTH_PRESETS,
  PAGE_WIDTH_MIN,
  PAGE_WIDTH_MAX,
  FONT_SIZE_PRESETS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_PRESETS,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
  PARA_SPACING_PRESETS,
  PARA_SPACING_MIN,
  PARA_SPACING_MAX,
  applyFontSize,
  applyLineHeight,
  applyParagraphSpacing,
  applyPageWidth
} from '../settings.js'

// usePopover is shared from ../hooks (closes on outside click + Escape).

// Pointer X over `track` → value in [min, max], clamped + rounded.
const valueFromX = (track, clientX, min, max, round) => {
  const r = track.getBoundingClientRect()
  const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  return round(min + p * (max - min))
}

// `liveApply`, if given, writes the CSS variable DIRECTLY during a drag (no
// React state round-trip), so the slider stays smooth even though each new value
// reflows the whole editor. The value is persisted via `onSet` once, on release.
function AdjustGroup({ title, valueLabel, presets, activeIndex, onPick, value, min, max, round = (n) => n, onSet, liveApply }) {
  const { t } = useI18n()
  const trackRef = useRef(null)
  const draftRef = useRef(null) // latest drag value (ref, so pointerup reads it)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState(null) // live drag value (null = use prop)
  const cur = draft === null ? value : draft
  const pct = (cur - min) / (max - min)
  const startDrag = (e) => {
    e.preventDefault()
    setDragging(true)
    const apply = (v) => {
      draftRef.current = v
      setDraft(v)
      if (liveApply) liveApply(v)
    }
    apply(valueFromX(trackRef.current, e.clientX, min, max, round))
    const onMove = (ev) => apply(valueFromX(trackRef.current, ev.clientX, min, max, round))
    const onUp = () => {
      setDragging(false)
      onSet(draftRef.current) // commit the final dragged value
      setDraft(null)
      draftRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return (
    <div className="hm-adjust-group">
      <div className="hm-pop-head">
        <span className="hm-pop-title">{title}</span>
        <span className="hm-pop-value">{valueLabel}</span>
      </div>
      <div className="hm-seg" style={{ '--seg-count': presets.length, '--seg-index': activeIndex }}>
        {activeIndex >= 0 && <span className="hm-seg-pill" aria-hidden="true" />}
        {presets.map((p, i) => (
          <button
            key={p.id}
            className={`hm-seg-item${i === activeIndex ? ' active' : ''}`}
            onClick={() => onPick(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className={`hm-fine${dragging ? ' dragging' : ''}`}>
        <span className="hm-fine-label">{t('settings.fineTune')}</span>
        <div className="hm-ftrack" ref={trackRef} onPointerDown={startDrag}>
          <div className="hm-ffill" style={{ width: pct * 100 + '%' }} />
          <div className="hm-fthumb" style={{ left: pct * 100 + '%' }} />
        </div>
      </div>
    </div>
  )
}

export default function LayoutControl({
  fontSize,
  onSetFontSize,
  lineHeight,
  onSetLineHeight,
  paragraphSpacing,
  onSetParagraphSpacing,
  pageWidth,
  onSetPageWidth
}) {
  const { t } = useI18n()
  const { open, setOpen, ref } = usePopover()

  const round1 = (n) => Math.round(n * 10) / 10
  const round10 = (n) => Math.round(n / 10) * 10
  const fontIdx = FONT_SIZE_PRESETS.findIndex((p) => p.size === fontSize)
  const lhIdx = LINE_HEIGHT_PRESETS.findIndex((p) => p.value === lineHeight)
  const psIdx = PARA_SPACING_PRESETS.findIndex((p) => p.value === paragraphSpacing)

  const isFull = pageWidth === 'full'
  const widthIdx = PAGE_WIDTH_PRESETS.findIndex((p) =>
    p.width === 'full' ? isFull : !isFull && pageWidth === p.width
  )

  return (
    // hm-pagewidth lets mobile hide this via CSS (mobile forces full width and
    // sets font size in the "more" sheet).
    <div className="block-switch hm-pagewidth hm-layout" ref={ref}>
      <button className="status-btn" onClick={() => setOpen((v) => !v)} title={t('settings.layout')}>
        <Icon name="settings" size={14} /> {t('settings.layoutLabel')}
      </button>
      {open && (
        <div className="hm-pop hm-width-pop hm-layout-pop">
          <AdjustGroup
            title={t('settings.fontSize')}
            valueLabel={fontSize + ' px'}
            presets={FONT_SIZE_PRESETS.map((p) => ({ ...p, label: t('settings.font.' + p.id) }))}
            activeIndex={fontIdx}
            onPick={(p) => onSetFontSize(p.size)}
            value={fontSize}
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            round={Math.round}
            onSet={onSetFontSize}
            liveApply={applyFontSize}
          />
          <div className="hm-pop-sep" />
          <AdjustGroup
            title={t('settings.lineHeight')}
            valueLabel={round1(lineHeight).toFixed(1)}
            presets={LINE_HEIGHT_PRESETS.map((p) => ({ ...p, label: t('settings.lineHeightPreset.' + p.id) }))}
            activeIndex={lhIdx}
            onPick={(p) => onSetLineHeight(p.value)}
            value={lineHeight}
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            round={round1}
            onSet={onSetLineHeight}
            liveApply={applyLineHeight}
          />
          <div className="hm-pop-sep" />
          <AdjustGroup
            title={t('settings.paragraphSpacing')}
            valueLabel={round1(paragraphSpacing).toFixed(1) + ' em'}
            presets={PARA_SPACING_PRESETS.map((p) => ({ ...p, label: t('settings.paraSpacingPreset.' + p.id) }))}
            activeIndex={psIdx}
            onPick={(p) => onSetParagraphSpacing(p.value)}
            value={paragraphSpacing}
            min={PARA_SPACING_MIN}
            max={PARA_SPACING_MAX}
            round={round1}
            onSet={onSetParagraphSpacing}
            liveApply={applyParagraphSpacing}
          />
          <div className="hm-pop-sep" />
          <AdjustGroup
            title={t('settings.pageWidth')}
            valueLabel={isFull ? t('settings.width.full') : pageWidth + ' px'}
            presets={PAGE_WIDTH_PRESETS.map((p) => ({ ...p, label: t('settings.width.' + p.id) }))}
            activeIndex={widthIdx}
            onPick={(p) => onSetPageWidth(p.width)}
            value={isFull ? PAGE_WIDTH_MAX : pageWidth}
            min={PAGE_WIDTH_MIN}
            max={PAGE_WIDTH_MAX}
            round={round10}
            onSet={onSetPageWidth}
            liveApply={applyPageWidth}
          />
        </div>
      )}
    </div>
  )
}
