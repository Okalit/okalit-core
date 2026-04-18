import { html} from 'uhtml';
import { Router, navigate } from './router.js';
import { createI18n } from './i18n.js';
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

  navigate(path, options = {}) {
    Router.getInstance()?.navigate(path, options);
  }
};

export { navigate };
