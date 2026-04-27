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

// ── OkalitService base class ───────────────────────────────────

export class OkalitService {
  #baseUrl = '';
  #headers = { 'Content-Type': 'application/json' };
  #cache = new Map();
  #cacheEnabled = false;
  #cacheTTL = 0; // 0 = no expiry
  #interceptors = [];
  #responseInterceptors = [];

  /**
   * Configure the service instance.
   *
   * @param {Object} opts
   * @param {string}  [opts.baseUrl]
   * @param {Record<string, string>} [opts.headers]
   * @param {boolean} [opts.cache]    — enable/disable in-memory cache (default: false)
   * @param {number}  [opts.cacheTTL] — cache lifetime in ms (0 = forever until clearCache)
   * @param {Object[]} [opts.interceptors] — route interceptors (see Router docs)
   * @param {Object[]} [opts.responseInterceptors] — response interceptors (see Router docs)
   */
  configure({ baseUrl, headers, cache, cacheTTL, interceptors, responseInterceptors } = {}) {
    if (baseUrl !== undefined) this.#baseUrl = baseUrl.replace(/\/+$/, '');
    if (headers !== undefined) this.#headers = { ...this.#headers, ...headers };
    if (cache !== undefined) this.#cacheEnabled = cache;
    if (cacheTTL !== undefined) this.#cacheTTL = cacheTTL;
    if (interceptors !== undefined) this.#interceptors = Array.isArray(interceptors) ? interceptors : [interceptors];
    if (responseInterceptors !== undefined) this.#responseInterceptors = Array.isArray(responseInterceptors) ? responseInterceptors : [responseInterceptors];
  }

  // ── HTTP helpers ───────────────────────────────────────────

  /**
   * GET request (cacheable).
   * @param {string} path
   * @param {Record<string, string>} [params] — query-string params
   * @returns {RequestControl}
   */
  get(path, params) {
    let url = `${this.#baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return new RequestControl(this.#request(url, { method: 'GET' }, true));
  }

  /**
   * POST request.
   * @param {string} path
   * @param {any} body
   * @returns {RequestControl}
   */
  post(path, body) {
    return new RequestControl(this.#request(`${this.#baseUrl}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }));
  }

  /**
   * PUT request.
   * @param {string} path
   * @param {any} body
   * @returns {RequestControl}
   */
  put(path, body) {
    return new RequestControl(this.#request(`${this.#baseUrl}${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }));
  }

  /**
   * DELETE request.
   * @param {string} path
   * @returns {RequestControl}
   */
  delete(path) {
    return new RequestControl(this.#request(`${this.#baseUrl}${path}`, {
      method: 'DELETE',
    }));
  }

  /** Clear the in-memory cache (all entries or a specific path). */
  clearCache(path) {
    if (!path) {
      this.#cache.clear();
      return;
    }

    const prefix = `${this.#baseUrl}${path}`;
    for (const key of this.#cache.keys()) {
      if (key.startsWith(prefix)) {
        this.#cache.delete(key);
      }
    }
  }

  // ── Internal ───────────────────────────────────────────────

