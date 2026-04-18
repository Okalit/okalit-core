import { signal, effect, untracked } from 'uhtml';

// Global registry: one channel instance per name, shared across all components
const registry = new Map();

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
    if (channel.ephemeral) continue;
    if (channel._scope !== scope) continue;

    // Reset signal to initial value
    channel.signal.value = channel._initialValue;

    // Remove persisted data
    const storage = getStorage(channel._persist);
    if (storage) {
      storage.removeItem(`okalit:channel:${name}`);
    }
  }
}

export function getChannel(name) {
  return !registry.has(name) ? null : registry.get(name);
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

  const initial = loadFromStorage(name, options) ?? options.initialValue;
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

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function saveToStorage(name, value, options) {
  const storage = getStorage(options.persist);
  if (!storage) return;

  storage.setItem(`okalit:channel:${name}`, JSON.stringify(value));
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

  // Phase 1: create all handles first so they're all available on `this`
  for (const [key, config] of Object.entries(channelDefs)) {
    const channel = getOrCreateChannel(config._channelName, config._channelOptions);

    const handle = {
      set: (value) => channel.set(value),
      get value() {
        return channel.value;
      },
    };

    instance[key] = handle;

    if (config._methodName) {
      deferredEffects.push({ channel, methodName: config._methodName });
    }
  }

  // Phase 2: subscribe effects after all handles exist
  for (const { channel, methodName } of deferredEffects) {
    const callback = (value) => {
      if (typeof instance[methodName] === 'function') {
        instance[methodName](value);
      }
    };

    channel.subscribers.add(callback);
    disposers.push(() => channel.subscribers.delete(callback));

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
