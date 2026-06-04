import { useMemo } from 'react'
import { Icon } from './icons.jsx'

function stats(md) {
  const text = (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_~\-\[\]()!]/g, ' ')
  const words = (text.match(/[\p{L}\p{N}]+/gu) || []).length
  const chars = (md || '').length
  const readMin = Math.max(1, Math.round(words / 220))
  return { words, chars, readMin }
}

export default function StatusBar({ tab, theme, onToggleTheme, sourceMode, onToggleSource }) {
  const s = useMemo(() => stats(tab?.content), [tab?.content])
  const dirty = tab && tab.content !== tab.savedContent
  return (
    <div className="statusbar">
      <div className="status-left">
        {tab ? (
          <>
            <span className="status-path" title={tab.path || 'Unsaved'}>
              {tab.path || 'Unsaved'}
            </span>
            <span className={`status-dot ${dirty ? 'mod' : 'ok'}`}>{dirty ? '● Modified' : '✓ Saved'}</span>
          </>
        ) : (
          <span className="status-path">Ready</span>
        )}
      </div>
      <div className="status-right">
        {tab && (
          <>
            <span>{s.words} words</span>
            <span>{s.chars} chars</span>
            <span>{s.readMin} min read</span>
          </>
        )}
        <button className="status-btn" onClick={onToggleSource} title="Toggle source mode (Ctrl+/)">
          <Icon name="code" size={14} /> {sourceMode ? 'Source' : 'Rich'}
        </button>
        <button className="status-btn" onClick={onToggleTheme} title="Toggle theme (Ctrl+Shift+T)">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
        </button>
      </div>
    </div>
  )
}
