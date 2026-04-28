import { LitElement, html } from 'lit';
import { signal, computed, effect, batch } from 'uhtml';
import { initChannels } from './channel.js';

export { html, signal, computed, effect, batch };

export class Okalit extends LitElement {
  static styles = [];
  static props = [];

  constructor() {
    super();
    this._dispose = [];
    this._signals = {};

    this._initProps();
    this._dispose.push(...initChannels(this));
  }

  createRenderRoot() {
    const root = super.createRenderRoot();
    if (this.constructor.styles?.length) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(this.constructor.styles.join('\n'));
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
    return root;
  }

  // --- Lifecycle and Reactivity ---

  _initProps() {
    const props = this.constructor.props;
    if (!props.length) return;

    for (const propDef of props) {
      const [name, config] = Object.entries(propDef)[0];
      this._signals[name] = signal(config.value);

      Object.defineProperty(this, name, {
        get: () => this._signals[name],
        set: (val) => {
          if (val && typeof val === 'object' && 'value' in val && val === this._signals[name]) return;
          const oldVal = this._signals[name].value;
          this._signals[name].value = val;
          this.requestUpdate(name, oldVal);
        },
        configurable: true,
        enumerable: true,
      });
    }
  }

  // This method is what enables your onChange() hook to work
  _watchProps() {
    const props = this.constructor.props;
    if (!props.length) return;

    for (const propDef of props) {
      const [name] = Object.entries(propDef)[0];
      let previous = this._signals[name].value;

      const dispose = effect(() => {
        const current = this._signals[name].value;
        if (previous !== current) {
          const old = previous;
          previous = current;
          this.onChange({ [name]: { previous: old, current } });
        }
      });

      this._dispose.push(dispose);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncAttributes();

    this.onInit();
    this._watchProps();

    let isFirstRun = true;
    this._reactiveEffect = effect(() => {
      try {
        this.render(); 
      } catch(e) { }

      if (!isFirstRun) {
        this.requestUpdate();
      }
      isFirstRun = false;
    });

    this._dispose.push(this._reactiveEffect);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.onDestroy();
    for (const dispose of this._dispose) dispose();
    this._dispose = [];
  }

  // Hook added for the initial DOM render
  firstUpdated(changedProperties) {
    super.firstUpdated(changedProperties);
    this.onFirstRender(changedProperties);
  }

  willUpdate(changedProperties) {
    super.willUpdate(changedProperties);
    // Pass changedProperties to allow conditional checks
    this.onBeforeRender(changedProperties);
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    // Pass changedProperties to allow conditional checks
    this.onAfterRender(changedProperties);
  }

  // --- Lifecycle API (User Hooks) ---
  onInit() { }
  onChange(changes) { }
  onFirstRender(changedProperties) { }
  onBeforeRender(changedProperties) { }
  onAfterRender(changedProperties) { }
  onDestroy() { }

  attributeChangedCallback(name, oldVal, newVal) {
    const propMap = this.constructor._propMap;
    if (!propMap) return;

    const propName = Object.keys(propMap).find(
      key => key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() === name
    );

    if (propName && this._signals && this._signals[propName]) {
      this._signals[propName].value = coerceValue(newVal, propMap[propName].type);
    }
  }

  // --- Utilities ---
  _syncAttributes() {
    const propMap = this.constructor._propMap;
    if (!propMap) return;

    for (const [propName, config] of Object.entries(propMap)) {
      const attr = propName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      if (this.hasAttribute(attr)) {
        this._signals[propName].value = coerceValue(this.getAttribute(attr), config.type);
      }
    }
  }

  output(name, detail) {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    return html``;
  }
}

function coerceValue(value, type) {
  switch (type) {
    case Number: return Number(value);
    case Boolean: return value !== null && value !== 'false';
    default: return value;
  }
}