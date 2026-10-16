import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPlatform, getPlatformDetails } from '../src/utils.js';

const cases = [
  {
    name: 'Chrome on Windows is web',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
    expected: { type: 'web', runtime: 'browser', os: 'Windows', browser: 'Chrome' },
  },
  {
    name: 'Firefox on Linux is web',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
    expected: { type: 'web', runtime: 'browser', os: 'Linux', browser: 'Firefox' },
  },
  {
    name: 'Safari on iPhone is mobile',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    expected: { type: 'mobile', runtime: 'browser', os: 'iOS', browser: 'Safari' },
  },
  {
    name: 'Chrome on Android is mobile',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123.0 Mobile Safari/537.36',
    expected: { type: 'mobile', runtime: 'browser', os: 'Android', browser: 'Chrome' },
  },
  {
    name: 'iPadOS desktop user agent is mobile',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    maxTouchPoints: 5,
    expected: { type: 'mobile', runtime: 'browser', os: 'iOS', browser: 'Safari' },
  },
  {
    name: 'Capacitor takes precedence over the browser user agent',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/123.0',
    capacitorPlatform: 'android',
    expected: { type: 'mobile', runtime: 'capacitor', os: 'Android', browser: 'WebView' },
  },
  {
    name: 'Electron on Windows is desktop',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/123.0 Electron/29.0',
    expected: { type: 'desktop', runtime: 'electron', os: 'Windows', browser: 'Chromium' },
  },
];

for (const scenario of cases) {
  test(scenario.name, () => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { userAgent: scenario.userAgent, maxTouchPoints: scenario.maxTouchPoints || 0 },
      });
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: scenario.capacitorPlatform
          ? { Capacitor: { getPlatform: () => scenario.capacitorPlatform } }
          : {},
      });
      assert.deepEqual(getPlatformDetails(), scenario.expected);
      assert.equal(getPlatform(), scenario.expected.type);
    } finally {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete globalThis.navigator;
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else delete globalThis.window;
    }
  });
}

test('is safe without browser globals', () => {
  assert.equal(getPlatform(), 'web');
  assert.deepEqual(getPlatformDetails(), {
    type: 'web', runtime: 'browser', os: 'unknown', browser: 'unknown',
  });
});

test('Electron main process can use the host OS without navigator', () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    Object.defineProperty(globalThis.process.versions, 'electron', { configurable: true, value: '29.0' });
    const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || 'unknown';
    assert.deepEqual(getPlatformDetails(), { type: 'desktop', runtime: 'electron', os, browser: 'Chromium' });
  } finally {
    delete globalThis.process.versions.electron;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});