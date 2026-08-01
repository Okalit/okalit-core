import { LitElement, html } from 'lit';
import { signal, computed, effect, batch } from 'uhtml';
import { initChannels } from './channel.js';

export { html, signal, computed, effect, batch };

/**
 * Base class for all Okalit components.
 * Extends LitElement with reactive signals, channel subscriptions,
 * and a simplified lifecycle API.
 *
 * @extends LitElement
 */
export class Okalit extends LitElement {
  /** @type {string[]} — Component-scoped CSS styles injected via adoptedStyleSheets. */
  static styles = [];

  /** @type {Array<Record<string, { value: any, type?: Function }>>} — Reactive prop definitions. */
  static props = [];

  /**
   * Initializes internal state, reactive props, and channel subscriptions.
   * Called automatically by the browser when the element is constructed.
   */
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

  /**
   * Creates the Shadow DOM root and attaches component styles
   * via CSSStyleSheet (adoptedStyleSheets) for optimal performance.
   *
   * @returns {ShadowRoot} The component's shadow root.
   */
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

  /**
   * Initializes reactive signal-backed properties from `static props`.
   * Creates a signal for each prop and defines a getter/setter pair
   * on the instance that bridges attribute changes with signal reactivity.
   *
   * @private
   */
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

  /**
   * Sets up a reactive effect that watches all declared props for changes.
   * When any prop signal value changes, invokes the `onChange()` lifecycle hook
   * with a map of changed props (previous and current values).
   *
   * @private
   */
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

  /**
   * Called when the element is inserted into the DOM.
   * Syncs attributes to props, re-initializes channels if needed,
   * triggers `onInit()`, and starts watching prop changes.
   */
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

  /**
   * Overrides LitElement's update cycle to wrap render() inside a reactive effect.
   * This enables automatic re-renders when signals read during render change,
   * without requiring explicit property declarations for each reactive dependency.
   *
   * @param {Map<string, any>} changedProperties — Map of changed Lit properties.
   */
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

  /**
   * Called when the element is removed from the DOM.
   * Cleans up all reactive effects, prop watchers, and channel subscriptions
   * to prevent memory leaks.
   */
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

  /**
   * Called after the component's first render to the DOM.
   * Delegates to the user-facing `onFirstRender()` hook.
   *
   * @param {Map<string, any>} changedProperties — Map of initially set properties.
   */
  firstUpdated(changedProperties) {
    super.firstUpdated(changedProperties);
    this.onFirstRender(changedProperties);
  }

  /**
   * Called before each render cycle.
   * Delegates to the user-facing `onBeforeRender()` hook.
   *
   * @param {Map<string, any>} changedProperties — Map of properties about to change.
   */
  willUpdate(changedProperties) {
    super.willUpdate(changedProperties);
    this.onBeforeRender(changedProperties);
  }

  /**
   * Called after each render cycle completes.
   * Delegates to the user-facing `onAfterRender()` hook.
   *
   * @param {Map<string, any>} changedProperties — Map of properties that changed.
   */
  updated(changedProperties) {
    super.updated(changedProperties);
    this.onAfterRender(changedProperties);
  }

  // --- Lifecycle API (User Hooks) ---

  /**
   * Hook called once when the component is connected to the DOM.
   * Override in subclasses for initialization logic.
   */
  onInit() { }

  /**
   * Hook called when one or more reactive props change.
   * Receives an object mapping prop names to { previous, current } values.
   *
   * @param {Record<string, { previous: any, current: any }>} changes — Changed props map.
   */
  onChange(changes) { }

  /**
   * Hook called after the component's very first render.
   * Useful for DOM queries that depend on rendered content.
   *
   * @param {Map<string, any>} changedProperties — Initially set properties.
   */
  onFirstRender(changedProperties) { }

  /**
   * Hook called before each render cycle.
   * Useful for computing derived state before the template executes.
   *
   * @param {Map<string, any>} changedProperties — Properties about to change.
   */
  onBeforeRender(changedProperties) { }

  /**
   * Hook called after each render cycle completes.
   * Useful for imperative DOM operations post-render.
   *
   * @param {Map<string, any>} changedProperties — Properties that changed.
   */
  onAfterRender(changedProperties) { }

  /**
   * Hook called when the component is disconnected from the DOM.
   * Override for cleanup logic (timers, subscriptions, etc.).
   */
  onDestroy() { }

  /**
   * Handles attribute changes from the DOM and syncs them to the
   * corresponding reactive signal using type coercion.
   *
   * @param {string} name — The kebab-case attribute name.
   * @param {string|null} oldVal — Previous attribute value.
   * @param {string|null} newVal — New attribute value.
   */
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

  /**
   * Synchronizes all current HTML attributes to their corresponding
   * reactive prop signals on component connection.
   *
   * @private
   */
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

  /**
   * Dispatches a custom event that bubbles through Shadow DOM boundaries.
   * Used to communicate from child to parent components.
   *
   * @param {string} name — Event name (e.g. 'on:submit', 'on:change').
   * @param {*} [detail] — Optional data payload attached to the event.
   */
  output(name, detail) {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * Returns the component's template. Override in subclasses.
   * Uses Lit's html tagged template for efficient DOM updates.
   *
   * @returns {TemplateResult} Lit HTML template.
   */
  render() {
    return html``;
  }
}

/**
 * Coerces a string attribute value to the appropriate JavaScript type.
 *
 * @param {string|null} value — The raw attribute string value.
 * @param {Function} type — The target type constructor (Number, Boolean, or String).
 * @returns {*} The coerced value.
 */
function coerceValue(value, type) {
  switch (type) {
    case Number: return Number(value);
    case Boolean: return value !== null && value !== 'false';
    default: return value;
  }
}