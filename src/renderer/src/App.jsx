import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Editor from './components/Editor.jsx'
import Sidebar from './components/Sidebar.jsx'
import Tabs from './components/Tabs.jsx'
import Outline from './components/Outline.jsx'
import StatusBar from './components/StatusBar.jsx'
import SaveFab from './components/SaveFab.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import { Icon } from './components/icons.jsx'
import { THEMES, DEFAULT_THEME, applyTheme } from './themes.js'
import { I18nProvider, translate, DEFAULT_LANG } from './i18n.jsx'
import Welcome from './components/Welcome.jsx'
import WindowControls from './components/WindowControls.jsx'
import UpdateToast from './components/UpdateToast.jsx'
import RenameModal from './components/RenameModal.jsx'
import ImageHostButton from './components/ImageHostButton.jsx'
import {
  loadSettings,
  saveSettings,
  applyPageWidth,
  applyFontSize,
  applyLineHeight,
  applyParagraphSpacing
} from './settings.js'
import { applyCustomTheme } from './customThemes.js'
import { fireToast } from './ui.js'
import logoUrl from './assets/logo.png'
import { useFindReplace } from './hooks/useFindReplace.js'
import { useOutline } from './hooks/useOutline.js'
import { useAppLifecycle } from './hooks/useAppLifecycle.js'
import { useFileOps } from './hooks/useFileOps.js'
import { createMenuHandlers, useGlobalKeys, useCommands } from './lib/menuHandlers.js'
import {
  isAbsolutePath, isPlainTextDoc, loadSession
} from './paths.js'
import { createReviewActions } from './lib/reviewActions.js'

