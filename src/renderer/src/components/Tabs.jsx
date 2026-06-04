import { Icon } from './icons.jsx'

export default function Tabs({ tabs, activeId, onActivate, onClose, onNew }) {
  return (
    <div className="tabs">
      <div className="tabs-scroll">
        {tabs.map((t) => {
          const dirty = t.content !== t.savedContent
          return (
            <div
              key={t.id}
              className={`tab${t.id === activeId ? ' active' : ''}`}
              onClick={() => onActivate(t.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(t.id)
                }
              }}
              title={t.path || t.title}
            >
              <span className="tab-title">{t.title}</span>
              <span
                className={`tab-close${dirty ? ' dirty' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t.id)
                }}
              >
                {dirty ? <span className="dot" /> : <Icon name="close" size={13} />}
              </span>
            </div>
          )
        })}
      </div>
      <button className="tab-new" title="New tab (Ctrl+N)" onClick={onNew}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}
