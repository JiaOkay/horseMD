import { Crepe, CrepeFeature as Feature } from '@milkdown/crepe'
import {
  nodeViewCtx,
  prosePluginsCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx
} from '@milkdown/kit/core'
import { imageBlockConfig } from '@milkdown/kit/component/image-block'
import { inlineImageConfig } from '@milkdown/kit/component/image-inline'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
import { inlineCodeSchema } from '@milkdown/kit/preset/commonmark'
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import remarkFrontmatter from 'remark-frontmatter'
import { tabAtCursorKeymap } from './editor-codeblock-tab.js'
import { renderHtmlNodeView, remarkMergeInlineHtml } from './editor-html.js'
import { remarkUnwrapNonAsciiAutolinks } from './editor-autolink.js'
import { createMermaidPreviewRenderer, createMermaidSplitPlugin } from './editor-mermaid.js'
import { tableBreakKeymap, tableCellBreakHandler, brToBreakRemarkPlugin } from './editor-tablebreak.js'
import { mathPreviewPlugin } from './editor-math-preview.js'
import { toolbarAutohidePlugin } from './editor-toolbar-autohide.js'
import { createMathBlockPromotionPlugin } from './editor-math.js'
import { frontmatterSchema, renderFrontmatterNodeView, remarkFrontmatterAnywhere } from './editor-frontmatter.js'
import { highlightFeatures, highlightStringifyHandler } from './editor-highlight.js'
import { createReviewDecorationPlugin } from './editor-review.js'
import {
  createStrikeGuardPlugin,
  createSubstitutionLiveReconstructPlugin,
  remarkReconstructSubstitution
} from './editor-criticmarkup-plugins.js'

// A "Mermaid" entry for the code-block language picker. Mermaid has no real
// CodeMirror language; the picker only needs a language descriptor so users can
// choose "mermaid" directly.
const mermaidLanguage = LanguageDescription.of({
  name: 'Mermaid',
  alias: ['mermaid', 'mmd'],
  extensions: ['mmd', 'mermaid'],
  async load() {
    return new LanguageSupport(StreamLanguage.define(() => ({ token: () => null })))
  }
})

export function applyImageText(ctx, tt) {
  try {
    ctx.update(imageBlockConfig.key, (v) => ({
      ...v,
      captionPlaceholderText: tt('image.caption'),
      uploadPlaceholderText: tt('image.pasteLink'),
      uploadButton: tt('image.uploadFile'),
      confirmButton: tt('image.confirm')
    }))
    ctx.update(inlineImageConfig.key, (v) => ({
      ...v,
      uploadPlaceholderText: tt('image.pasteLink'),
      uploadButton: tt('image.upload'),
      confirmButton: tt('image.confirm')
    }))
  } catch {
    /* config not ready yet */
  }
}

function slashCommandConfig(tt) {
  return {
    textGroup: {
      label: tt('slash.text'),
      text: { label: tt('slash.text') },
      h1: { label: tt('block.h1') },
      h2: { label: tt('block.h2') },
      h3: { label: tt('block.h3') },
      h4: { label: tt('block.h4') },
      h5: { label: tt('block.h5') },
      h6: { label: tt('block.h6') },
      quote: { label: tt('slash.quote') },
      divider: { label: tt('slash.divider') }
    },
    listGroup: {
      label: tt('slash.list'),
      bulletList: { label: tt('slash.bullet') },
      orderedList: { label: tt('slash.ordered') },
      taskList: { label: tt('slash.task') }
    },
    advancedGroup: {
      label: tt('slash.advanced'),
      image: { label: tt('slash.image') },
      codeBlock: { label: tt('slash.code') },
      table: { label: tt('slash.table') },
      math: { label: tt('slash.math') }
    }
  }
}

