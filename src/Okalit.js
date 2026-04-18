import { render, html, signal, computed, effect, batch } from 'uhtml';
import { initChannels } from './channel.js';

export { html, signal, computed, effect, batch };

export class Okalit extends HTMLElement {
  // The @defineElement decorator will populate these static properties
  static styles = [];
  static props = [];
  static params = [];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._initialized = false;
    this._dispose = [];
    this._signals = {};

    // Create reactive signals for each declared prop
    this._initProps();

    // Create reactive signals from URL query params
    this._initParams();

    // Initialize channels declared in static channels
    this._dispose.push(...initChannels(this));
  }

  _initProps() {
    const props = this.constructor.props;
    if (!props.length) return;

    for (const propDef of props) {
      const [name, config] = Object.entries(propDef)[0];
      this._signals[name] = signal(config.value);

      // Public getter/setter so that:
      //   - this.name (get) returns the signal (use .value in templates)
      //   - element.name = 'x' (set) updates the signal (uhtml .prop syntax)
      Object.defineProperty(this, name, {
        get: () => this._signals[name],
        set: (val) => {
          // If someone passes a raw value (uhtml .prop, or JS), update the signal
          if (val && typeof val === 'object' && 'value' in val && val === this._signals[name]) return;
          this._signals[name].value = val;
        },
        configurable: true,
        enumerable: true,
      });
    }
  }

  attributeChangedCallback(attr, oldVal, newVal) {
    // Convert kebab-case attribute to camelCase prop name
    const propName = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const config = this.constructor._propMap?.[propName];
    if (!config) return;

    // Guard: signals may not exist yet during construction
    const sig = this._signals?.[propName];
    if (!sig) return;

    sig.value = coerceValue(newVal, config.type);
  }

  connectedCallback() {
    this._applyStyles();

    // Sync any attributes that were set before signals were ready
    this._syncAttributes();

    if (!this._initialized) {
      this._initialized = true;
      this.onInit();
    }

    // Watch all prop signals for onChange hook
    this._watchProps();

    // Use explicit effect so render() always receives a Hole, not a function.
    // The effect tracks which signals are read during render and re-runs automatically.
    const dispose = effect(() => {
      this.onBeforeRender();
      render(this.shadowRoot, this.render());
      this.onAfterRender();
    });
    this._dispose.push(dispose);
  }

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

  disconnectedCallback() {
    // Clean up all effects
    for (const dispose of this._dispose) dispose();
    this._dispose = [];
    this.onDestroy();
  }

  _applyStyles() {
    const styles = this.constructor.styles;
    if (!styles.length) return;

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles.join('\n'));
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  // --- Lifecycle hooks (override in subclasses) ---

  /** Called once when the element is first connected to the DOM */
  onInit() {}

  /** Called when a prop signal changes: { propName: { previous, current } } */
  onChange(changes) {}

  /** Called before each render */
  onBeforeRender() {}

  /** Called after each render */
  onAfterRender() {}

  /** Called when the element is disconnected from the DOM */
  onDestroy() {}

  /** Emit a custom event that crosses shadow DOM boundaries */
  output(name, detail) {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true,
    }));
  }

  /** Return a uhtml template */
  render() {
    return html``;
  }

  _initParams() {
    const params = this.constructor.params;
    if (!params.length) return;

    const urlParams = new URLSearchParams(window.location.search);

    for (const paramDef of params) {
      const [name, config] = Object.entries(paramDef)[0];
      const raw = urlParams.get(name);
      const value = raw !== null ? coerceValue(raw, config.type) : config.value;

      this._signals[name] = signal(value);

      Object.defineProperty(this, name, {
        get: () => this._signals[name],
        set: (val) => {
          if (val && typeof val === 'object' && 'value' in val && val === this._signals[name]) return;
          this._signals[name].value = val;
        },
        configurable: true,
        enumerable: true,
      });
    }
  }
}

function coerceValue(value, type) {
  switch (type) {
    case Number:  return Number(value);
    case Boolean: return value !== null && value !== 'false';
    default:      return value;
  }
}

