import { html} from 'lit';
import { Router, navigate } from './router.js';
import { createI18n } from './i18n.js';
import { setDebugMode, setObfuscateMode } from './channel.js';
import { escapeHtml } from './utils.js';
import './router-outlet.js';

/**
 * Default layout function — simply renders the content as is.
 * @param {*} content 
 * @returns 
 */
const DEFAULT_LAYOUT = (content) => content;

/**
 * AppMixin — for the root application component.
 * Initializes the router with the provided routes.
 *
 * Usage:
 *   class MainApp extends AppMixin(Okalit) {
 *     static routes = [...];
 *   }
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

  async switchLocale(locale) {
    await this._i18n?.setLocale(locale);
  }

  get router() {
    return this._router;
  }

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
 * ModuleMixin — for feature modules that group pages.
 * Provides a nested <okalit-router> for child routes.
 *
 * Usage:
 *   class ExampleModule extends ModuleMixin(Okalit) {
 *     render() {
 *       return html`<okalit-router></okalit-router>`;
 *     }
 *   }
 */
export const ModuleMixin = (Base) => class extends Base {
  get router() {
    return Router.getInstance();
  }

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
 * PageMixin — for individual pages within a module.
 * Provides router access and navigation helpers.
 *
 * Usage:
 *   class HomePage extends PageMixin(Okalit) {
 *     render() { ... }
 *   }
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
