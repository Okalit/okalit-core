import { signal } from 'uhtml';

// Global signals ensure that the `t()` function can subscribe to them from the very first millisecond,
// even before the I18n instance is fully constructed.
const localeSignal = signal('en');
const versionSignal = signal(0);

let instance = null;

/**
 * Core Internationalization (i18n) class.
 * Implements a singleton pattern to manage application translations.
 */
class I18n {
  /**
   * Initializes the i18n service.
   * @param {Object} config - Configuration options.
   * @param {string} [config.default='en'] - The default fallback locale.
   * @param {string[]} [config.locales=['en']] - Array of supported locales.
   */
  constructor(config) {
    if (instance) return instance;
    instance = this;

    // Expose signals to the instance so other components depending on them don't fail
    this.locale = localeSignal;
    this._version = versionSignal;

    this._translations = {};
    this._defaultLocale = config.default || 'en';
    this._locales = config.locales || [this._defaultLocale];
    this._ready = false;

    this.locale.value = this._detectLocale();
    this._readyPromise = this._loadLocale(this.locale.value);
  }

  /**
   * Returns the singleton instance of the I18n class.
   * @returns {I18n|null}
   */
  static getInstance() {
    return instance;
  }

  /**
   * Detects the user's preferred locale by checking localStorage,
   * then the browser's language, and finally falling back to the default.
   * @private
   * @returns {string} The detected locale code.
   */
  _detectLocale() {
    const stored = localStorage.getItem('okalit:locale');
    if (stored && this._locales.includes(stored)) return stored;

    const browserLang = navigator.language?.split('-')[0];
    if (browserLang && this._locales.includes(browserLang)) return browserLang;

    return this._defaultLocale;
  }

  /**
   * Asynchronously loads the translation JSON file for a given locale.
   * @private
   * @param {string} locale - The locale to load (e.g., 'en', 'es').
   * @returns {Promise<void>}
   */
  async _loadLocale(locale) {
    if (this._translations[locale]) {
      this._ready = true;
      return;
    }

    try {
      const res = await fetch(`/i18n/${locale}.json`);
      this._translations[locale] = await res.json();
      this._ready = true;
    } catch (e) {
      console.warn(`[i18n] Failed to load locale: ${locale}`, e);
      this._translations[locale] = {};
    }
    
    // Increment the version signal AFTER the try/catch block to trigger reactive updates across the app
    this._version.value++;
  }

  /**
   * Changes the active locale, loads its dictionary if needed, and persists the choice.
   * @param {string} locale - The new locale to apply.
   * @returns {Promise<void>}
   */
  async setLocale(locale) {
    if (!this._locales.includes(locale)) {
      console.warn(`[i18n] Unknown locale: ${locale}`);
      return;
    }

    await this._loadLocale(locale);
    this.locale.value = locale;
    localStorage.setItem('okalit:locale', locale);
  }

  /**
   * Translates a key into the current locale.
   * Supports nested keys (e.g., 'NAV.HOME') and parameter interpolation.
   * @param {string} key - The translation key path.
   * @param {Object} [params] - Key-value pairs to interpolate into the string variables.
   * @returns {string} The translated string or the original key if not found.
   */
  translate(key, params) {
    const lang = this.locale.value;
    const dict = this._translations[lang] || {};

    let value = key.split('.').reduce((obj, k) => obj?.[k], dict);

    if (value === undefined) {
      const fallback = this._translations[this._defaultLocale] || {};
      value = key.split('.').reduce((obj, k) => obj?.[k], fallback);
    }

    if (value === undefined) return key;

    if (params) {
      value = value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => params[k] ?? '');
    }

    return value;
  }

  /**
   * A promise that resolves when the initial locale has finished loading.
   * @returns {Promise<void>}
   */
  get ready() {
    return this._readyPromise;
  }

  /**
   * Cleans up the instance (useful for testing or full app resets).
   */
  destroy() {
    instance = null;
  }
}

/**
 * Creates and initializes the global I18n instance.
 * @param {Object} config - Configuration options.
 * @returns {I18n}
 */
export function createI18n(config) {
  return new I18n(config);
}

/**
 * Global translation helper function.
 * Wraps the I18n instance translation and binds it to uhtml's reactive signals.
 * @param {string} key - The translation key.
 * @param {Object} [params] - Key-value pairs for interpolation.
 * @returns {string} The translated string.
 */
export function t(key, params) {
  // ALWAYS read the global signals to guarantee reactivity.
  // This registers the component calling `t()` to re-render automatically when the language or translations change.
  localeSignal.value;
  versionSignal.value;

  const i18n = I18n.getInstance();
  
  if (!i18n) return key;

  return i18n.translate(key, params);
}

/**
 * Retrieves the global I18n instance.
 * @returns {I18n|null}
 */
export function getI18n() {
  return I18n.getInstance();
}