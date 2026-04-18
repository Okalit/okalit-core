import { signal, computed } from 'uhtml';

let instance = null;

class I18n {
  constructor(config) {
    if (instance) return instance;
    instance = this;

    this._translations = {};
    this._defaultLocale = config.default || 'en';
    this._locales = config.locales || [this._defaultLocale];
    this.locale = signal(this._detectLocale());
    this._version = signal(0);
    this._ready = false;
    this._readyPromise = this._loadLocale(this.locale.value);
  }

  static getInstance() {
    return instance;
  }

  _detectLocale() {
    // Check localStorage first, then browser language
    const stored = localStorage.getItem('okalit:locale');
    if (stored && this._locales.includes(stored)) return stored;

    const browserLang = navigator.language?.split('-')[0];
    if (browserLang && this._locales.includes(browserLang)) return browserLang;

    return this._defaultLocale;
  }

  async _loadLocale(locale) {
    if (this._translations[locale]) {
      this._ready = true;
      return;
    }

    try {
      const res = await fetch(`/i18n/${locale}.json`);
      this._translations[locale] = await res.json();
      this._ready = true;
      this._version.value++;
    } catch (e) {
      console.warn(`[i18n] Failed to load locale: ${locale}`, e);
      this._translations[locale] = {};
    }
  }

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
   * Translate a key. Supports nested keys with dots: t('SECTION.KEY')
   * Supports interpolation: t('HELLO', { name: 'World' }) → "Hello, World"
   */
  translate(key, params) {
    const lang = this.locale.value;
    const dict = this._translations[lang] || {};

    // Support nested keys: 'SECTION.KEY'
    let value = key.split('.').reduce((obj, k) => obj?.[k], dict);

    if (value === undefined) {
      // Fallback to default locale
      const fallback = this._translations[this._defaultLocale] || {};
      value = key.split('.').reduce((obj, k) => obj?.[k], fallback);
    }

    if (value === undefined) return key;

    // Interpolation: replace {{ name }} with params.name
    if (params) {
      value = value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => params[k] ?? '');
    }

    return value;
  }

  get ready() {
    return this._readyPromise;
  }

  destroy() {
    instance = null;
  }
}

/**
 * Initialize i18n. Called from AppMixin.
 */
export function createI18n(config) {
  return new I18n(config);
}

/**
 * Translate a key. Reactive — re-renders when locale changes.
 * Usage: t('WELCOME') or t('HELLO', { name: 'World' })
 */
export function t(key, params) {
  const i18n = I18n.getInstance();
  if (!i18n) return key;
  // Reading locale.value + _version makes this reactive inside uhtml effects
  i18n.locale.value;
  i18n._version.value;
  i18n.locale.value;
  return i18n.translate(key, params);
}

/**
 * Get the i18n instance for setLocale, etc.
 */
export function getI18n() {
  return I18n.getInstance();
}
