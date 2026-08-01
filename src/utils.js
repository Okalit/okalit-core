/**
 * Traverses Shadow DOM boundaries to query deeply nested elements.
 * Uses ">>" as a separator to pierce through shadow roots.
 *
 * @param {string} selectorPath — A ">>" separated selector path (e.g. "#host >> .child >> span").
 * @param {Element|Document} [context=document] — Starting root element for the query.
 * @returns {Element|null} The matched element or null if not found.
 *
 * @example
 * // Finds <span> inside shadow root of #my-component
 * queryShadowSelector('#my-component >> span');
 */
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

/**
 * Dispatches a bubbling, composed CustomEvent from the given context.
 * Events cross Shadow DOM boundaries thanks to `composed: true`.
 *
 * @param {Element} context — The element that dispatches the event.
 * @param {string} name — The event name (e.g. 'on:submit').
 * @param {*} [detail] — Optional data payload attached to the event.
 */
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