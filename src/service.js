// ── RequestControl ─────────────────────────────────────────────
// Wraps a Promise (typically from fetch) and exposes a declarative
// fire() API for loading / success / error / finish callbacks,
// while still being await-able via then().

export class RequestControl {
  #promise;

  constructor(promise) {
    this.#promise = promise;
  }

  /**
   * Declarative async flow handler.
   *
   * @param {Object} callbacks
   * @param {(loading: boolean) => void} [callbacks.onLoading]
   * @param {(data: any) => void}        [callbacks.onSuccess]
   * @param {(error: any) => void}       [callbacks.onError]
   * @param {() => void}                 [callbacks.onFinish]
   */
  fire({ onLoading, onSuccess, onError, onFinish } = {}) {
    onLoading?.(true);

    this.#promise
      .then((data) => {
        onSuccess?.(data);
      })
      .catch((err) => {
        onError?.(err);
      })
      .finally(() => {
        onLoading?.(false);
        onFinish?.();
      });
  }

  /** Allow `await service.getX()` without calling fire(). */
  then(resolve, reject) {
    return this.#promise.then(resolve, reject);
  }

  catch(reject) {
    return this.#promise.catch(reject);
  }

  finally(cb) {
    return this.#promise.finally(cb);
  }
}

// ── StreamControl ──────────────────────────────────────────────
// Wraps a Promise<stream> and exposes a declarative listen() API
// for server-streaming gRPC calls.

export class StreamControl {
  #streamPromise;
  #cancelled = false;
  #stream = null;

