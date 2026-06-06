/* ───────────────────────────────────────────────────────────
   HorseMD 官网 — 交互：i18n / reveal / 画廊 / 磁吸 / scrollspy
   ─────────────────────────────────────────────────────────── */

/* ── i18n ─────────────────────────────────────────────────── */
const I18N = {
  zh: {
    'nav.features': '特性', 'nav.themes': '主题',
    'hero.kicker': '免费开源 · MIT',
    'hero.l1': '一个窗口，', 'hero.l2': '装下所有文件。',
    'hero.sub': '因为 Typora 没有<strong>标签页</strong>和<strong>文件树</strong>，所以我做了 HorseMD —— 一款温暖安静的所见即所得 Markdown 编辑器。',
    'cta.win': '下载 Windows 版', 'cta.mac': '下载 macOS 版',
    'hero.note': '构建未签名 — Windows：更多信息 → 仍要运行 · macOS：右键 → 打开',
    'strip.tabs': '标签页', 'strip.tree': '文件树', 'strip.i18n': 'EN / 中文', 'strip.themes': '6 套主题',
    'features.title': '核心功能',
    'f1.title': '标签页', 'f1.body': '所有文件在同一个窗口打开，双击文件是新标签，不是新实例。',
    'f2.title': '文件夹工作区', 'f2.body': '整个文件夹装进侧边栏，新建、重命名、删除就地完成。',
    'f3.title': '所见即所得', 'f3.body': '输入 Markdown 当场渲染：表格、代码高亮、LaTeX、任务列表。',
    'f4.title': '命令面板', 'f4.body': '模糊搜索直达任何文件、任何命令，长文档大纲一键跳转。',
    'themes.title': '六套主题',
    'themes.light': '明亮', 'themes.dark': '暗夜', 'themes.mist': '雾',
    'themes.sage': '鼠尾草', 'themes.rose': '玫瑰', 'themes.dusk': '暮色',
    '_title': 'HorseMD — 一个窗口，装下所有 Markdown',
    '_desc': 'HorseMD：温暖安静的 Typora 风格 Markdown 编辑器。标签页 + 文件树 + 所见即所得，Windows 与 macOS，免费开源。',
  },
  en: {
    'nav.features': 'Features', 'nav.themes': 'Themes',
    'hero.kicker': 'FREE & OPEN SOURCE · MIT',
    'hero.l1': 'One window.', 'hero.l2': 'Every file.',
    'hero.sub': 'Typora never shipped <strong>tabs</strong> or a <strong>file tree</strong> — so I built HorseMD: a calm, WYSIWYG Markdown editor.',
    'cta.win': 'Download for Windows', 'cta.mac': 'Download for macOS',
    'hero.note': 'Unsigned builds — Windows: More info → Run anyway · macOS: right-click → Open',
    'strip.tabs': 'Tabs', 'strip.tree': 'File tree', 'strip.i18n': 'EN / 中文', 'strip.themes': '6 themes',
    'features.title': 'Core features',
    'f1.title': 'Tabs', 'f1.body': 'Every file opens in the same window — a new tab, not a new instance.',
    'f2.title': 'Folder workspace', 'f2.body': 'Your whole folder in the sidebar: create, rename, delete in place.',
    'f3.title': 'WYSIWYG', 'f3.body': 'Markdown renders as you type: tables, code highlight, LaTeX, task lists.',
    'f4.title': 'Command palette', 'f4.body': 'Fuzzy-jump to any file or command; outline jumps for long docs.',
    'themes.title': 'Six themes',
    'themes.light': 'Light', 'themes.dark': 'Dark', 'themes.mist': 'Mist',
    'themes.sage': 'Sage', 'themes.rose': 'Rose', 'themes.dusk': 'Dusk',
    '_title': 'HorseMD — One window. Every file.',
    '_desc': 'HorseMD: a calm, Typora-style Markdown editor with tabs and a file-tree workspace. Free & open source for Windows and macOS.',
  },
}

const LANG_KEY = 'horsemd.site.lang'
let lang = localStorage.getItem(LANG_KEY)
  || (navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en')

function applyLang() {
  const dict = I18N[lang]
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n
    if (dict[key] != null) el.innerHTML = dict[key]
  })
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  document.title = dict['_title']
  const meta = document.querySelector('meta[name="description"]')
  if (meta) meta.content = dict['_desc']
  document.getElementById('langToggle').textContent = lang === 'zh' ? 'EN' : '中文'
  localStorage.setItem(LANG_KEY, lang)
}
document.getElementById('langToggle').addEventListener('click', () => {
  lang = lang === 'zh' ? 'en' : 'zh'
  applyLang()
})
applyLang()

