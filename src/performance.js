// ── Shared styles ──────────────────────────────────────────────

const SHARED_STYLES = `
  :host { display: contents; }
  ::slotted([slot="fallback"]) { display: none; }
  :host(:not([loaded])) ::slotted(:not([slot])) { display: none; }
  :host(:not([loaded])) ::slotted([slot="fallback"]) { display: contents; }
`;

// ── Shared loader logic ────────────────────────────────────────

/**
 * Normalise .loader — accepts a single function or an array.
 * Resolves all imports with Promise.all and flips #isLoaded.
 * On error, dispatches 'o-error' on the host element.
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

export class OWhen extends HTMLElement {
  _done = false;
  _loading = false;
  #loader = null;
  #condition = false;
  #triggered = false;

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
    if (this.#triggered || this._done || this._loading) return;
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
}

// ── <o-viewport> ───────────────────────────────────────────────

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
