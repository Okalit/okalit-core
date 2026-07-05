// this.findInShadowRoot("#id >> element-tag");
export const queryShadowSelector = function (selectorPath, context = document) {
  if (!selectorPath?.trim()) return null;

  const selectors = selectorPath
    .split('>>')
    .map(selector => selector.trim())
    .filter(Boolean);

  let root = context instanceof Element
    ? context.shadowRoot ?? context
    : context;

  let element = null;

  for (const selector of selectors) {
    element = root?.querySelector?.(selector) ?? null;

    if (!element) return null;

    root = element.shadowRoot;
  }

  return element;
}

export const outEvent = function (context, name, detail) {
  context.dispatchEvent(new CustomEvent(name, {
    detail,
    bubbles: true,
    composed: true,
  }));
}

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a string for safe insertion into HTML contexts.
 * Use this when you MUST use innerHTML or similar unsafe APIs with user-provided data.
 * Not needed with Lit's html`` — it escapes by default.
 *
 * @param {string} str
 * @returns {string}
 */
export const escapeHtml = function (str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}