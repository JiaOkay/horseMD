// Settings page — a full-tab view (kind:'settings') grouping every operable
// preference: typography (font size / line height / paragraph spacing / page
// width) with a live preview, spell-check toggle, theme, language, image-host
// command, and an About section. Opened from the ActivityBar gear button.
//
// US-2 ships this shell so the Settings tab routes correctly (EditorArea skips
// kind!=='doc' tabs; this component renders as a sibling of EditorArea/Welcome).
// Sections are filled in subsequent stories (US-5 typography + preview, US-6 the
// rest). StatusBar quick-controls (排版/主题/语言) stay where they are — this is
// their full-version home, not a replacement.
import { useI18n } from '../i18n.jsx'

export default function SettingsView() {
  const { t } = useI18n()
  return (
    <div className="settings-page">
      <div className="settings-card">
        <h1 className="settings-title">{t('settings.pageTitle')}</h1>
        <p className="settings-subtitle">{t('settings.pageSubtitle')}</p>
        {/* Sections are added in US-5 (typography + live preview) and US-6
            (appearance / language / image host / about). */}
      </div>
    </div>
  )
}
