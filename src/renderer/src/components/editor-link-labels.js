// Milkdown/ProseMirror cannot keep a link mark around inline code in this
// schema. Without this normalization, Markdown like [`name`](file:///x) parses
// as plain inline code and the link URL is lost on the first rich render.
//
// Prefer preserving the link over preserving the code styling for this narrow
// case. Normal inline code and normal links are untouched.
function normalizeCodeOnlyLinkLabels(node) {
  if (!node || typeof node !== 'object') return
  if (
    node.type === 'link' &&
    Array.isArray(node.children) &&
    node.children.length === 1 &&
    node.children[0]?.type === 'inlineCode'
  ) {
    node.children = [{ type: 'text', value: node.children[0].value || '' }]
  }
  if (Array.isArray(node.children)) node.children.forEach(normalizeCodeOnlyLinkLabels)
}

export function remarkNormalizeCodeOnlyLinkLabels() {
  return (tree) => normalizeCodeOnlyLinkLabels(tree)
}
