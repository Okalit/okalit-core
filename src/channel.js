import { signal, effect, untracked } from 'uhtml';

// Global registry: one channel instance per name, shared across all components
const registry = new Map();

// Debug mode flag — toggled by AppMixin when modeDebug: true
let _debugMode = false;

// Obfuscation flag + key — toggled by AppMixin when obfuscateChannels: true
let _obfuscate = false;
const _obfuscateKey = 'okalit:xk';

export function setObfuscateMode(enabled) {
  _obfuscate = enabled;
}

function xorEncode(str, key) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    result += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function obfuscate(jsonString) {
  return btoa(xorEncode(jsonString, _obfuscateKey));
}

function deobfuscate(encoded) {
  return xorEncode(atob(encoded), _obfuscateKey);
}

export function setDebugMode(enabled) {
  _debugMode = enabled;
  if (enabled) {
    window.getChannelAll = getChannelAll;

    console.log(
      '%c[Okalit Debug]%c Channel debug mode enabled',
      'color: #fff; background: #6C5CE7; padding: 2px 6px; border-radius: 3px;',
      'color: #6C5CE7;'
    );
  } else {
    delete window.getChannelAll;
  }
}

/**
 * Define a reactive channel.
 *
 * @param {string} name - Unique channel identifier (e.g. 'ui:theme', 'ui:toast')
 * @param {Object} options
 * @param {*} options.initialValue - Default value (ignored if ephemeral)
 * @param {boolean} options.ephemeral - If true, acts as event bus (no state stored)
 * @param {'memory'|'local'|'session'} options.persist - Storage backend (default: 'memory')
 * @param {'app'|'module'|'page'} options.scope - When to clear (default: 'app')
 * @returns {Function} Factory function to use in static channels
 */
export function defineChannel(name, options = {}) {
  options.persist = options.persist || 'memory';
  options.scope = options.scope || 'app';

  return function (methodName) {
    return {
      _channelName: name,
      _channelOptions: options,
      _methodName: methodName || null,
    };
  };
}

/**
 * Clear all channels matching a given scope.
 * Called by the router when navigation changes.
 */
export function clearChannelsByScope(scope) {
  for (const [name, channel] of registry) {
    if (channel._scope !== scope) continue;

    if (channel.ephemeral) {
      registry.delete(name);
      continue;
    }

    // Reset signal to initial value
    channel.signal.value = structuredClone(channel._initialValue);

    // Remove persisted data
    const storage = getStorage(channel._persist);
    if (storage) {
      storage.removeItem(`okalit:channel:${name}`);
    }

    registry.delete(name);
  }
}

export function getChannelAll() {
  return Array.from(registry.entries()).map(([name, channel]) => ({
    name,
    scope: channel._scope,
    ephemeral: channel.ephemeral,
    value: channel.value,
    subscribersCount: channel.subscribers ? channel.subscribers.size : 0
  }));
}

export function getChannel(name) {
  return !registry.has(name) ? null : registry.get(name);
}

export function getChannelValueStorage(name, storageType = 'local') {
  const storage = getStorage(storageType);
  if (!storage) return null;

  const raw = storage.getItem(`okalit:channel:${name}`);
  if (raw === null) return null;

  try {
    const jsonString = _obfuscate ? deobfuscate(raw) : raw;
    return JSON.parse(jsonString);
  } catch {
    console.warn(`[okalit-channel] Corrupted JSON in storage for "${name}".`);
    storage.removeItem(`okalit:channel:${name}`);
    return null;
  }
}

/**
 * Get or create a shared channel instance from the global registry.
 */
function getOrCreateChannel(name, options) {
  if (registry.has(name)) return registry.get(name);

  const subscribers = new Set();

  if (options.ephemeral) {
    const channel = {
      ephemeral: true,
      _scope: options.scope,
      subscribers,
      set(value) {
        for (const fn of subscribers) fn(value);
      },
      get value() {
        return undefined;
      },
    };
    registry.set(name, channel);
    return channel;
  }

  const initial = loadFromStorage(name, options) ?? structuredClone(options.initialValue);
  const sig = signal(initial);

  const channel = {
    ephemeral: false,
    _scope: options.scope,
    _persist: options.persist,
    _initialValue: options.initialValue,
    signal: sig,
    subscribers,
    set(value) {
      sig.value = value;
      saveToStorage(name, value, options);
    },
    reset() {
      sig.value = structuredClone(options.initialValue);
      const storage = getStorage(options.persist);
      if (storage) storage.removeItem(`okalit:channel:${name}`);
    },
    get value() {
      return sig.value;
    },
  };

  registry.set(name, channel);
  return channel;
}

