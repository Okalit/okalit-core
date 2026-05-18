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
      if (!_registry.has(name)) {
        _registry.set(name, new cls());
      }
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

// ── Shared fetch infrastructure ────────────────────────────────

class BaseService {
  _headers = { 'Content-Type': 'application/json' };
  _cache = new Map();
  _cacheEnabled = false;
  _cacheTTL = 0;
  _interceptors = [];
  _responseInterceptors = [];

  _configureMixin({ headers, cache, cacheTTL, interceptors, responseInterceptors } = {}) {
    if (headers !== undefined) this._headers = { ...this._headers, ...headers };
    if (cache !== undefined) this._cacheEnabled = cache;
    if (cacheTTL !== undefined) this._cacheTTL = cacheTTL;
    if (interceptors !== undefined) this._interceptors = Array.isArray(interceptors) ? interceptors : [interceptors];
    if (responseInterceptors !== undefined) this._responseInterceptors = Array.isArray(responseInterceptors) ? responseInterceptors : [responseInterceptors];
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
   * @param {Object[]} [opts.interceptors] — request interceptors
   * @param {Object[]} [opts.responseInterceptors] — response interceptors
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
    const intercepted = await this._runInterceptors(url, options);

    const cached = this._getCached(intercepted.url, cacheable);
    let promise;

    if (cached) {
      promise = cached.status === 'pending' ? cached.promise : Promise.resolve(cached.data);
    } else {
      promise = fetch(intercepted.url, intercepted.options).then(async (res) => {
        if (!res.ok) {
          let body;
          try { body = await res.json(); } catch { body = { message: res.statusText }; }
          throw new HttpError(res.status, res.statusText, body);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      });

      if (cacheable) this._setCache(intercepted.url, promise);
    }

    let data = null;
    let error = null;
    try { data = await promise; } catch (e) { error = e; }

    return this._runResponseInterceptors(data, error);
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