  constructor(streamPromise) {
    this.#streamPromise = streamPromise;
    streamPromise.then(s => { this.#stream = s; });
  }

  /**
   * Declarative stream handler.
   *
   * @param {Object} callbacks
   * @param {(data: any) => void}   [callbacks.onData]
   * @param {(error: any) => void}  [callbacks.onError]
   * @param {() => void}            [callbacks.onEnd]
   * @param {(status: any) => void} [callbacks.onStatus]
   */
  listen({ onData, onError, onEnd, onStatus } = {}) {
    this.#streamPromise
      .then((stream) => {
        if (this.#cancelled) return;
        if (onData) stream.on('data', onData);
        if (onError) stream.on('error', onError);
        if (onEnd) stream.on('end', onEnd);
        if (onStatus) stream.on('status', onStatus);
      })
      .catch((err) => {
        onError?.(err);
      });
  }

  /** Cancel the stream. */
  cancel() {
    this.#cancelled = true;
    this.#stream?.cancel();
  }
}

// ── Custom error classes ───────────────────────────────────────

export class HttpError extends Error {
  constructor(status, statusText, body) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export class GraphqlError extends Error {
  constructor(errors, data) {
    super(errors.map(e => e.message).join('; '));
    this.name = 'GraphqlError';
    this.errors = errors;
    this.data = data;
  }
}

export class GrpcError extends Error {
  constructor(code, message, metadata) {
    super(`gRPC ${code}: ${message}`);
    this.name = 'GrpcError';
    this.code = code;
    this.grpcMessage = message;
    this.metadata = metadata;
  }
}

/** Standard gRPC status codes. */
export const GrpcStatus = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
};

// ── Service registry ───────────────────────────────────────────

const _registry = new Map();

/**
 * Decorator — registers the class as a singleton service.
 *
 * Usage:
 *   @service('user')
 *   class UserService extends OkalitService { … }
 */
export function service(name) {
  return function (cls, context) {
    context.addInitializer(function () {
      if (_registry.has(name)) {
        throw new Error(
          `[service] Duplicate registration: "${name}" is already registered. ` +
          `Check that only one class uses @service("${name}").`
        );
      }
      _registry.set(name, new cls());
    });
  };
}

/**
 * Retrieve a registered service singleton by name.
 *
 * Usage:
 *   userApi = inject('user');
 */
export function inject(name) {
  const instance = _registry.get(name);
  if (!instance) {
    throw new Error(`[inject] Service "${name}" not found. Make sure the file is imported and @service("${name}") is applied.`);
  }
  return instance;
}

// ── RateLimiter (Token Bucket) ─────────────────────────────────

class RateLimiter {
  #tokens;
  #maxTokens;
  #refillRate;
  #lastRefill;

  /**
   * @param {Object} opts
   * @param {number} opts.maxRequests — max tokens (burst capacity)
   * @param {number} opts.perSeconds — refill window in seconds
   */
  constructor({ maxRequests = 10, perSeconds = 1 } = {}) {
    this.#maxTokens = maxRequests;
    this.#tokens = maxRequests;
    this.#refillRate = maxRequests / perSeconds;
    this.#lastRefill = Date.now();
  }

  #refill() {
    const now = Date.now();
    const elapsed = (now - this.#lastRefill) / 1000;
    this.#tokens = Math.min(this.#maxTokens, this.#tokens + elapsed * this.#refillRate);
    this.#lastRefill = now;
  }

  async acquire() {
    this.#refill();

    if (this.#tokens >= 1) {
      this.#tokens--;
      return;
    }

    const waitMs = ((1 - this.#tokens) / this.#refillRate) * 1000;
    await new Promise(resolve => setTimeout(resolve, waitMs));
    this.#refill();
    this.#tokens--;
  }
}

// ── Shared fetch infrastructure ────────────────────────────────

class BaseService {
  _headers = { 'Content-Type': 'application/json' };
  _cache = new Map();
  _cacheEnabled = false;
  _cacheTTL = 0;
  _timeout = 0;
  _interceptors = [];
  _responseInterceptors = [];
  _rateLimiter = null;
  _retryConfig = { attempts: 1, backoff: 1000, factor: 2 };

  _configureMixin({ headers, cache, cacheTTL, timeout, interceptors, responseInterceptors, rateLimit, retry } = {}) {
    if (headers !== undefined) this._headers = { ...this._headers, ...headers };
    if (cache !== undefined) this._cacheEnabled = cache;
    if (cacheTTL !== undefined) this._cacheTTL = cacheTTL;
    if (timeout !== undefined) this._timeout = timeout;
    if (interceptors !== undefined) this._interceptors = Array.isArray(interceptors) ? interceptors : [interceptors];
    if (responseInterceptors !== undefined) this._responseInterceptors = Array.isArray(responseInterceptors) ? responseInterceptors : [responseInterceptors];
    if (rateLimit) this._rateLimiter = new RateLimiter(rateLimit);
    if (retry) this._retryConfig = { ...this._retryConfig, ...retry };
  }

  async _runInterceptors(url, options) {
    let currentUrl = url;
    let currentOptions = { ...options, headers: { ...this._headers, ...options.headers } };

    for (const interceptor of this._interceptors) {
      const result = await interceptor({ url: currentUrl, options: currentOptions });

      if (!result) {
        throw new HttpError(0, 'Cancelled', { message: 'Request rejected' });
      }

      currentUrl = result.url || currentUrl;
      currentOptions = result.options || currentOptions;
    }

    return { url: currentUrl, options: currentOptions };
  }

  async _runResponseInterceptors(data, error) {
    let currentData = data;
    let currentError = error;

    for (const interceptor of this._responseInterceptors) {
      const result = await interceptor({ data: currentData, error: currentError });
      currentData = result?.data !== undefined ? result.data : currentData;
      currentError = result?.error !== undefined ? result.error : currentError;
    }

    if (currentError) throw currentError;
    return structuredClone(currentData);
  }

  _getCached(key, cacheable = true) {
    if (!cacheable || !this._cacheEnabled) return null;
    const cached = this._cache.get(key);
    if (!cached) return null;
    if (this._cacheTTL > 0 && Date.now() - cached.time >= this._cacheTTL) return null;
    return cached;
  }

  _setCache(key, promise) {
    if (!this._cacheEnabled) return;
    this._cache.set(key, { status: 'pending', promise, time: Date.now() });
    promise
      .then(data => this._cache.set(key, { status: 'resolved', data, time: Date.now() }))
      .catch(() => this._cache.delete(key));
  }

  clearCache(key) {
    if (!key) {
      this._cache.clear();
      return;
    }
    for (const k of this._cache.keys()) {
      if (k.includes(key)) this._cache.delete(k);
    }
  }
}

// ── OkalitService (REST) ───────────────────────────────────────

export class OkalitService extends BaseService {
  #baseUrl = '';

  /**
   * Configure the service instance.
   *
   * @param {Object} opts
   * @param {string}  [opts.baseUrl]
   * @param {Record<string, string>} [opts.headers]
   * @param {boolean} [opts.cache]    — enable/disable in-memory cache (default: false)
   * @param {number}  [opts.cacheTTL] — cache lifetime in ms (0 = forever until clearCache)
   * @param {number}  [opts.timeout]  — request timeout in ms (0 = no timeout)
   * @param {Object[]} [opts.interceptors] — request interceptors
   * @param {Object[]} [opts.responseInterceptors] — response interceptors
   * @param {{ maxRequests?: number, perSeconds?: number }} [opts.rateLimit] — token bucket rate limiter
   * @param {{ attempts?: number, backoff?: number, factor?: number }} [opts.retry] — retry with exponential backoff (only retries 5xx and timeouts)
   */
  configure({ baseUrl, ...rest } = {}) {
    if (baseUrl !== undefined) this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this._configureMixin(rest);
  }

  // ── HTTP helpers ───────────────────────────────────────────

  get(path, params) {
    let url = `${this.#baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return new RequestControl(this.#request(url, { method: 'GET' }, true));
  }

  post(path, body) {
    return new RequestControl(this.#request(`${this.#baseUrl}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }));
  }

  put(path, body) {
    return new RequestControl(this.#request(`${this.#baseUrl}${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }));
  }

  patch(path, body) {
    return new RequestControl(this.#request(`${this.#baseUrl}${path}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }));
  }

  delete(path) {
    return new RequestControl(this.#request(`${this.#baseUrl}${path}`, {
      method: 'DELETE',
    }));
  }

  /** Clear the in-memory cache (all entries or a specific path). */
  clearCache(path) {
    if (!path) {
      this._cache.clear();
      return;
    }
    const prefix = `${this.#baseUrl}${path}`;
    for (const key of this._cache.keys()) {
      if (key.startsWith(prefix)) this._cache.delete(key);
    }
  }

  // ── Internal ───────────────────────────────────────────────

  async #request(url, options, cacheable = false) {
    // Rate-limit: wait for an available token before proceeding
    if (this._rateLimiter) await this._rateLimiter.acquire();

    const intercepted = await this._runInterceptors(url, options);

    const cached = this._getCached(intercepted.url, cacheable);
    if (cached) {
      const data = cached.status === 'pending' ? await cached.promise : cached.data;
      return this._runResponseInterceptors(data, null);
    }

    const { attempts, backoff, factor } = this._retryConfig;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const data = await this.#executeFetch(intercepted, cacheable);
        return this._runResponseInterceptors(data, null);
      } catch (err) {
        const isRetryable = (err instanceof HttpError && err.status >= 500) || err.name === 'AbortError';
        const isLast = attempt === attempts - 1;

        if (!isRetryable || isLast) {
          return this._runResponseInterceptors(null, err);
        }

        const delay = backoff * Math.pow(factor, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async #executeFetch(intercepted, cacheable) {
    let controller;
    let timeoutId;
    const fetchOptions = { ...intercepted.options };

    if (this._timeout > 0) {
      controller = new AbortController();
      fetchOptions.signal = controller.signal;
      timeoutId = setTimeout(() => controller.abort(), this._timeout);
    }

    const promise = fetch(intercepted.url, fetchOptions).then(async (res) => {
      if (!res.ok) {
        let body;
        try { body = await res.json(); } catch { body = { message: res.statusText }; }
        throw new HttpError(res.status, res.statusText, body);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }).catch((err) => {
      if (err.name === 'AbortError') {
        throw new HttpError(0, 'Request Timeout', { message: `Request exceeded ${this._timeout}ms` });
      }
      throw err;
    }).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });

    if (cacheable) this._setCache(intercepted.url, promise);

    return promise;
  }
}

// ── OkalitSocketService (WebSocket) ────────────────────────────

export class OkalitSocketService {
  #url = '';
  #socket = null;
  #listeners = new Map();
  #reconnect = true;
  #reconnectInterval = 1000;
  #reconnectMaxInterval = 30000;
  #reconnectAttempts = 0;
  #maxReconnectAttempts = Infinity;
  #reconnectTimer = null;
  #protocols = [];
  #headers = {};
  #interceptors = [];
  #manualClose = false;
  #pingInterval = 0;
  #pingTimer = null;
  #serializer = JSON.stringify;
  #deserializer = JSON.parse;

  /**
   * @param {Object} opts
   * @param {string}  opts.url — WebSocket server URL (ws:// or wss://)
   * @param {string|string[]} [opts.protocols] — sub-protocols
   * @param {boolean} [opts.reconnect] — auto-reconnect on disconnect (default: true)
   * @param {number}  [opts.reconnectInterval] — initial delay in ms (default: 1000)
   * @param {number}  [opts.reconnectMaxInterval] — max backoff delay (default: 30000)
   * @param {number}  [opts.maxReconnectAttempts] — max retry attempts (default: Infinity)
   * @param {number}  [opts.pingInterval] — keepalive ping interval in ms (0 = disabled)
   * @param {Function} [opts.serializer] — message serializer (default: JSON.stringify)
   * @param {Function} [opts.deserializer] — message deserializer (default: JSON.parse)
   * @param {Object[]} [opts.interceptors] — outgoing message interceptors
   */
  configure({
    url,
    protocols,
    reconnect,
    reconnectInterval,
    reconnectMaxInterval,
    maxReconnectAttempts,
    pingInterval,
    serializer,
    deserializer,
    interceptors,
  } = {}) {
    if (url !== undefined) this.#url = url;
    if (protocols !== undefined) this.#protocols = Array.isArray(protocols) ? protocols : [protocols];
    if (reconnect !== undefined) this.#reconnect = reconnect;
    if (reconnectInterval !== undefined) this.#reconnectInterval = reconnectInterval;
    if (reconnectMaxInterval !== undefined) this.#reconnectMaxInterval = reconnectMaxInterval;
    if (maxReconnectAttempts !== undefined) this.#maxReconnectAttempts = maxReconnectAttempts;
    if (pingInterval !== undefined) this.#pingInterval = pingInterval;
    if (serializer !== undefined) this.#serializer = serializer;
    if (deserializer !== undefined) this.#deserializer = deserializer;
    if (interceptors !== undefined) this.#interceptors = Array.isArray(interceptors) ? interceptors : [interceptors];
  }

  /** Current connection state. */
  get state() {
    if (!this.#socket) return 'CLOSED';
    switch (this.#socket.readyState) {
      case WebSocket.CONNECTING: return 'CONNECTING';
      case WebSocket.OPEN: return 'OPEN';
      case WebSocket.CLOSING: return 'CLOSING';
      case WebSocket.CLOSED: return 'CLOSED';
      default: return 'CLOSED';
    }
  }

  /** Whether the socket is currently open and ready. */
  get connected() {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Open the WebSocket connection.
   * Resolves when connected, rejects on error.
   */
  connect(url) {
    if (url) this.#url = url;
    this.#manualClose = false;

    return new Promise((resolve, reject) => {
      if (this.connected) { resolve(); return; }

      this.#socket = new WebSocket(this.#url, this.#protocols);

      this.#socket.onopen = () => {
        this.#reconnectAttempts = 0;
        this.#startPing();
        this.#emit('open');
        resolve();
      };

      this.#socket.onclose = (event) => {
        this.#stopPing();
        this.#emit('close', event);
        if (!this.#manualClose && this.#reconnect) {
          this.#scheduleReconnect();
        }
      };

      this.#socket.onerror = (event) => {
        this.#emit('error', event);
        if (this.#socket?.readyState === WebSocket.CONNECTING) {
          reject(event);
        }
      };

      this.#socket.onmessage = (event) => {
        let data = event.data;
        try { data = this.#deserializer(event.data); } catch { /* raw data */ }
        this.#emit('message', data);
      };
    });
  }

  /**
   * Close the WebSocket connection gracefully.
   * @param {number} [code] — close status code
   * @param {string} [reason] — close reason
   */
  disconnect(code = 1000, reason = '') {
    this.#manualClose = true;
    this.#stopPing();
    clearTimeout(this.#reconnectTimer);
    if (this.#socket) {
      this.#socket.close(code, reason);
      this.#socket = null;
    }
  }

  /**
   * Send a message through the socket.
   * Runs outgoing interceptors before sending.
   *
   * @param {string} event — event/type name
   * @param {*} payload — data payload
   */
  async send(event, payload) {
    if (!this.connected) {
      throw new Error('[OkalitSocketService] Cannot send — socket not connected.');
    }

    let message = { event, payload };

    for (const interceptor of this.#interceptors) {
      const result = await interceptor(message);
      if (!result) return; // interceptor cancelled the message
      message = result;
    }

    this.#socket.send(this.#serializer(message));
  }

  /**
   * Send raw data without event wrapping.
   * @param {*} data — data to send (will be serialized)
   */
  sendRaw(data) {
    if (!this.connected) {
      throw new Error('[OkalitSocketService] Cannot send — socket not connected.');
    }
    const serialized = typeof data === 'string' ? data : this.#serializer(data);
    this.#socket.send(serialized);
  }

  /**
   * Subscribe to a socket event.
   *
   * @param {string} event — 'open' | 'close' | 'error' | 'message' | custom event
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Subscribe to a socket event once.
   *
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  once(event, callback) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      callback(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe from a socket event.
   *
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    this.#listeners.get(event)?.delete(callback);
  }

  /** Remove all listeners for an event, or all listeners entirely. */
  removeAllListeners(event) {
    if (event) {
      this.#listeners.delete(event);
    } else {
      this.#listeners.clear();
    }
  }

  // ── Internal ───────────────────────────────────────────────

  #emit(event, data) {
    const listeners = this.#listeners.get(event);
    if (listeners) {
      for (const cb of listeners) cb(data);
    }
  }

  #scheduleReconnect() {
    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      this.#emit('reconnect_failed');
      return;
    }

    const delay = Math.min(
      this.#reconnectInterval * Math.pow(2, this.#reconnectAttempts),
      this.#reconnectMaxInterval,
    );

    this.#reconnectAttempts++;
    this.#emit('reconnecting', { attempt: this.#reconnectAttempts, delay });

    this.#reconnectTimer = setTimeout(() => {
      this.connect().catch(() => { /* reconnect will retry via onclose */ });
    }, delay);
  }