  async #request(url, options, cacheable = false) {
    let currentUrl = url;
    let currentOptions = { ...options, headers: { ...this.#headers, ...options.headers } };

    for (const interceptor of this.#interceptors) {
      const result = await interceptor({ url: currentUrl, options: currentOptions });
      
      if (!result) {
        throw { status: 0, statusText: 'Cancelled', body: { message: 'Request rejected' } };
      }

      currentUrl = result.url || currentUrl;
      currentOptions = result.options || currentOptions;
    }

    let promise;
    const cached = cacheable && this.#cacheEnabled ? this.#cache.get(currentUrl) : null;

    if (cached && (this.#cacheTTL === 0 || Date.now() - cached.time < this.#cacheTTL)) {
      promise = cached.status === 'pending' ? cached.promise : Promise.resolve(cached.data);
    } else {
      promise = fetch(currentUrl, currentOptions).then(async (res) => {
        if (!res.ok) {
          let body;
          try { body = await res.json(); } catch { body = { message: res.statusText }; }
          throw { status: res.status, statusText: res.statusText, body };
        }
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      });

      if (cacheable && this.#cacheEnabled) {
        this.#cache.set(currentUrl, { status: 'pending', promise, time: Date.now() });
        promise.then(data => this.#cache.set(currentUrl, { status: 'resolved', data, time: Date.now() }))
               .catch(() => this.#cache.delete(currentUrl));
      }
    }

    let data = null;
    let error = null;

    try {
      data = await promise;
    } catch (e) {
      error = e;
    }

    for (const interceptor of this.#responseInterceptors) {
      const result = await interceptor({ data, error });
      data = result?.data !== undefined ? result.data : data;
      error = result?.error !== undefined ? result.error : error;
    }

    if (error) throw error;
    return structuredClone(data);
  }
}

// ── OkalitGraphqlService ───────────────────────────────────────

export class OkalitGraphqlService {
  #endpoint = '';
  #headers = { 'Content-Type': 'application/json' };
  #cache = new Map();
  #cacheEnabled = false;
  #cacheTTL = 0;
  #interceptors = [];
  #responseInterceptors = [];
  /**
   * @param {Object} opts
   * @param {string}  [opts.endpoint] — GraphQL endpoint URL
   * @param {Record<string, string>} [opts.headers]
   * @param {boolean} [opts.cache]    — cache query results (default: false)
   * @param {number}  [opts.cacheTTL] — cache lifetime in ms
   * @param {Object[]} [opts.interceptors] — route interceptors (see Router docs)
   * @param {Object[]} [opts.responseInterceptors] — response interceptors
   */
  configure({ endpoint, headers, cache, cacheTTL, interceptors, responseInterceptors } = {}) {
    if (endpoint !== undefined) this.#endpoint = endpoint.replace(/\/+$/, '');
    if (headers !== undefined) this.#headers = { ...this.#headers, ...headers };
    if (cache !== undefined) this.#cacheEnabled = cache;
    if (cacheTTL !== undefined) this.#cacheTTL = cacheTTL;
    if (interceptors !== undefined) this.#interceptors = Array.isArray(interceptors) ? interceptors : [interceptors];
    if (responseInterceptors !== undefined) this.#responseInterceptors = Array.isArray(responseInterceptors) ? responseInterceptors : [responseInterceptors];
  }

  /**
   * Execute a GraphQL query.
   * @param {string} queryString
   * @param {Record<string, any>} [variables]
   * @returns {RequestControl}
   */
  query(queryString, variables = {}) {
    return new RequestControl(this.#execute(queryString, variables));
  }

  /**
   * Alias for query — semantically marks a mutation.
   * @param {string} mutationString
   * @param {Record<string, any>} [variables]
   * @returns {RequestControl}
   */
  mutate(mutationString, variables = {}) {
    return new RequestControl(this.#execute(mutationString, variables));
  }

  /** Clear cached queries. Pass a query string to clear a specific one. */
  clearCache(queryString) {
    if (!queryString) {
      this.#cache.clear();
      return;
    }

    for (const key of this.#cache.keys()) {
      if (key.includes(queryString)) {
        this.#cache.delete(key);
      }
    }
  }

  async #execute(queryString, variables) {
    let currentUrl = this.#endpoint;
    let currentOptions = {
      method: 'POST',
      headers: { ...this.#headers },
      body: JSON.stringify({ query: queryString, variables }),
    };

    for (const interceptor of this.#interceptors) {
      const result = await interceptor({ url: currentUrl, options: currentOptions });
      
      if (!result) {
        throw { status: 0, statusText: 'Cancelled', body: { message: 'Request rejected' } };
      }

      currentUrl = result.url || currentUrl;
      currentOptions = result.options || currentOptions;
    }

    const cacheKey = queryString + JSON.stringify(variables);
    const fullCacheKey = currentUrl + cacheKey; 
    let promise;

    const cached = this.#cacheEnabled ? this.#cache.get(fullCacheKey) : null;

    if (cached && (this.#cacheTTL === 0 || Date.now() - cached.time < this.#cacheTTL)) {
      promise = cached.status === 'pending' ? cached.promise : Promise.resolve(cached.data);
    } else {
      promise = fetch(currentUrl, currentOptions).then(async (res) => {
        if (!res.ok) {
          let errorBody;
          try { errorBody = await res.json(); } catch { errorBody = { message: res.statusText }; }
          throw { status: res.status, statusText: res.statusText, body: errorBody };
        }

        const json = await res.json();
        if (json.errors) {
          throw { graphql: true, errors: json.errors, data: json.data ?? null };
        }
        return json.data;
      });

      if (this.#cacheEnabled) {
        this.#cache.set(fullCacheKey, { status: 'pending', promise, time: Date.now() });

        promise
          .then((data) => {
            this.#cache.set(fullCacheKey, { status: 'resolved', data, time: Date.now() });
          })
          .catch(() => {
            this.#cache.delete(fullCacheKey);
          });
      }
    }

    let data = null;
    let error = null;

    try {
      data = await promise;
    } catch (e) {
      error = e;
    }

    for (const interceptor of this.#responseInterceptors) {
      const result = await interceptor({ data, error });
      data = result?.data !== undefined ? result.data : data;
      error = result?.error !== undefined ? result.error : error;
    }

    if (error) throw error;
    return structuredClone(data);
  }
}
