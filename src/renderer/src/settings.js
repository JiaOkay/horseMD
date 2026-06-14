// User preferences persisted to localStorage, separate from the session state
// (open tabs, workspace…) in paths.js. Currently holds the editor page width and
// the image-host upload command. Kept small and self-contained so the Settings
// modal and App can share one source of truth.

export const SETTINGS_KEY = 'horsemd.settings.v1'

// Page-width slider bounds (px). 'full' (a preset, not a slider value) fills the
// pane instead.
export const PAGE_WIDTH_MIN = 600
export const PAGE_WIDTH_MAX = 1400
export const DEFAULT_PAGE_WIDTH = 800

// Quick presets shown as chips above the slider. 'full' = fill the editor pane.
export const PAGE_WIDTH_PRESETS = [
  { id: 'narrow', width: 700 },
  { id: 'medium', width: 800 },
  { id: 'wide', width: 1000 },
  { id: 'full', width: 'full' }
]

export const DEFAULT_SETTINGS = {
  pageWidth: DEFAULT_PAGE_WIDTH,
  // Empty = no image host: pasted/uploaded images keep the default behavior
  // (a local object URL). When set, it's run like Typora's "custom command":
  // the image file path is appended as an argument and the command prints the
  // resulting URL to stdout.
  imageUploadCommand: ''
}

function normalizeWidth(w) {
  if (w === 'full') return 'full'
  const n = Number(w)
  if (!Number.isFinite(n)) return DEFAULT_PAGE_WIDTH
  return Math.min(PAGE_WIDTH_MAX, Math.max(PAGE_WIDTH_MIN, Math.round(n)))
}

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      pageWidth: normalizeWidth(raw.pageWidth ?? DEFAULT_PAGE_WIDTH),
      imageUploadCommand:
        typeof raw.imageUploadCommand === 'string' ? raw.imageUploadCommand : ''
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* quota / serialization failure — skip */
  }
}

// Apply the page width to the document. The width is a CSS variable read by the
// editor column; the full-width case needs a body class because the source
// editor centers via a calc() that can't collapse to "no max-width" through the
// variable alone.
export function applyPageWidth(width) {
  const root = document.documentElement
  if (width === 'full') {
    document.body.classList.add('hm-full-width')
  } else {
    document.body.classList.remove('hm-full-width')
    root.style.setProperty('--editor-max-width', (width || DEFAULT_PAGE_WIDTH) + 'px')
  }
}
