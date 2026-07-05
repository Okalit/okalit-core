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
    this._reactiveEffect = null;
    this._propsEffect = null;
    this._channelsInitialized = false;

    this._initProps();
    this._initChannelDisposers = initChannels(this);
    this._dispose.push(...this._initChannelDisposers);
    this._channelsInitialized = true;
  }

  createRenderRoot() {
    const root = super.createRenderRoot();
    const ctor = this.constructor;

    if (ctor.styles?.length) {
      if (!ctor.__sheet) {
        ctor.__sheet = new CSSStyleSheet();
        ctor.__sheet.replaceSync(ctor.styles.join('\n'));
      }
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, ctor.__sheet];
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

    // Dispose previous watcher if reconnecting
    if (this._propsEffect) {
      this._propsEffect();
      this._propsEffect = null;
    }

    const previousValues = {};
    for (const propDef of props) {
      const [name] = Object.entries(propDef)[0];
      previousValues[name] = this._signals[name].value;
    }

    const dispose = effect(() => {
      const changes = {};
      let hasChanges = false;

      for (const propDef of props) {
        const [name] = Object.entries(propDef)[0];
        const current = this._signals[name].value; 

        if (previousValues[name] !== current) {
          changes[name] = { previous: previousValues[name], current };
          previousValues[name] = current;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        this.onChange(changes);
      }
    });

    this._propsEffect = dispose;
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncAttributes();

    // Re-initialize channels if reconnecting after a disconnect
    if (!this._channelsInitialized && this.constructor.channels) {
      this._initChannelDisposers = initChannels(this);
      this._dispose.push(...this._initChannelDisposers);
    }

    this.onInit();
    this._watchProps();
  }

  update(changedProperties) {
    // Dispose previous signal tracking to prevent leaks
    if (this._reactiveEffect) {
      this._reactiveEffect();
      this._reactiveEffect = null;
    }

    // Wrap LitElement's update (which calls render()) inside an effect
    // so signal reads are tracked automatically — render only runs once.
    let firstRun = true;
    this._reactiveEffect = effect(() => {
      if (firstRun) {
        super.update(changedProperties);
        firstRun = false;
      } else {
        // Defer re-render to avoid triggering Lit's "update after update" warning.
        // Nested effects from child components can cause the signal system to
        // re-evaluate this effect synchronously during _$didUpdate.
        queueMicrotask(() => this.requestUpdate());
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.onDestroy();

    // Clean up reactive effect separately
    if (this._reactiveEffect) {
      this._reactiveEffect();
      this._reactiveEffect = null;
    }

    // Clean up props watcher
    if (this._propsEffect) {
      this._propsEffect();
      this._propsEffect = null;
    }

    for (const dispose of this._dispose) dispose();
    this._dispose = [];
    this._initChannelDisposers = [];
    this._channelsInitialized = false;
  }

  // Hook added for the initial DOM render
  firstUpdated(changedProperties) {
    super.firstUpdated(changedProperties);
    this.onFirstRender(changedProperties);
  }

  willUpdate(changedProperties) {
    super.willUpdate(changedProperties);
    this.onBeforeRender(changedProperties);
  }

  updated(changedProperties) {
    super.updated(changedProperties);
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