function loadFromStorage(name, options) {
  const storage = getStorage(options.persist);
  if (!storage) return undefined;

  const raw = storage.getItem(`okalit:channel:${name}`);
  if (raw === null) return undefined;

  let parsed;
  try {
    const jsonString = _obfuscate ? deobfuscate(raw) : raw;
    parsed = JSON.parse(jsonString);
  } catch {
    console.warn(`[okalit-channel] Corrupted JSON in storage for "${name}", discarding.`);
    storage.removeItem(`okalit:channel:${name}`);
    return undefined;
  }

  // Custom validator takes priority
  if (typeof options.validate === 'function') {
    if (!options.validate(parsed)) {
      console.warn(`[okalit-channel] Validation failed for "${name}", discarding stored value.`);
      storage.removeItem(`okalit:channel:${name}`);
      return undefined;
    }
    return parsed;
  }

  // Structural type validation against initialValue
  if (options.initialValue !== undefined && !matchesShape(parsed, options.initialValue)) {
    console.warn(`[okalit-channel] Type mismatch for "${name}", discarding stored value.`);
    storage.removeItem(`okalit:channel:${name}`);
    return undefined;
  }

  return parsed;
}

/**
 * Shallow structural validation — checks that the parsed value
 * matches the basic type/shape of the expected initialValue.
 */
function matchesShape(value, expected) {
  if (expected === null || expected === undefined) return true;

  const expectedType = typeof expected;
  const valueType = typeof value;

  // Primitives: type must match
  if (expectedType !== 'object') return valueType === expectedType;

  // null check
  if (value === null) return false;

  // Array check
  if (Array.isArray(expected)) return Array.isArray(value);

  // Object: verify it's a plain object and top-level keys have matching types
  if (valueType !== 'object' || Array.isArray(value)) return false;

  for (const key of Object.keys(expected)) {
    if (!(key in value)) return false;
    if (expected[key] !== null && expected[key] !== undefined) {
      if (typeof value[key] !== typeof expected[key]) return false;
    }
  }

  return true;
}

function saveToStorage(name, value, options) {
  const storage = getStorage(options.persist);
  if (!storage) return;

  const jsonString = JSON.stringify(value);
  storage.setItem(`okalit:channel:${name}`, _obfuscate ? obfuscate(jsonString) : jsonString);
}

function getStorage(persist) {
  if (persist === 'local') return localStorage;
  if (persist === 'session') return sessionStorage;
  return null;
}

/**
 * Initialize channels declared in static channels.
 * Called from the Okalit base class constructor.
 *
 * @param {HTMLElement} instance - The component instance
 * @returns {Function[]} Dispose functions to clean up subscriptions
 */
export function initChannels(instance) {
  const channelDefs = instance.constructor.channels;
  if (!channelDefs) return [];

  const disposers = [];
  const deferredEffects = [];
  const senderTag = instance.tagName.toLowerCase();

  // Phase 1: create all handles first so they're all available on `this`
  for (const [key, config] of Object.entries(channelDefs)) {
    const channel = getOrCreateChannel(config._channelName, config._channelOptions);
    const channelName = config._channelName;

    const handle = {
      set: (value) => {
        if (_debugMode) {
          _logChannelSet(channelName, senderTag, value, channel);
        }
        channel.set(value);
      },
      reset: () => channel.reset?.(),
      get value() {
        return channel.value;
      },
    };

    instance[key] = handle;

    if (config._methodName) {
      deferredEffects.push({ channel, methodName: config._methodName, channelName });
    }
  }

  // Phase 2: subscribe effects after all handles exist
  for (const { channel, methodName, channelName } of deferredEffects) {
    const callback = (value) => {
      if (typeof instance[methodName] === 'function') {
        if (_debugMode) {
          _logChannelReceive(channelName, senderTag, methodName, value);
        }
        instance[methodName](value);
      }
    };

    // Track subscriber metadata for debug logging
    if (!channel._subscriberMeta) channel._subscriberMeta = new Map();
    channel._subscriberMeta.set(callback, senderTag);

    channel.subscribers.add(callback);
    disposers.push(() => {
      channel.subscribers.delete(callback);
      channel._subscriberMeta?.delete(callback);
    });

    if (!channel.ephemeral) {
      const dispose = effect(() => {
        const current = channel.signal.value;
        untracked(() => callback(current));
      });
      disposers.push(dispose);
    }
  }

  return disposers;
}

// --- Debug logging helpers ---

function _logChannelSet(channelName, senderTag, value, channel) {
  const time = new Date();
  const receivers = channel._subscriberMeta
    ? [...channel._subscriberMeta.values()].map(t => `<${t}>`)
    : [];

  console.groupCollapsed(
    `%c[Channel SET]%c ${channelName} %c← <${senderTag}>`,
    'color: #fff; background: #6C5CE7; padding: 2px 6px; border-radius: 3px;',
    'color: #6C5CE7; font-weight: bold;',
    'color: #888;'
  );
  console.log('%cTime:     %c%s', 'font-weight:bold', 'font-weight:normal', time);
  console.log('%cSender:   %c<%s>', 'font-weight:bold', 'font-weight:normal', senderTag);
  console.log('%cValue:    ', 'font-weight:bold', value);
  console.log('%cReceivers:%c %s', 'font-weight:bold', 'font-weight:normal', receivers.join(', ') || '(none)');
  console.groupEnd();
}

function _logChannelReceive(channelName, receiverTag, methodName, value) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });

  console.log(
    `%c[Channel RCV]%c ${channelName} %c→ <${receiverTag}>.${methodName}()`,
    'color: #fff; background: #00B894; padding: 2px 6px; border-radius: 3px;',
    'color: #00B894; font-weight: bold;',
    'color: #888;',
    `| ${time} |`,
    value
  );
}