  #startPing() {
    if (this.#pingInterval <= 0) return;
    this.#pingTimer = setInterval(() => {
      if (this.connected) {
        this.sendRaw(JSON.stringify({ type: 'ping' }));
      }
    }, this.#pingInterval);
  }

  #stopPing() {
    clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }
}

// ── OkalitGrpcService (gRPC-Web) ───────────────────────────────

export class OkalitGrpcService {
  #host = '';
  #metadata = {};
  #interceptors = [];
  #responseInterceptors = [];
  #clients = new Map();

  /**
   * @param {Object} opts
   * @param {string}  opts.host — gRPC server URL (through Envoy / grpc-web proxy)
   * @param {Record<string, string>} [opts.metadata] — default metadata sent with every call
   * @param {Function[]} [opts.interceptors] — metadata interceptors (outgoing)
   * @param {Function[]} [opts.responseInterceptors] — response interceptors
   */
  configure({ host, metadata, interceptors, responseInterceptors } = {}) {
    if (host !== undefined) this.#host = host.replace(/\/+$/, '');
    if (metadata !== undefined) this.#metadata = { ...this.#metadata, ...metadata };
    if (interceptors !== undefined) this.#interceptors = Array.isArray(interceptors) ? interceptors : [interceptors];
    if (responseInterceptors !== undefined) this.#responseInterceptors = Array.isArray(responseInterceptors) ? responseInterceptors : [responseInterceptors];
  }

