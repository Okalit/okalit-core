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