import { html} from 'lit';
import { Router, navigate } from './router.js';
import { createI18n } from './i18n.js';
import { setDebugMode, setObfuscateMode, subscribeChannel } from './channel.js';
import { escapeHtml } from './utils.js';
import './router-outlet.js';

/**
 * Default layout function — simply renders the content as is.
 *
 * @param {*} content — The router outlet content.
 * @returns {*} The unchanged content.
 */
const DEFAULT_LAYOUT = (content) => content;

/**
 * AppMixin — Mixin for the root application component.
 * Initializes the router, i18n, debug mode, and channel obfuscation.
 * Should be applied to a single top-level component.
 *
 * @param {typeof Okalit} Base — The base class to extend.
 * @returns {typeof Okalit} Extended class with router and i18n capabilities.
 *
 * @example
 * class MainApp extends AppMixin(Okalit) {
 *   static config = {
 *     routes: [...],
 *     i18n: { default: 'en', locales: ['en', 'es'] },
 *   };
 * }
 */
export const AppMixin = (Base) => class extends Base {
  static config = {
    routes: [],
    template: DEFAULT_LAYOUT,
    i18n: null,
  };

  constructor() {
    super();

    if (this.constructor.config.modeDebug) {
      setDebugMode(true);
    }

    if (this.constructor.config.obfuscateChannels) {
      setObfuscateMode(true);
    }

    this._router = new Router(this.constructor.config.routes);

    const i18nConfig = this.constructor.config.i18n;
    if (i18nConfig) {
      this._i18n = createI18n(i18nConfig);
    }
  }

  /**
   * Switches the application locale and triggers reactive i18n updates.
   *
   * @param {string} locale — Target locale code (e.g. 'es', 'en').
   * @returns {Promise<void>}
   */
  async switchLocale(locale) {
    await this._i18n?.setLocale(locale);
  }

  /**
   * Returns the router instance for programmatic navigation.
   *
   * @returns {Router}
   */
  get router() {
    return this._router;
  }

  /**
   * Navigates to a path using the application router.
   *
   * @param {string} path — Target path.
   * @param {Object} [options] — Navigation options ({ replace: boolean }).
   */
  navigate(path, options = {}) {
    this._router.navigate(path, options);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._router.destroy();
  }

  render() {
    const layoutFn = this.constructor.config?.template || DEFAULT_LAYOUT;
    return html`${layoutFn(html`<okalit-router></okalit-router>`)}`;
  }
};

/**
 * ModuleMixin — Mixin for feature module components that group related pages.
 * Provides a nested <okalit-router> for rendering child routes and
 * exposes router access for navigation within the module.
 *
 * @param {typeof Okalit} Base — The base class to extend.
 * @returns {typeof Okalit} Extended class with nested routing.
 *
 * @example
 * class CommunityModule extends ModuleMixin(Okalit) {
 *   // Child routes render inside this module's <okalit-router>
 * }
 */
export const ModuleMixin = (Base) => class extends Base {
  /**
   * Returns the global router instance.
   *
   * @returns {Router}
   */
  get router() {
    return Router.getInstance();
  }

  /**
   * Navigates to a path using the global router.
   *
   * @param {string} path — Target path.
   * @param {Object} [options] — Navigation options.
   */
  navigate(path, options = {}) {
    Router.getInstance()?.navigate(path, options);
  }

  render() {
    return html`
        <okalit-router></okalit-router>
    `;
  }
};

/**
 * PageMixin — Mixin for individual page components within a module.
 * Provides router access, route/query param getters with XSS-safe helpers,
 * and navigation utilities.
 *
 * @param {typeof Okalit} Base — The base class to extend.
 * @returns {typeof Okalit} Extended class with page-level helpers.
 *
 * @example
 * class UserPage extends PageMixin(Okalit) {
 *   render() {
 *     return html`<h1>User: ${this.routeParams.id}</h1>`;
 *   }
 * }
 */
export const PageMixin = (Base) => class extends Base {
  get router() {
    return Router.getInstance();
  }

  get routeParams() {
    return Router.getInstance()?.params.value || {};
  }

  get queryParams() {
    return Router.getInstance()?.query.value || {};
  }

  /**
   * Get an HTML-escaped route param, safe for innerHTML/unsafe contexts.
   * Not needed when using Lit's html`` (it escapes by default).
   *
   * @param {string} name — param name (e.g. 'id')
   * @returns {string}
   */
  safeParam(name) {
    return escapeHtml(this.routeParams[name] ?? '');
  }

  /**
   * Get an HTML-escaped query param.
   * @param {string} name
   * @returns {string}
   */
  safeQuery(name) {
    return escapeHtml(this.queryParams[name] ?? '');
  }

  navigate(path, options = {}) {
    Router.getInstance()?.navigate(path, options);
  }

  backRoute() {
    Router.getInstance()?.back();
  }
};

export { navigate };

/**
 * SubscribeChannelsMixin — Mixin for components that need to imperatively
 * subscribe to shared/app-level channels without declaring them in `static channels`.
 *
 * Ideal for catalog components that react to channels owned by the application.
 *
 * @param {typeof Okalit} Base — The base class to extend.
 * @returns {typeof Okalit} Extended class with channel subscription helpers.
 *
 * @example
 * class MyAtom extends SubscribeChannelsMixin(Okalit) {
 *   onSubscribeChannels() {
 *     this.subscribe('ui:theme', (value) => {
 *       this.theme = value;
 *     });
 *
 *     this.subscribe('ui:locale', (value) => {
 *       this.locale = value;
 *     });
 *   }
 * }
 */
export const SubscribeChannelsMixin = (Base) => class extends Base {
  constructor() {
    super();
    this._channelSubscriptions = [];
  }

  /**
   * Subscribe to a channel by name. Returns the channel handle.
   * Subscriptions are automatically cleaned up on disconnect.
   *
   * @param {string} channelName — The channel identifier (e.g. 'ui:theme').
   * @param {Function} [callback] — Optional callback invoked when the channel value changes.
   * @returns {{ value: any, set: Function, reset: Function }|null} The channel handle or null if not found.
   */
  subscribe(channelName, callback) {
    const senderTag = this.tagName?.toLowerCase() || 'unknown';
    const { handle, dispose } = subscribeChannel(channelName, callback, senderTag);
    if (dispose) this._channelSubscriptions.push(dispose);
    return handle;
  }

  /**
   * Emit a value to a channel without storing a handle.
   *
   * @param {string} channelName — The channel identifier.
   * @param {*} value — The value to set.
   */
  channelEmit(channelName, value) {
    const senderTag = this.tagName?.toLowerCase() || 'unknown';
    const { handle } = subscribeChannel(channelName, null, senderTag);
    if (handle) handle.set(value);
  }

  connectedCallback() {
    super.connectedCallback();
    this.onSubscribeChannels();
  }

  disconnectedCallback() {
    for (const dispose of this._channelSubscriptions) dispose();
    this._channelSubscriptions = [];
    super.disconnectedCallback();
  }

  /**
   * Override this hook to subscribe to channels imperatively.
   * Called once when the component is connected to the DOM.
   */
  onSubscribeChannels() {}
};