  /**
   * Get or create a cached grpc-web client instance.
   *
   * @param {Function} ClientClass — generated grpc-web client constructor
   * @returns client instance
   */
  client(ClientClass) {
    if (!this.#clients.has(ClientClass)) {
      this.#clients.set(ClientClass, new ClientClass(this.#host));
    }
    return this.#clients.get(ClientClass);
  }

  /**
   * Unary RPC call — returns a RequestControl.
   *
   * @param {Function} ClientClass — generated grpc-web client
   * @param {string} method — method name on the client
   * @param {*} request — protobuf request message
   * @param {Record<string, string>} [metadata] — per-call metadata
   */
  unary(ClientClass, method, request, metadata = {}) {
    return new RequestControl(this.#executeUnary(ClientClass, method, request, metadata));
  }

  /**
   * Server-streaming RPC — returns a StreamControl.
   *
   * @param {Function} ClientClass — generated grpc-web client
   * @param {string} method — method name on the client
   * @param {*} request — protobuf request message
   * @param {Record<string, string>} [metadata] — per-call metadata
   */
  serverStream(ClientClass, method, request, metadata = {}) {
    return new StreamControl(this.#prepareStream(ClientClass, method, request, metadata));
  }

  /** Update default metadata (e.g. after token refresh). */
  setMetadata(key, value) {
    this.#metadata[key] = value;
  }

  /** Remove a metadata key. */
  removeMetadata(key) {
    delete this.#metadata[key];
  }

  /** Discard cached client instances (e.g. after host change). */
  clearClients() {
    this.#clients.clear();
  }

  // ── Internal ───────────────────────────────────────────────

  async #buildMetadata(extra) {
    let meta = { ...this.#metadata, ...extra };

    for (const interceptor of this.#interceptors) {
      const result = await interceptor(meta);
      if (!result) {
        throw new GrpcError(GrpcStatus.CANCELLED, 'Request cancelled by interceptor');
      }
      meta = result;
    }

    return meta;
  }

  async #runResponseInterceptors(data, error) {
    let currentData = data;
    let currentError = error;

    for (const interceptor of this.#responseInterceptors) {
      const result = await interceptor({ data: currentData, error: currentError });
      currentData = result?.data !== undefined ? result.data : currentData;
      currentError = result?.error !== undefined ? result.error : currentError;
    }

    if (currentError) throw currentError;
    return currentData;
  }

  async #executeUnary(ClientClass, method, request, metadata) {
    const meta = await this.#buildMetadata(metadata);
    const client = this.client(ClientClass);

    let data = null;
    let error = null;

    try {
      data = await new Promise((resolve, reject) => {
        client[method](request, meta, (err, response) => {
          if (err) {
            reject(new GrpcError(err.code, err.message, err.metadata));
          } else {
            resolve(response);
          }
        });
      });
    } catch (e) {
      error = e;
    }

    return this.#runResponseInterceptors(data, error);
  }

