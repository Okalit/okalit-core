import { Router } from './router.js';

/**
 * Custom element that acts as a rendering target for the Okalit router.
 * Automatically determines its nesting depth within the route tree and
 * renders the matched component for that depth level.
 *
 * Supports async route imports with race-condition protection via a
 * version counter — stale renders are discarded if a newer navigation
 * occurs during async loading.
 *
 * @element okalit-router
 */
export class OkalitRouter extends HTMLElement {
  /**
   * Initializes the router outlet with a shadow root and display:contents styling.
   */
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._style = document.createElement('style');
    this._style.textContent = ':host { display: contents; }';
    this.shadowRoot.appendChild(this._style);
    this._currentComponent = null;
    this._currentElement = null;
    this._currentRoute = null;
    this._cache = new Map();
    this._depth = 0;
    this._renderVersion = 0;
  }

  /**
   * On connection, calculates nesting depth by traversing parent shadow roots
   * and registers with the singleton Router instance.
   */
  connectedCallback() {
    this._depth = 0;
    let root = this.getRootNode();
    while (root && root.host) {
      if (root.host.tagName === 'OKALIT-ROUTER') {
        this._depth++;
      }
      root = root.host.getRootNode();
    }

    const router = Router.getInstance();
    if (router) {
      router.registerOutlet(this);
    }
  }

  /**
   * Unregisters this outlet from the Router on disconnection.
   */
  disconnectedCallback() {
    const router = Router.getInstance();
    if (router) {
      router.unregisterOutlet(this);
    }
  }

  /**
   * Renders the matched route component for this outlet's depth level.
   * Handles async imports, prevents stale renders via version guards,
   * and waits for the new element's first render before removing the old one.
   *
   * @param {Object} match — The matched route object from the Router.
   * @param {Array<{ component: string, import?: Function }>} match.chain — Ordered route chain.
   */
  async _renderRoute(match) {
    const route = match.chain[this._depth];
    if (!route) return;

    // Skip if same component already rendered
    if (this._currentComponent === route.component) return;

    // Version guard: if another _renderRoute starts while we await,
    // the earlier one becomes stale and should bail out.
    const version = ++this._renderVersion;

    if (route.import) {
      await route.import();
    }

    // Bail out if a newer render was triggered while awaiting
    if (version !== this._renderVersion) return;

    // Restore from cache if available
    const cached = this._cache.get(route.component);
    if (cached) {
      this._hideOrRemoveCurrent();

      cached.style.display = '';
      this._currentComponent = route.component;
      this._currentElement = cached;
      this._currentRoute = route;

      if (typeof cached.onCacheView === 'function') {
        cached.onCacheView();
      }
      return;
    }

    const el = document.createElement(route.component);
    this.shadowRoot.appendChild(el);

    // Wait for the new element to complete its first render before removing the old one
    if (el.updateComplete) {
      await el.updateComplete;
    }

    // Bail out if a newer render was triggered while awaiting
    if (version !== this._renderVersion) {
      el.remove();
      return;
    }

    this._hideOrRemoveCurrent();

    this._currentComponent = route.component;
    this._currentElement = el;
    this._currentRoute = route;
  }

  /** Hides cacheable elements or removes non-cacheable ones. */
  _hideOrRemoveCurrent() {
    if (!this._currentElement) return;

    if (this._currentRoute?.cache) {
      this._currentElement.style.display = 'none';
      this._cache.set(this._currentComponent, this._currentElement);
      if (typeof this._currentElement.onCacheHide === 'function') {
        this._currentElement.onCacheHide();
      }
    } else {
      this._currentElement.remove();
    }
  }
}

if (!customElements.get('okalit-router')) {
  customElements.define('okalit-router', OkalitRouter);
}
