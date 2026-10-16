/**
 * Traverses Shadow DOM boundaries to query deeply nested elements.
 * Uses ">>" as a separator to pierce through shadow roots.
 *
 * @param {string} selectorPath — A ">>" separated selector path (e.g. "#host >> .child >> span").
 * @param {Element|Document} [context=document] — Starting root element for the query.
 * @returns {Element|null} The matched element or null if not found.
 *
 * @example
 * // Finds <span> inside shadow root of #my-component
 * queryShadowSelector('#my-component >> span');
 */
export const queryShadowSelector = function (selectorPath, context = document) {
  if (!selectorPath?.trim()) return null;

  const selectors = selectorPath
    .split('>>')
    .map(selector => selector.trim())
    .filter(Boolean);

  let root = context instanceof Element
    ? context.shadowRoot ?? context
    : context;

  let element = null;

  for (const selector of selectors) {
    element = root?.querySelector?.(selector) ?? null;

    if (!element) return null;

    root = element.shadowRoot;
  }

  return element;
}

/**
 * Dispatches a bubbling, composed CustomEvent from the given context.
 * Events cross Shadow DOM boundaries thanks to `composed: true`.
 *
 * @param {Element} context — The element that dispatches the event.
 * @param {string} name — The event name (e.g. 'on:submit').
 * @param {*} [detail] — Optional data payload attached to the event.
 */
export const outEvent = function (context, name, detail) {
  context.dispatchEvent(new CustomEvent(name, {
    detail,
    bubbles: true,
    composed: true,
  }));
}

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a string for safe insertion into HTML contexts.
 * Use this when you MUST use innerHTML or similar unsafe APIs with user-provided data.
 * Not needed with Lit's html`` — it escapes by default.
 *
 * @param {string} str
 * @returns {string}
 */
export const escapeHtml = function (str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * Returns the application environment: 'web' for desktop browsers,
 * 'mobile' for mobile browsers or native Capacitor apps, and 'desktop' for Electron.
 * Browser/OS detection is best-effort; see getPlatformDetails() for specifics.
 *
 * @returns {'web'|'mobile'|'desktop'}
 */
export function getPlatform() {
  return getPlatformDetails().type;
}

/**
 * Describes the runtime, operating system, and browser independently.
 * UA-reported values may be spoofed or reduced by privacy settings.
 * Does not require Capacitor or Electron as a dependency.
 *
 * @returns {{ type: 'web'|'mobile'|'desktop', runtime: 'browser'|'capacitor'|'electron', os: string, browser: string }}
 */
export function getPlatformDetails() {
  const nav = globalThis.navigator;
  const userAgent = nav?.userAgent || '';
  const platform = nav?.userAgentData?.platform || nav?.platform || '';
  const capacitor = globalThis.Capacitor || globalThis.window?.Capacitor;
  const nativePlatform = typeof capacitor?.getPlatform === 'function' ? capacitor.getPlatform() : null;
  const isCapacitor = nativePlatform === 'ios' || nativePlatform === 'android';
  const isElectron = !isCapacitor && (
    /Electron\//i.test(userAgent) ||
    globalThis.process?.versions?.electron != null
  );
  const isIPad = /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && (nav?.maxTouchPoints || 0) > 1);

  let os = 'unknown';
  if (nativePlatform === 'ios' || isIPad || /iPhone|iPod/i.test(userAgent)) os = 'iOS';
  else if (nativePlatform === 'android' || /Android/i.test(userAgent)) os = 'Android';
  else if (/Windows/i.test(platform) || /Windows NT/i.test(userAgent)) os = 'Windows';
  else if (/Mac/i.test(platform) || /Mac OS X/i.test(userAgent)) os = 'macOS';
  else if (/CrOS/i.test(userAgent)) os = 'ChromeOS';
  else if (/Linux/i.test(platform) || /Linux/i.test(userAgent)) os = 'Linux';
  else if (isElectron) {
    const host = globalThis.process?.platform;
    if (host === 'win32') os = 'Windows';
    else if (host === 'darwin') os = 'macOS';
    else if (host === 'linux') os = 'Linux';
  }

  let browser = 'unknown';
  if (isElectron) browser = 'Chromium';
  else if (isCapacitor) browser = 'WebView';
  else if (/Edg(?:e|A|iOS)?\//i.test(userAgent)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(userAgent)) browser = 'Opera';
  else if (/SamsungBrowser\//i.test(userAgent)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//i.test(userAgent)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//i.test(userAgent)) browser = 'Chrome';
  else if (/Safari\//i.test(userAgent)) browser = 'Safari';

  const type = isElectron ? 'desktop' : isCapacitor || os === 'iOS' || os === 'Android' || nav?.userAgentData?.mobile === true ? 'mobile' : 'web';
  return { type, runtime: isCapacitor ? 'capacitor' : isElectron ? 'electron' : 'browser', os, browser };
}