  async #prepareStream(ClientClass, method, request, metadata) {
    const meta = await this.#buildMetadata(metadata);
    const client = this.client(ClientClass);
    return client[method](request, meta);
  }
}

// ── OkalitGraphqlService ───────────────────────────────────────

export class OkalitGraphqlService extends BaseService {
  #endpoint = '';

  /**
   * @param {Object} opts
   * @param {string}  [opts.endpoint] — GraphQL endpoint URL
   * @param {Record<string, string>} [opts.headers]
   * @param {boolean} [opts.cache]    — cache query results (default: false)
   * @param {number}  [opts.cacheTTL] — cache lifetime in ms
   * @param {Object[]} [opts.interceptors] — request interceptors
   * @param {Object[]} [opts.responseInterceptors] — response interceptors
   */
  configure({ endpoint, ...rest } = {}) {
    if (endpoint !== undefined) this.#endpoint = endpoint.replace(/\/+$/, '');
    this._configureMixin(rest);
  }

  query(queryString, variables = {}) {
    return new RequestControl(this.#execute(queryString, variables));
  }

  mutate(mutationString, variables = {}) {
    return new RequestControl(this.#execute(mutationString, variables));
  }

  async #execute(queryString, variables) {
    const intercepted = await this._runInterceptors(this.#endpoint, {
      method: 'POST',
      body: JSON.stringify({ query: queryString, variables }),
    });

    const fullCacheKey = intercepted.url + queryString + JSON.stringify(variables);
    const cached = this._getCached(fullCacheKey);
    let promise;

    if (cached) {
      promise = cached.status === 'pending' ? cached.promise : Promise.resolve(cached.data);
    } else {
      promise = fetch(intercepted.url, intercepted.options).then(async (res) => {
        if (!res.ok) {
          let errorBody;
          try { errorBody = await res.json(); } catch { errorBody = { message: res.statusText }; }
          throw new HttpError(res.status, res.statusText, errorBody);
        }

        const json = await res.json();
        if (json.errors) {
          throw new GraphqlError(json.errors, json.data ?? null);
        }
        return json.data;
      });

      this._setCache(fullCacheKey, promise);
    }

    let data = null;
    let error = null;
    try { data = await promise; } catch (e) { error = e; }

    return this._runResponseInterceptors(data, error);
  }
}