export default function App() {
  const session = useRef(loadSession()).current
  // Mobile (Capacitor) builds run the same renderer; a few affordances differ
  // (drawer sidebar, no split/image-host buttons). Desktop is unaffected.
  const isMobile = window.api.platform === 'ios' || window.api.platform === 'android'
  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)
  // On phones the sidebar overlays the editor, so it starts closed to keep the
  // writing surface front-and-center (desktop keeps its previous default).
  const [sidebarOpen, setSidebarOpen] = useState(session.sidebarOpen ?? !isMobile)
  const [sidebarMode, setSidebarMode] = useState(session.sidebarMode || 'files') // 'files' or 'outline'
  const [theme, setTheme] = useState(session.theme || DEFAULT_THEME)
  // Active custom CSS theme (filename in userData/themes), or null. Overlays the
  // built-in base theme. `customThemes` is the list scanned from that folder.
  const [customTheme, setCustomTheme] = useState(session.customTheme || null)
  const [customThemes, setCustomThemes] = useState([])
  const [lang, setLang] = useState(session.lang || DEFAULT_LANG)
  const [recents, setRecents] = useState(session.recents || [])
  const [sourceMode, setSourceMode] = useState(false)
  // Live mirror of sourceMode for ref-based reads inside stable callbacks.
  const sourceModeRef = useRef(sourceMode)
  sourceModeRef.current = sourceMode
  const [paletteOpen, setPaletteOpen] = useState(false)
  // "Home" shows the welcome/landing page while keeping open tabs mounted (so
  // returning to a document doesn't re-create its editor). Cleared whenever a
  // tab is activated or a file is opened.
  const [home, setHome] = useState(false)
  // Split view: id of the tab shown in the right pane (null = no split). The left
  // pane always shows the active tab; the right pane shows this one. A second,
  // independent editor — both panes are fully editable. Driven by the tab
  // right-click menu ("Open in Split") and the top-bar toggle.
  const [splitId, setSplitId] = useState(null)
  // Fraction of the editor area given to the left pane (0..1), dragged via the
  // divider between the two panes.
  const [splitRatio, setSplitRatio] = useState(0.5)
  // Which split pane is focused ('left' = active tab, 'right' = split tab). A tab
  // click loads into the focused pane, so both panes are switchable from the one
  // tab strip. Always 'left' when not split.
  const [focusedPane, setFocusedPane] = useState('left')
  // Rename-from-tab-menu modal: { id, value } or null. (Electron has no
  // window.prompt, so renaming a tab's file uses this small inline dialog.)
  const [renameState, setRenameState] = useState(null)
  // Mobile "save as": prompt for a filename before writing an untitled doc into
  // the local library (desktop uses the native save dialog instead).
  const [saveNameState, setSaveNameState] = useState(null)
  // User preferences (page width, image-host command). Persisted separately from
  // the session; see settings.js.
  const [settings, setSettings] = useState(loadSettings)

  const editorHostRef = useRef(null) // active rich editor's scroll container
  const editorAreaRef = useRef(null) // flex row holding the editor panes (for split-drag math)
  const sourceRef = useRef(null) // active source-mode <textarea>
  const sourceTextareas = useRef({}) // textarea-backed editors by tab id
  const scrollRatioRef = useRef(null) // pending scroll position to restore across a mode switch
  // Registry of each tab's editor API (by tab id). Several markdown editors can
  // be mounted at once (a tab stays mounted after its first activation), so a
  // single ref would get stuck on whichever editor mounted last; keying by tab
  // id lets commands act on the *currently active* document.
  const editorApis = useRef({})
  // The tab id of whichever editor pane last had focus — so Save / Export target
  // the pane you're actually editing in split view, not always the left one.
  const focusedTabRef = useRef(null)
  const [activeBlock, setActiveBlock] = useState('paragraph')
  // Lazy mounting: a rich (Crepe) editor is only created once its tab has been
  // activated, then kept mounted so later tab switches stay instant. This keeps
  // startup/session-restore fast — only the active tab spins up an editor
  // instead of every restored tab parsing its whole document at once.
  const [mountedIds, setMountedIds] = useState(() => new Set())
  // Tab ids the user explicitly chose to render richly despite being "heavy"
  // (would otherwise open in the fast plain-text editor to avoid a long freeze).
  const [richForced, setRichForced] = useState(() => new Set())

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) || null, [tabs, activeId])
  const activePath = activeTab?.path || null
  // Split is "live" only when the right-pane tab exists and differs from the
  // active (left) one. Hidden on the welcome/home screen.
  const splitTab = useMemo(
    () => (splitId != null ? tabs.find((t) => t.id === splitId) || null : null),
    [tabs, splitId]
  )
  const split = !home && !!splitTab && splitId !== activeId
  // Always-current activeId for callbacks that fire after a tab switch.
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // Always-current snapshot of tabs for use inside async callbacks / event
  // handlers that must not capture a stale `tabs` closure.
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  // Uncontrolled-textarea live edits. The heavy/plain-doc <textarea> is rendered
  // with defaultValue (not value) so typing doesn't re-render App and re-set a
  // multi-MB value each keystroke — that was the ~218ms/keystroke lag on a 1.28MB
  // file. Edits land in liveContentRef and are committed to tab.content on a 400ms
  // debounce, OR synchronously via commitAllLive() before any critical read (save /
  // close / session / external-reload) — so edits inside the debounce window are
  // never lost. Only the textarea path uses this; rich editors still call
  // updateContent() directly (they have no per-keystroke value re-set cost).
  const liveContentRef = useRef(new Map()) // tab id → latest textarea value (uncommitted)
  const liveTimersRef = useRef(new Map()) // tab id → debounce timer
  // Commit one tab's pending textarea edit. Updates the synchronous tabsRef
  // mirror FIRST (confirmAppClose / saveTab read it), then queues setTabs so
  // render-time readers (StatusBar, SaveFab) catch up on the next paint.
  const commitLive = useCallback((id) => {
    if (!liveContentRef.current.has(id)) return
    const content = liveContentRef.current.get(id)
    const timer = liveTimersRef.current.get(id)
    if (timer) clearTimeout(timer)
    liveTimersRef.current.delete(id)
    liveContentRef.current.delete(id)
    tabsRef.current = tabsRef.current.map((t) => (t.id === id ? { ...t, content } : t))
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)))
  }, [])
  const commitAllLive = useCallback(() => {
    for (const id of [...liveContentRef.current.keys()]) commitLive(id)
  }, [commitLive])

  // Drop editor APIs for tabs that have closed.
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.id))
    for (const id of Object.keys(editorApis.current)) {
      if (!live.has(id)) delete editorApis.current[id]
    }
    for (const id of Object.keys(sourceTextareas.current)) {
      if (!live.has(id)) delete sourceTextareas.current[id]
    }
    // Forget mount records for closed tabs (so the Set doesn't grow unbounded).
    setMountedIds((prev) => {
      let changed = false
      const next = new Set()
      for (const id of prev) {
        if (live.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
    setRichForced((prev) => {
      if (!prev.size) return prev
      let changed = false
      const next = new Set()
      for (const id of prev) {
        if (live.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [tabs])

  // Mark the active tab as mounted (and keep it mounted thereafter).
  useEffect(() => {
    if (activeId == null) return
    setMountedIds((prev) => (prev.has(activeId) ? prev : new Set(prev).add(activeId)))
  }, [activeId])

  // The right-pane tab must be mounted too (it's a second visible editor).
  useEffect(() => {
    if (splitId == null) return
    setMountedIds((prev) => (prev.has(splitId) ? prev : new Set(prev).add(splitId)))
  }, [splitId])

  // Drop the split when its tab is gone, or it collapsed onto the active tab
  // (e.g. the user clicked the right-pane's tab in the strip).
  useEffect(() => {
    if (splitId != null && (splitId === activeId || !tabs.some((t) => t.id === splitId))) {
      setSplitId(null)
    }
  }, [tabs, splitId, activeId])

  // Once there's no right pane, tab clicks must target the left pane again.
  useEffect(() => {
    if (splitId == null && focusedPane !== 'left') setFocusedPane('left')
  }, [splitId, focusedPane])

  // ----------------------------- theme / i18n -----------------------------
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // ----------------------------- settings ---------------------------------
  // Apply the editor page width live, and persist any settings change.
  useEffect(() => {
    applyPageWidth(settings.pageWidth)
  }, [settings.pageWidth])
  useEffect(() => {
    applyFontSize(settings.fontSize)
  }, [settings.fontSize])
  useEffect(() => {
    applyLineHeight(settings.lineHeight)
  }, [settings.lineHeight])
  useEffect(() => {
    applyParagraphSpacing(settings.paragraphSpacing)
  }, [settings.paragraphSpacing])
  useEffect(() => {
    saveSettings(settings)
  }, [settings])
  // Merge a partial settings change (from the Settings modal).
  const updateSettings = useCallback((partial) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }, [])

  // ----------------------------- custom themes ----------------------------
  const refreshThemes = useCallback(() => {
    window.api.themesList?.().then(setCustomThemes).catch(() => {})
  }, [])
  useEffect(() => {
    refreshThemes()
  }, [refreshThemes])
  // Inject the selected custom theme's CSS (or clear it). If its file vanished,
  // fall back to no custom theme.
  useEffect(() => {
    if (!customTheme) {
      applyCustomTheme(null)
      return
    }
    let alive = true
    window.api
      .themeRead(customTheme)
      .then((css) => alive && applyCustomTheme(css))
      .catch(() => {
        if (!alive) return
        applyCustomTheme(null)
        setCustomTheme(null)
      })
    return () => {
      alive = false
    }
  }, [customTheme])
  // Picking a built-in theme clears any custom overlay; picking a custom one
  // keeps the built-in as the base (chrome + light/dark).
  const pickBuiltinTheme = useCallback((id) => {
    setTheme(id)
    setCustomTheme(null)
  }, [])

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang])
  // Always-current translator for stable callbacks (e.g. openPaths) that must
  // not be recreated on every language change.
  const tRef = useRef(t)
  tRef.current = t
  const cycleTheme = useCallback(() => {
    setTheme((cur) => {
      const i = THEMES.findIndex((x) => x.id === cur)
      return THEMES[(i + 1) % THEMES.length].id
    })
    setCustomTheme(null)
  }, [])

  // Toggle source/rich mode while keeping the reading position. The two modes
  // use different DOM (a <textarea> vs. the Crepe editor) with different content
  // heights, so we preserve a *scroll ratio* (0…1) rather than a pixel offset:
  // capture it from the outgoing view here, restore it onto the incoming view in
  // the layout effect below once it has rendered.
  const toggleSource = useCallback(() => {
    commitAllLive() // flush textarea edits so the rich editor picks them up on switch
    const el = sourceModeRef.current ? sourceRef.current : editorHostRef.current
    if (el) {
      const denom = el.scrollHeight - el.clientHeight
      scrollRatioRef.current = denom > 0 ? el.scrollTop / denom : 0
    } else {
      scrollRatioRef.current = null
    }
    setSourceMode((v) => !v)
  }, [commitAllLive])

  useLayoutEffect(() => {
    const ratio = scrollRatioRef.current
    if (ratio == null) return
    scrollRatioRef.current = null
    const apply = () => {
      const el = sourceMode ? sourceRef.current : editorHostRef.current
      if (!el) return
      const denom = el.scrollHeight - el.clientHeight
      if (denom > 0) el.scrollTop = ratio * denom
    }
    // Apply immediately, then again as async layout settles — the rich editor
    // (Crepe) fills its content over a few frames after it remounts, growing
    // scrollHeight, so a single pass would land short.
    const raf = requestAnimationFrame(apply)
    const t1 = setTimeout(apply, 90)
    const t2 = setTimeout(apply, 220)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [sourceMode])

  // File operations (open/new/update/close/save/rename/dup/delete/export) +
  // workspace + watcher live in hooks/useFileOps.js (phase-2 US-5). Split ops
  // (openRight/toggleSplit/startSplitDrag/openFileRight) + split state stay
  // here — they're consumed by the editor-area JSX below.
  const {
    openPaths,
    newTab,
    updateContent,
    closeTab,
    closeOthers,
    renameTabFile,
    commitTabRename,
    duplicateTabFile,
    deleteTabFile,
    writeTab,
    saveTab,
    commitMobileSave,
    exportPathToPdf,
    openFolder,
    workspace,
    setWorkspace,
    files,
    refreshNonce,
    reloadTabFromDisk
  } = useFileOps({
    tabs,
    setTabs,
    tabsRef,
    setActiveId,
    setHome,
    setSplitId,
    setRecents,
    commitAllLive,
    liveContentRef,
    liveTimersRef,
    editorApis,
    isMobile,
    t,
    tRef,
    setRenameState,
    setSaveNameState,
    setSidebarOpen,
    sessionWorkspace: session.workspace
  })

  // Show a tab in the right (split) pane. If it's currently the active tab, move
  // the left pane to a different tab so the two panes differ.
  const openRight = useCallback((id) => {
    setHome(false)
    if (id === activeIdRef.current) {
      const others = tabsRef.current.filter((t) => t.id !== id)
      if (!others.length) return // only one tab — nothing to split against
      setActiveId(others[others.length - 1].id)
    }
    setSplitId(id)
  }, [])

  // Toggle split: off → on picks the next tab as the right pane; on → off closes it.
  const toggleSplit = useCallback(() => {
    setSplitId((cur) => {
      if (cur != null) return null
      const list = tabsRef.current
      if (list.length < 2) {
        fireToast(tRef.current('split.needTwo'))
        return null
      }
      const i = list.findIndex((t) => t.id === activeIdRef.current)
      return list[(i + 1) % list.length].id
    })
    setHome(false)
  }, [])

  // Drag the divider between the two split panes to change their ratio.
  const startSplitDrag = useCallback((e) => {
    e.preventDefault()
    const area = editorAreaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    const onMove = (ev) => {
      const r = (ev.clientX - rect.left) / rect.width
      setSplitRatio(Math.min(0.8, Math.max(0.2, r)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('hm-col-resizing')
    }
    document.body.classList.add('hm-col-resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Open a file (by path) directly into the right split pane — used by the
  // sidebar's "Open in Split" so it works even if the file isn't open yet.
  const openFileRight = useCallback(
    async (path) => {
      await openPaths([path])
      const norm = (path || '').replace(/\\/g, '/')
      const tab = tabsRef.current.find((t) => (t.path || '').replace(/\\/g, '/') === norm)
      if (tab) openRight(tab.id)
    },
    [openPaths, openRight]
  )

  // Outline panel (#20) — scrollspy + heading list + click-to-jump. State and
  // the reflow-free scrollspy live in hooks/useOutline.js (phase-2 US-3).
  // Returns the names the JSX already uses (Outline props + the Editor's
  // onStructureChange/onLoadingChange).
  const {
    activeHeading,
    outlineHeadings,
    richLoading,
    setRichDocVersion,
    setRichLoading,
    jumpToHeading
  } = useOutline({ editorHostRef, home, sidebarOpen, sidebarMode, sourceMode, activeId, activeTab, isMobile, setSidebarOpen, setHome })

  // ------------------------- menu / shortcuts ----------------------
  // Find & replace (issue #19) — hoisted above the handlers so createMenuHandlers
  // (US-6) can close over setFind/findInputRef/replaceInputRef. Returns the same
  // names the findbar JSX uses.
  const { find, setFind, findInputRef, replaceInputRef, replaceRef, runFind, stepFind, closeFind, applyReplace } =
    useFindReplace({ editorHostRef, sourceRef, editorApis, activeId, commitLive, liveContentRef })

  // In split view, target the pane you're actually editing (last focused), as
  // long as it's one of the two visible panes; otherwise the active (left) tab.
  const pickEditableId = () => {
    const f = focusedTabRef.current
    if (f && (f === activeId || f === splitId)) return f
    return activeId
  }

  // Review actions (CriticMarkup) on the active/focused tab. pickEditableId is
  // shared with the save/export handlers, so it stays here; the rest lives in
  // lib/reviewActions.js (phase-2 US-1).
  const review = createReviewActions({
    pickEditableId,
    tabsRef,
    sourceTextareas,
    editorApis,
    setHome,
    updateContent,
    setTabs,
    tRef
  })

  // Command dispatch map (menu IPC + keyboard + palette) — built by
  // createMenuHandlers in lib/menuHandlers.js (phase-2 US-6). Stored in a ref so
  // the menu/keyboard listeners (useGlobalKeys) always read the latest actions.
  const handlers = useRef({})
  handlers.current = createMenuHandlers({
    pickEditableId,
    setHome,
    isMobile,
    setSidebarOpen,
    setSidebarMode,
    setPaletteOpen,
    newTab,
    openPaths,
    openFolder,
    saveTab,
    closeTab,
    toggleSource,
    cycleTheme,
    editorApis,
    tabs,
    tRef,
    setFind,
    findInputRef,
    replaceInputRef,
    review
  })

  // App lifecycle (session restore/persist/flush + update check + toast +
  // first-run onboarding) lives in hooks/useAppLifecycle.js (phase-2 US-4).
  // flushSession is also used by the window-close guard; update/toast/
  // dismissUpdate/setToast feed the JSX. These are read only inside effect/event
  // closures, so defining them here is safe (resolved at commit/call time).
  const { update, dismissUpdate, toast, setToast, flushSession } = useAppLifecycle({
    session,
    tabs,
    activePath,
    workspace,
    theme,
    customTheme,
    lang,
    recents,
    sidebarOpen,
    sidebarMode,
    openPaths,
    isMobile,
    tabsRef,
    setActiveId,
    setTabs,
    setSidebarMode,
    setSidebarOpen,
    setHome,
    tRef
  })

  // Global menu IPC + keyboard shortcuts (US-6) — flushSession comes from
  // useAppLifecycle just above, so this call sits after it.
  useGlobalKeys({
    handlers,
    openPaths,
    openFolder,
    isAbsolutePath,
    setWorkspace,
    setSidebarMode,
    setSidebarOpen,
    commitAllLive,
    flushSession,
    tabsRef,
    tRef,
    setTabs,
    activeId,
    setActiveId,
    setHome
  })
  // --------------------------- commands ----------------------------
  const commands = useCommands({ t, handlers })

  const platformClass =
    ({ win32: ' is-win', darwin: ' is-mac', ios: ' is-ios is-mobile', android: ' is-android is-mobile' }[
      window.api.platform
    ] || '')

  return (
    <I18nProvider lang={lang} setLang={setLang}>
    <div className={`app${platformClass}${isMobile && sidebarOpen ? ' drawer-open' : ''}`}>
      <div className="activity-bar">
        <button
          className={`activity-item activity-home${home ? ' active' : ''}`}
          title={t('nav.home')}
          onClick={() => handlers.current.home()}
        >
          <img className="activity-logo" src={logoUrl} alt="HorseMD" />
        </button>
        <button
          className={`activity-item${sidebarMode === 'files' ? ' active' : ''}`}
          title={t('cmd.files')}
          onClick={() => handlers.current.toggleFiles()}
        >
          <Icon name="folder" size={20} />
        </button>
        <button
          className={`activity-item${sidebarMode === 'outline' ? ' active' : ''}`}
          title={t('outline.title')}
          onClick={() => handlers.current.toggleOutline()}
        >
          <Icon name="outline" size={20} />
        </button>
        <div className="activity-spacer" />
        <button
          className="activity-item"
          title={sidebarOpen ? t('side.collapsePane') : t('side.expandPane')}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <Icon name={sidebarOpen ? 'panel-left-close' : 'panel-left-open'} size={20} />
        </button>
      </div>

      <div className="topbar">
        {isMobile && (
          <button
            className="icon-btn drag-no hm-menu-btn"
            title={t('cmd.files')}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Icon name="menu" size={20} />
          </button>
        )}
        <Tabs
          tabs={tabs}
          activeId={home ? null : activeId}
          splitId={home ? null : splitId}
          focusedPane={focusedPane}
          onActivate={(id) => {
            setHome(false)
            // Load into whichever pane is focused, so both panes are switchable.
            if (split && focusedPane === 'right' && id !== activeId) {
              setSplitId(id)
            } else {
              setActiveId(id)
            }
          }}
          onClose={closeTab}
          onNew={newTab}
          onCloseOthers={closeOthers}
          onOpenRight={openRight}
          onRename={renameTabFile}
          onDuplicate={duplicateTabFile}
          onDelete={deleteTabFile}
          onExportPdf={exportPathToPdf}
        />
        <div className="topbar-spacer" />
        <button className="icon-btn drag-no" title={`${t('welcome.newFile')} (Ctrl+N)`} onClick={newTab}>
          <Icon name="plus" size={18} />
        </button>
        {!isMobile && (
          <button
            className={`icon-btn drag-no${split ? ' active' : ''}`}
            title={split ? t('split.close') : t('split.toggle')}
            onClick={toggleSplit}
          >
            <Icon name="columns" size={16} />
          </button>
        )}
        {!isMobile && (
          <ImageHostButton
            t={t}
            command={settings.imageUploadCommand}
            onChange={(cmd) => updateSettings({ imageUploadCommand: cmd })}
          />
        )}
        <button className="icon-btn drag-no" title="Command palette (Ctrl+P)" onClick={() => setPaletteOpen(true)}>
          <Icon name="command" size={16} />
        </button>
        {window.api.platform === 'win32' && <WindowControls t={t} />}
      </div>

      {isMobile && sidebarOpen && (
        <div className="hm-scrim" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="body">
        <aside className={`pane-left${sidebarOpen ? '' : ' collapsed'}`}>
          {sidebarOpen && (
            sidebarMode === 'files' ? (
              <Sidebar
                workspace={workspace}
                activePath={activePath}
                onOpenFile={(p) => { openPaths([p]); if (isMobile) setSidebarOpen(false) }}
                onOpenRight={openFileRight}
                onExportPdf={exportPathToPdf}
                refreshNonce={refreshNonce}
              />
            ) : (
              <Outline headings={outlineHeadings} activeIndex={activeHeading} loading={richLoading} onJump={jumpToHeading} />
            )
          )}
        </aside>

        <main className="pane-center">
          {find.open && (
            <div className="findbar">
              <div className="findbar-row">
                <Icon name="search" size={14} />
                <input
                  ref={findInputRef}
                  value={find.query}
                  placeholder={t('find.placeholder')}
                  onChange={(e) => {
                    const q = e.target.value
                    setFind((f) => ({ ...f, query: q }))
                    runFind(q) // live: highlight as you type
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey) }
                    if (e.key === 'Escape') closeFind()
                  }}
                />
                <span className="findbar-count">
                  {find.query ? `${find.active}/${find.matches}` : ''}
                </span>
                <button title={t('find.prev')} onClick={() => stepFind(true)}>
                  <Icon name="chevron-up" size={14} />
                </button>
                <button title={t('find.next')} onClick={() => stepFind(false)}>
                  <Icon name="chevron-down" size={14} />
                </button>
                <button title={t('find.close')} onClick={closeFind}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="findbar-row">
                <Icon name="replace" size={14} />
                <input
                  ref={replaceInputRef}
                  value={find.replace}
                  placeholder={t('find.replace.placeholder')}
                  onChange={(e) => {
                    replaceRef.current = e.target.value
                    setFind((f) => ({ ...f, replace: e.target.value }))
                  }}
                  onKeyDown={(e) => {
                    // Enter = replace this one; Shift+Enter = replace all.
                    if (e.key === 'Enter') { e.preventDefault(); applyReplace(e.shiftKey) }
                    if (e.key === 'Escape') closeFind()
                  }}
                />
                <span className="findbar-spacer" />
                <button
                  className="findbar-textbtn"
                  title={t('find.replace')}
                  disabled={!find.query}
                  onClick={() => applyReplace(false)}
                >
                  {t('find.replace')}
                </button>
                <button
                  className="findbar-textbtn"
                  title={t('find.replaceAll')}
                  disabled={!find.query}
                  onClick={() => applyReplace(true)}
                >
                  {t('find.replaceAll')}
                </button>
              </div>
            </div>
          )}

          {/* Editor area — a flex row so the active (left) and split (right) tabs
              can sit side by side. Editors are siblings here; only the one(s) in
              view are shown (the rest are display:none but stay mounted, so tab
              switches / toggling split never re-create an editor). Hidden as a
              whole on the welcome/home screen so it doesn't fight Welcome for space. */}
          <div
            ref={editorAreaRef}
            className={`editor-area${split ? ' is-split' : ''}`}
            style={{ display: home || !activeTab ? 'none' : undefined }}
          >
            {tabs.map((tab) => {
              // Which pane (if any) this tab occupies. `split` already excludes
              // home and the case where the two ids are equal.
              const isLeft = !home && tab.id === activeId
              const isRight = split && tab.id === splitId
              const inView = isLeft || isRight
              // Flex order: left pane (1) · divider (2) · right pane (3).
              // Irrelevant for hidden tabs (display:none removes them from layout).
              const order = isRight ? 3 : 1
              // Mark the focused pane (only meaningful while split) so the user
              // can see which pane a tab click will load into.
              const isFocusedPane = split && ((isRight && focusedPane === 'right') || (isLeft && focusedPane === 'left'))
              const paneClass =
                (isRight ? ' hm-pane-right' : isLeft ? ' hm-pane-left' : '') + (isFocusedPane ? ' hm-focused' : '')
              const onPaneFocus = () => {
                focusedTabRef.current = tab.id
                if (split) setFocusedPane(isRight ? 'right' : 'left')
              }
              // In split view the left pane holds a fixed fraction; the right pane
              // grows to fill the rest. Outside split, panes fill the row.
              const paneFlex = split && isLeft ? `0 0 calc(${(splitRatio * 100).toFixed(2)}% - 3px)` : undefined

              // Plain-text docs always use the textarea; "heavy" Markdown docs do
              // too until the user opts into rich (avoids a multi-second freeze);
              // the active pane also uses it in global source mode. The right pane
              // never shows global source mode.
              const heavyAsSource = tab.heavy && !richForced.has(tab.id)
              const usesTextarea = isPlainTextDoc(tab) || heavyAsSource || (sourceMode && isLeft)
              // content-visibility virtualization (see .hm-cv in app.css) kicks in
              // only for genuinely large RICH documents — small docs and the
              // textarea path are untouched. ~20k chars ≈ hundreds of blocks,
              // the range where software-composited scrolling starts to struggle.
              const largeRich = !usesTextarea && (tab.content?.length || 0) >= 20000
              if (usesTextarea) {
                if (!inView) return null
                const setSourceTextareaRef = (el) => {
                  if (el) {
                    sourceTextareas.current[tab.id] = el
                    if (isLeft) sourceRef.current = el
                    return
                  }
                  const existing = sourceTextareas.current[tab.id]
                  delete sourceTextareas.current[tab.id]
                  if (isLeft && (!existing || sourceRef.current === existing)) sourceRef.current = null
                }
                return (
                  <textarea
                    key={`${tab.id}:${tab.reloadNonce}`}
                    ref={setSourceTextareaRef}
                    className={`source-editor${paneClass}`}
                    defaultValue={tab.content}
                    spellCheck={false}
                    style={{ order, flex: paneFlex }}
                    onFocus={onPaneFocus}
                    onMouseDown={onPaneFocus}
                    onChange={(e) => {
                      // Uncontrolled: stash the edit and debounce-commit it, so
                      // typing never re-renders App or re-sets a multi-MB value per
                      // keystroke. commitAllLive() flushes before save/close/etc.
                      const v = e.target.value
                      liveContentRef.current.set(tab.id, v)
                      const prev = liveTimersRef.current.get(tab.id)
                      if (prev) clearTimeout(prev)
                      liveTimersRef.current.set(tab.id, setTimeout(() => commitLive(tab.id), 400))
                    }}
                  />
                )
              }
              // Lazy mount: don't create a Crepe editor for a tab the user hasn't
              // opened yet (keeps session-restore of many tabs fast). Panes in
              // view always mount; visited tabs stay mounted.
              if (!inView && !mountedIds.has(tab.id)) return null
              return (
                <div
                  // Include reloadNonce so an external-edit reload remounts the
                  // Crepe editor with the new content (the create effect only
                  // runs on mount). tab switches keep the same key → stay mounted.
                  key={`${tab.id}:${tab.reloadNonce}`}
                  className={`editor-scroll${paneClass}${largeRich ? ' hm-cv' : ''}`}
                  ref={isLeft && !sourceMode ? editorHostRef : undefined}
                  style={{ display: inView ? undefined : 'none', order, flex: paneFlex }}
                  onFocusCapture={onPaneFocus}
                  onMouseDownCapture={onPaneFocus}
                >
                  <Editor
                    tabId={`${tab.id}:${tab.reloadNonce}`}
                    initialContent={tab.content}
                    docPath={tab.path}
                    imageUploadCommand={settings.imageUploadCommand}
                    onChange={(md, isInitial) => updateContent(tab.id, md, isInitial)}
                    onReady={(api) => {
                      editorApis.current[tab.id] = api
                    }}
                    onActiveBlock={(id) => {
                      if (tab.id === activeIdRef.current) setActiveBlock(id)
                    }}
                    onStructureChange={() => setRichDocVersion((v) => v + 1)}
                    onLoadingChange={setRichLoading}
                  />
                </div>
              )
            })}

            {/* Heavy-doc notice: this Markdown file is shown as plain source to
                stay responsive; offer a one-click switch to the rich editor. */}
            {!home && activeTab && activeTab.heavy && !richForced.has(activeTab.id) && (
              <div className="hm-heavy-banner">
                <span>{t('heavy.notice')}</span>
                <button onClick={() => setRichForced((s) => new Set(s).add(activeTab.id))}>
                  {t('heavy.loadRich')}
                </button>
              </div>
            )}

            {split && (
              <div
                className="hm-split-divider"
                style={{ order: 2 }}
                onMouseDown={startSplitDrag}
                title={t('split.drag')}
              />
            )}

            {split && (
              <button className="hm-split-close" title={t('split.close')} onClick={() => setSplitId(null)}>
                <Icon name="close" size={14} />
              </button>
            )}
          </div>

          {(home || !activeTab) && (
            <Welcome
              t={t}
              lang={lang}
              recents={recents}
              onNew={newTab}
              onOpen={() => handlers.current.open()}
              onOpenFolder={openFolder}
              onOpenRecent={(p) => openPaths([p])}
              onRemoveRecent={(p) =>
                setRecents((prev) => prev.filter((r) => r.path !== p))
              }
            />
          )}
        </main>
      </div>

      <StatusBar
        tab={home ? null : activeTab}
        isMobile={isMobile}
        onSave={() => handlers.current.save()}
        onShare={() => {
          if (!activeTab) return
          if (!activeTab.path) {
            fireToast(tRef.current('save.shareNeedsSave'), { sticky: true })
            return
          }
          window.api.shareFile?.(activeTab.path)
        }}
        theme={theme}
        setTheme={pickBuiltinTheme}
        cycleTheme={cycleTheme}
        customThemes={customThemes}
        customTheme={customTheme}
        onPickCustom={setCustomTheme}
        onRefreshThemes={refreshThemes}
        onOpenThemesFolder={() => window.api.themesReveal?.()}
        onGetMoreThemes={() => window.api.openExternal('https://theme.typora.io/')}
        lang={lang}
        setLang={setLang}
        sourceMode={sourceMode}
        onToggleSource={toggleSource}
        activeBlock={activeBlock}
        onPickBlock={(id) => editorApis.current[activeId]?.setBlock(id)}
        pageWidth={settings.pageWidth}
        onSetPageWidth={(w) => updateSettings({ pageWidth: w })}
        fontSize={settings.fontSize}
        onSetFontSize={(s) => updateSettings({ fontSize: s })}
        lineHeight={settings.lineHeight}
        onSetLineHeight={(v) => updateSettings({ lineHeight: v })}
        paragraphSpacing={settings.paragraphSpacing}
        onSetParagraphSpacing={(v) => updateSettings({ paragraphSpacing: v })}
      />

      <SaveFab
        visible={!home && !!activeTab && activeTab.content !== activeTab.savedContent}
        onSave={() => handlers.current.save()}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        files={files}
        onOpenFile={(p) => { openPaths([p]); if (isMobile) setSidebarOpen(false) }}
      />

      {toast && (
        <div className={`hm-toast${toast.sticky ? ' sticky' : ''}`} role="status" key={toast.key}>
          <span className="hm-toast-msg">{toast.msg}</span>
          {toast.sticky && (
            <button className="hm-toast-close" onClick={() => setToast(null)} aria-label="Close">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      )}

      {renameState && (
        <RenameModal
          t={t}
          initial={renameState.value}
          onConfirm={(name) => commitTabRename(renameState.id, name)}
          onCancel={() => setRenameState(null)}
        />
      )}

      {saveNameState && (
        <RenameModal
          t={t}
          title={t('save.nameTitle')}
          initial={saveNameState.value}
          onConfirm={(name) => commitMobileSave(saveNameState.id, name)}
          onCancel={() => setSaveNameState(null)}
        />
      )}

      {update && (
        <UpdateToast
          t={t}
          latest={update.latest}
          current={update.current}
          notes={update.notes}
          onDownload={() => {
            window.api.openExternal(update.url)
            dismissUpdate()
          }}
          onDismiss={dismissUpdate}
        />
      )}
    </div>
    </I18nProvider>
  )
}