/* ── 滚动进度细线 ─────────────────────────────────────────── */
const onScroll = () => {
  const h = document.documentElement
  const p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)
  h.style.setProperty('--p', p.toFixed(4))
}
document.addEventListener('scroll', onScroll, { passive: true })
onScroll()

/* ── reveal on scroll ─────────────────────────────────────── */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
  })
}, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 3) * 90}ms`
  io.observe(el)
})

/* hero split-line：加载后逐行升起 */
requestAnimationFrame(() => {
  document.querySelectorAll('.split-line').forEach((el, i) => {
    setTimeout(() => el.classList.add('in'), 150 + i * 160)
  })
})

/* ── hero 截图：鼠标视差 tilt ─────────────────────────────── */
const frame = document.getElementById('heroFrame')
if (frame && matchMedia('(hover: hover)').matches) {
  frame.addEventListener('mousemove', e => {
    const r = frame.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    frame.style.transform = `perspective(1400px) rotateX(${(-y * 2.4).toFixed(2)}deg) rotateY(${(x * 2.4).toFixed(2)}deg)`
  })
  frame.addEventListener('mouseleave', () => { frame.style.transform = '' })
}

/* ── 主题画廊：双图交叉淡入 ───────────────────────────────── */
const imgA = document.getElementById('themeImgA')
const imgB = document.getElementById('themeImgB')
const themeTitle = document.getElementById('themeTitle')
let frontIsA = true
document.querySelectorAll('.swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const back = frontIsA ? imgB : imgA
    const front = frontIsA ? imgA : imgB
    const swap = () => {
      back.classList.add('on')
      front.classList.remove('on')
      frontIsA = !frontIsA
    }
    back.src = `./assets/${btn.dataset.img}`
    if (back.complete) swap()
    else back.onload = swap
    themeTitle.textContent = `theme — ${btn.dataset.name}`
  })
})

/* ── 按访客系统突出对应的下载按钮，另一个降为描边 ────────── */
const isMac = /mac/i.test(navigator.platform || '') || /Macintosh/.test(navigator.userAgent)
document.getElementById(isMac ? 'dlWin' : 'dlMac').classList.replace('btn-solid', 'btn-ghost')

/* ── 磁吸按钮：朝指针轻微吸附 ─────────────────────────────── */
if (matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('.btn, .lang-toggle').forEach(el => {
    el.addEventListener('mousemove', e => {
      const r = el.getBoundingClientRect()
      const dx = (e.clientX - r.left - r.width / 2) * 0.12
      const dy = (e.clientY - r.top - r.height / 2) * 0.2
      el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`
    })
    el.addEventListener('mouseleave', () => { el.style.transform = '' })
  })
}

/* ── scrollspy：导航高亮当前区块 ──────────────────────────── */
const spyMap = new Map()
document.querySelectorAll('.nav-links a[href^="#"]').forEach(a => {
  const sec = document.querySelector(a.getAttribute('href'))
  if (sec) spyMap.set(sec, a)
})
const spy = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      spyMap.forEach(a => a.classList.remove('active'))
      spyMap.get(e.target)?.classList.add('active')
    }
  })
}, { rootMargin: '-35% 0px -55% 0px' })
spyMap.forEach((a, sec) => spy.observe(sec))

/* ── GitHub Releases：填充版本号与安装包直链 ─────────────── */
fetch('https://api.github.com/repos/BND-1/horseMD/releases/latest')
  .then(r => (r.ok ? r.json() : null))
  .then(rel => {
    if (!rel) return
    const ver = rel.tag_name || ''
    if (ver) {
      document.getElementById('navVersion').textContent = ver
      document.getElementById('footVersion').textContent = ver
    }
    const assets = rel.assets || []
    const win = assets.find(a => /\.exe$/i.test(a.name))
    const mac = assets.find(a => /\.dmg$/i.test(a.name))
    if (win) document.getElementById('dlWin').href = win.browser_download_url
    if (mac) document.getElementById('dlMac').href = mac.browser_download_url
  })
  .catch(() => { /* 静默回退到 releases 页 */ })
