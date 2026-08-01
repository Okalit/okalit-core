// ── Shared styles ──────────────────────────────────────────────

/**
 * Default CSS for lazy-loading wrapper elements.
 * Shows the default slot only when [loaded] attribute is present;
 * shows fallback slot otherwise.
 */
const SHARED_STYLES = `
  :host { display: contents; }
  ::slotted([slot="fallback"]) { display: none; }
  :host(:not([loaded])) ::slotted(:not([slot])) { display: none; }
  :host(:not([loaded])) ::slotted([slot="fallback"]) { display: contents; }
`;

// ── Shared loader logic ────────────────────────────────────────

/**
 * Executes the loader function(s) on the host element.
 * Handles single functions or arrays, sets the [loaded] attribute on success,
 * and dispatches an 'o-error' CustomEvent on failure.
 *
 * @param {HTMLElement} host — The lazy-loading element (OIdle, OWhen, or OViewport).
 */
async function executeLoader(host) {
  if (host._done || host._loading) return;
  host._loading = true;

  const loaders = Array.isArray(host.loader) ? host.loader : [host.loader];

  try {
    await Promise.all(loaders.map((fn) => fn()));
    host._done = true;
    host.setAttribute('loaded', '');
  } catch (err) {
    host.dispatchEvent(
      new CustomEvent('o-error', {
        detail: err,
        bubbles: true,
        composed: true,
      })
    );
  } finally {
    host._loading = false;
  }
}

/**
 * Applies the shared Shadow DOM structure (styles + slots) to a host element.
 *
 * @param {ShadowRoot} shadowRoot — The shadow root to populate.
 */
function applySharedSetup(shadowRoot) {
  const style = document.createElement('style');
  style.textContent = SHARED_STYLES;
  shadowRoot.append(
    style,
    document.createElement('slot'),                       // default slot
    Object.assign(document.createElement('slot'), { name: 'fallback' }),
  );
}

// ── <o-idle> ───────────────────────────────────────────────────

/**
 * Lazy-loading element that defers its loader execution until the browser is idle.
 * Uses `requestIdleCallback` (or falls back to setTimeout) to avoid blocking
 * the main thread during initial page load.
 *
 * @element o-idle
 *
 * @example
 * <o-idle .loader=${() => import('./heavy-module.js')}>
 *   <heavy-component></heavy-component>
 *   <span slot="fallback">Loading...</span>
 * </o-idle>
 */
export class OIdle extends HTMLElement {
  _done = false;
  _loading = false;
  #loader = null;
  #idleId = null;
  #timeoutId = null;
  #connected = false;

  get loader() { return this.#loader; }
  set loader(fn) {
    if (this._done || this._loading) return;
    this.#loader = fn;
    if (fn && this.#connected) this.#schedule();
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    applySharedSetup(this.shadowRoot);
  }

  connectedCallback() {
    this.#connected = true;
    if (this.#loader) this.#schedule();
  }

  #schedule() {
    if (this._done || this._loading || this.#idleId != null || this.#timeoutId != null) return;
    if (typeof requestIdleCallback === 'function') {
      this.#idleId = requestIdleCallback(() => executeLoader(this));
    } else {
      this.#timeoutId = setTimeout(() => executeLoader(this), 200);
    }
  }

  disconnectedCallback() {
    this.#connected = false;
    if (this.#idleId != null) {
      cancelIdleCallback(this.#idleId);
      this.#idleId = null;
    }
    if (this.#timeoutId != null) {
      clearTimeout(this.#timeoutId);
      this.#timeoutId = null;
    }
  }
}

// ── <o-when> ───────────────────────────────────────────────────

/**
 * Conditional lazy-loading element that executes its loader only when
 * its `condition` property becomes truthy. Useful for on-demand loading
 * triggered by user interaction or application state.
 *
 * @element o-when
 *
 * @example
 * <o-when .condition=${this.showChat} .loader=${() => import('./chat.js')}>
 *   <chat-widget></chat-widget>
 *   <span slot="fallback">Loading chat...</span>
 * </o-when>
 */
export class OWhen extends HTMLElement {
  _done = false;
  _loading = false;
  #loader = null;
  #condition = false;
  #triggered = false;
  #connected = false;

  get loader() { return this.#loader; }
  set loader(fn) {
    if (this._done || this._loading) return;
    this.#loader = fn;
    this.#tryLoad();
  }

  set condition(val) {
    this.#condition = !!val;
    this.#tryLoad();
  }

  #tryLoad() {
    if (this.#triggered || this._done || this._loading || !this.#connected) return;
    if (this.#condition && this.#loader) {
      this.#triggered = true;
      executeLoader(this);
    }
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    applySharedSetup(this.shadowRoot);
  }

  connectedCallback() {
    this.#connected = true;
    this.#tryLoad();
  }

  disconnectedCallback() {
    this.#connected = false;
  }
}

// ── <o-viewport> ───────────────────────────────────────────────

/**
 * Viewport-aware lazy-loading element that executes its loader when
 * the element enters the visible viewport (via IntersectionObserver).
 * Ideal for below-the-fold content that should load on scroll.
 *
 * @element o-viewport
 *
 * @example
 * <o-viewport .loader=${() => import('./footer-section.js')}>
 *   <footer-section></footer-section>
 *   <span slot="fallback">Loading...</span>
 * </o-viewport>
 */
export class OViewport extends HTMLElement {
  _done = false;
  _loading = false;
  #loader = null;
  #observer = null;
  #connected = false;
  #sentinel = null;

  get loader() { return this.#loader; }
  set loader(fn) {
    if (this._done || this._loading) return;
    this.#loader = fn;
    if (fn && this.#connected) this.#observe();
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Sentinel: a 1px element the IntersectionObserver can track,
    // because :host { display: contents } has no box model.
    this.#sentinel = document.createElement('span');
    this.#sentinel.style.cssText = 'display:block;width:1px;height:1px;pointer-events:none;';

    const style = document.createElement('style');
    style.textContent = `
      :host { display: contents; }
      ::slotted([slot="fallback"]) { display: none; }
      :host(:not([loaded])) ::slotted(:not([slot])) { display: none; }
      :host(:not([loaded])) ::slotted([slot="fallback"]) { display: contents; }
    `;
    this.shadowRoot.append(
      style,
      this.#sentinel,
      document.createElement('slot'),
      Object.assign(document.createElement('slot'), { name: 'fallback' }),
    );
  }

  connectedCallback() {
    this.#connected = true;
    if (this.#loader) this.#observe();
  }

  #observe() {
    if (this._done || this._loading || this.#observer) return;
    this.#observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.#observer.disconnect();
            this.#observer = null;
            executeLoader(this);
            return;
          }
        }
      },
      { rootMargin: '200px' }
    );
    this.#observer.observe(this.#sentinel);
  }

  disconnectedCallback() {
    this.#connected = false;
    this.#observer?.disconnect();
    this.#observer = null;
  }
}

// ── Register elements ──────────────────────────────────────────

if (!customElements.get('o-idle'))     customElements.define('o-idle', OIdle);
if (!customElements.get('o-when'))     customElements.define('o-when', OWhen);
if (!customElements.get('o-viewport')) customElements.define('o-viewport', OViewport);
