import { Router } from './router.js';

export class OkalitRouter extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host { display: contents; }';
    this.shadowRoot.appendChild(style);
    this._currentComponent = null;
    this._depth = 0;
    this._renderVersion = 0;
  }

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

  disconnectedCallback() {
    const router = Router.getInstance();
    if (router) {
      router.unregisterOutlet(this);
    }
  }

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

    this._currentComponent = route.component;

    this.shadowRoot.innerHTML = '';
    const el = document.createElement(route.component);
    this.shadowRoot.appendChild(el);
  }
}

if (!customElements.get('okalit-router')) {
  customElements.define('okalit-router', OkalitRouter);
}
