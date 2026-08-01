import { html} from 'lit';
import { Router, navigate } from './router.js';
import { createI18n } from './i18n.js';
import { setDebugMode, setObfuscateMode } from './channel.js';
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