export function createConfiguredCrepe({
  host,
  defaultValue,
  getT,
  persistImage,
  notify,
  copyText
}) {
  const t = getT
  const crepe = new Crepe({
    root: host,
    defaultValue,
    features: {
      [Feature.SelectionTooltip]: true,
      [Feature.SlashCommand]: true,
      [Feature.BlockEdit]: true,
      [Feature.CodeMirror]: true,
      [Feature.Table]: true,
      [Feature.InlineCode]: true,
      [Feature.LinkTooltip]: true,
      [Feature.Latex]: true,
      // Disable Crepe's virtual cursor; the native caret avoids content jumps
      // and remains visible inside table cells.
      [Feature.Cursor]: false
    },
    featureConfigs: {
      [Feature.Placeholder]: { text: t('editor.placeholder'), mode: 'block' },
      [Feature.CodeMirror]: {
        copyText: t('code.copy'),
        previewToggleText: (previewOnly) =>
          previewOnly ? t('mermaid.editCode') : t('mermaid.hideCode'),
        extensions: [tabAtCursorKeymap]
      },
      [Feature.BlockEdit]: slashCommandConfig(t)
    }
  })

  crepe.editor.config((ctx) => {
    ctx.update(nodeViewCtx, (views) => [
      ...views,
      ['html', (node) => renderHtmlNodeView(node)],
      ['frontmatter', (node) => renderFrontmatterNodeView(node)]
    ])

    applyImageText(ctx, getT)
    ctx.update(imageBlockConfig.key, (v) => ({ ...v, onUpload: persistImage }))
    ctx.update(inlineImageConfig.key, (v) => ({ ...v, onUpload: persistImage }))

    const mermaidRender = createMermaidPreviewRenderer(getT)
    ctx.update(codeBlockConfig.key, (v) => {
      const prevRender = v.renderPreview
      return {
        ...v,
        languages: [mermaidLanguage, ...(v.languages || [])],
        renderPreview: (language, text, setPreview) => {
          if ((language || '').toLowerCase() === 'mermaid') {
            return mermaidRender(language, text, setPreview)
          }
          return prevRender ? prevRender(language, text, setPreview) : null
        },
        previewOnlyByDefault: true,
        previewLabel: t('mermaid.diagram'),
        previewLoading: t('mermaid.rendering')
      }
    })

    ctx.update(prosePluginsCtx, (plugins) => [
      createStrikeGuardPlugin(),
      ...plugins,
      tableBreakKeymap(),
      mathPreviewPlugin(),
      toolbarAutohidePlugin(),
      createReviewDecorationPlugin({
        getT: (key, fallback) => {
          const value = getT(key)
          return !value || value === key ? fallback : value
        },
        notify: (key, fallback) => notify(getT(key) || fallback),
        copyText: (text, doneKey, doneFallback) =>
          copyText(text, getT(doneKey) || doneFallback)
      }),
      createMermaidSplitPlugin(),
      createSubstitutionLiveReconstructPlugin(),
      createMathBlockPromotionPlugin()
    ])

    ctx.update(remarkStringifyOptionsCtx, (opts) => ({
      ...opts,
      handlers: {
        ...(opts?.handlers || {}),
        break: tableCellBreakHandler,
        highlight: highlightStringifyHandler
      }
    }))

    ctx.update(remarkPluginsCtx, (plugins) => [
      ...plugins,
      { plugin: remarkUnwrapNonAsciiAutolinks, options: undefined },
      { plugin: remarkFrontmatter, options: undefined },
      { plugin: remarkFrontmatterAnywhere, options: undefined },
      { plugin: brToBreakRemarkPlugin, options: undefined },
      { plugin: remarkMergeInlineHtml, options: undefined },
      { plugin: remarkReconstructSubstitution, options: undefined }
    ])
  })

  crepe.editor.use(
    inlineCodeSchema.extendSchema((prev) => (ctx) => ({ ...prev(ctx), inclusive: false }))
  )
  crepe.editor.use(highlightFeatures)
  crepe.editor.use(frontmatterSchema)

  return crepe
}
