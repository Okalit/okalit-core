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

  /**
   * Configure the service instance.
   *
   * @param {Object} opts
   * @param {string}  [opts.baseUrl]
   * @param {Record<string, string>} [opts.headers]
   * @param {boolean} [opts.cache]    — enable/disable in-memory cache (default: false)
   * @param {number}  [opts.cacheTTL] — cache lifetime in ms (0 = forever until clearCache)
   */
  configure({ baseUrl, headers, cache, cacheTTL } = {}) {
    if (baseUrl !== undefined) this.#baseUrl = baseUrl.replace(/\/+$/, '');
    if (headers !== undefined) this.#headers = { ...this.#headers, ...headers };
    if (cache !== undefined) this.#cacheEnabled = cache;
    if (cacheTTL !== undefined) this.#cacheTTL = cacheTTL;
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
    return this.#request(url, { method: 'GET' }, true);
  }

  /**
   * POST request.
   * @param {string} path
   * @param {any} body
   * @returns {RequestControl}
   */
  post(path, body) {
    return this.#request(`${this.#baseUrl}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * PUT request.
   * @param {string} path
   * @param {any} body
   * @returns {RequestControl}
   */
  put(path, body) {
    return this.#request(`${this.#baseUrl}${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  /**
   * DELETE request.
   * @param {string} path
   * @returns {RequestControl}
   */
  delete(path) {
    return this.#request(`${this.#baseUrl}${path}`, {
      method: 'DELETE',
    });
  }

  /** Clear the in-memory cache (all entries or a specific path). */
  clearCache(path) {
    if (path) {
      const url = `${this.#baseUrl}${path}`;
      this.#cache.delete(url);
    } else {
      this.#cache.clear();
    }
  }

  // ── Internal ───────────────────────────────────────────────

  #request(url, options, cacheable = false) {
    // Check cache for GET requests
    if (cacheable && this.#cacheEnabled) {
      const cached = this.#cache.get(url);
      if (cached) {
        const expired = this.#cacheTTL > 0 && (Date.now() - cached.time > this.#cacheTTL);
        if (!expired) {
          return new RequestControl(Promise.resolve(structuredClone(cached.data)));
        }
        this.#cache.delete(url);
      }
    }

    const promise = fetch(url, {
      ...options,
      headers: { ...this.#headers },
    }).then(async (res) => {
      if (!res.ok) {
        let errorBody;
        try {
          errorBody = await res.json();
        } catch {
          errorBody = { message: res.statusText };
        }
        throw { status: res.status, statusText: res.statusText, body: errorBody };
      }

      // Handle 204 No Content
      const text = await res.text();
      if (!text) return null;

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      // Store in cache
      if (cacheable && this.#cacheEnabled) {
        this.#cache.set(url, { data, time: Date.now() });
      }

      return data;
    });

    return new RequestControl(promise);
  }
}

// ── OkalitGraphqlService ───────────────────────────────────────

export class OkalitGraphqlService {
  #endpoint = '';
  #headers = { 'Content-Type': 'application/json' };
  #cache = new Map();
  #cacheEnabled = false;
  #cacheTTL = 0;

  /**
   * @param {Object} opts
   * @param {string}  [opts.endpoint] — GraphQL endpoint URL
   * @param {Record<string, string>} [opts.headers]
   * @param {boolean} [opts.cache]    — cache query results (default: false)
   * @param {number}  [opts.cacheTTL] — cache lifetime in ms
   */
  configure({ endpoint, headers, cache, cacheTTL } = {}) {
    if (endpoint !== undefined) this.#endpoint = endpoint.replace(/\/+$/, '');
    if (headers !== undefined) this.#headers = { ...this.#headers, ...headers };
    if (cache !== undefined) this.#cacheEnabled = cache;
    if (cacheTTL !== undefined) this.#cacheTTL = cacheTTL;
  }

  /**
   * Execute a GraphQL query.
   * @param {string} queryString
   * @param {Record<string, any>} [variables]
   * @returns {RequestControl}
   */
  query(queryString, variables = {}) {
    return this.#execute(queryString, variables);
  }

  /**
   * Alias for query — semantically marks a mutation.
   * @param {string} mutationString
   * @param {Record<string, any>} [variables]
   * @returns {RequestControl}
   */
  mutate(mutationString, variables = {}) {
    return this.#execute(mutationString, variables);
  }

  /** Clear cached queries. Pass a query string to clear a specific one. */
  clearCache(queryString) {
    if (queryString) {
      this.#cache.delete(queryString);
    } else {
      this.#cache.clear();
    }
  }

  #execute(queryString, variables) {
    // Cache check (keyed by query + variables)
    const cacheKey = queryString + JSON.stringify(variables);
    if (this.#cacheEnabled) {
      const cached = this.#cache.get(cacheKey);
      if (cached) {
        const expired = this.#cacheTTL > 0 && (Date.now() - cached.time > this.#cacheTTL);
        if (!expired) {
          return new RequestControl(Promise.resolve(structuredClone(cached.data)));
        }
        this.#cache.delete(cacheKey);
      }
    }

    const promise = fetch(this.#endpoint, {
      method: 'POST',
      headers: { ...this.#headers },
      body: JSON.stringify({ query: queryString, variables }),
    }).then(async (res) => {
      // Handle HTTP-level errors (network, 500, etc.)
      if (!res.ok) {
        let errorBody;
        try {
          errorBody = await res.json();
        } catch {
          errorBody = { message: res.statusText };
        }
        throw { status: res.status, statusText: res.statusText, body: errorBody };
      }

      const json = await res.json();

      // GraphQL can return 200 OK with errors in body
      if (json.errors) {
        throw { graphql: true, errors: json.errors, data: json.data ?? null };
      }

      const data = json.data;

      if (this.#cacheEnabled) {
        this.#cache.set(cacheKey, { data, time: Date.now() });
      }

      return data;
    });

    return new RequestControl(promise);
  }
}
