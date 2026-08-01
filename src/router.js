import { signal } from 'uhtml';
import { clearChannelsByScope } from './channel.js';

/** @type {Router|null} — Singleton reference to the active router instance. */
let instance = null;

/**
 * Client-side SPA router with reactive signals, route guards,
 * nested route matching, and automatic channel scope cleanup.
 *
 * Implements a singleton pattern — only one Router can exist at a time.
 * Initialized by the AppMixin on application startup.
 *
 * @example
 * const router = new Router([
 *   { path: 'home', component: 'home-page' },
 *   { path: 'users/:id', component: 'user-page', guards: [authGuard] },
 * ]);
 */
export class Router {
  /**
   * Creates the router singleton with the given route definitions.
   * If an instance already exists, returns it (singleton).
   *
   * @param {Array<RouteConfig>} routes — Flat or nested route definitions.
   */
  constructor(routes = []) {
    if (instance) return instance;
    instance = this;

    this._routes = routes;
    this._outlets = new Set();

    // Reactive signals for current route state
    this.currentPath = signal(window.location.pathname);
    this.currentRoute = signal(null);
    this.params = signal({});
    this.query = signal({});

    this._onPopState = this._onPopState.bind(this);
    window.addEventListener('popstate', this._onPopState);

    // Store pending resolve — outlets will trigger it when they register
    this._pendingPath = window.location.pathname + window.location.search;
  }

  /**
   * Returns the current router singleton instance.
   *
   * @returns {Router|null} The active router or null if not initialized.
   */
  static getInstance() {
    return instance;
  }

  /**
   * Programmatically navigate to a new path.
   * Pushes (or replaces) a history entry and resolves the route.
   *
   * @param {string} path — The target path (e.g. '/users/42?tab=posts').
   * @param {Object} [options] — Navigation options.
   * @param {boolean} [options.replace=false] — If true, replaces the current history entry.
   */
  navigate(path, { replace = false } = {}) {
    const [pathname] = path.split('?');
    if (pathname === this.currentPath.value && path === window.location.pathname + window.location.search) return;

    const match = this._matchRoute(this._routes, pathname || '/');
    if (!match) {
      console.warn(`[okalit-router] No route matched: ${pathname}`);
      return;
    }

    if (replace) {
      window.history.replaceState(null, '', path);
    } else {
      window.history.pushState(null, '', path);
    }
    this._resolve(path);
  }

  /**
   * Navigates back one entry in the browser history stack.
   */
  back() {
    window.history.back();
  }

  /**
   * Registers a router outlet (renders matched route components).
   * If there's a pending path resolution, triggers it immediately.
   *
   * @param {OkalitRouter} outlet — The router outlet element to register.
   */
  registerOutlet(outlet) {
    this._outlets.add(outlet);
    // If there's a pending resolve or an existing route, trigger it
    if (this._pendingPath) {
      const path = this._pendingPath;
      this._pendingPath = null;
      this._resolve(path);
    } else if (this.currentRoute.value) {
      outlet._renderRoute(this.currentRoute.value);
    }
  }

  /**
   * Unregisters a router outlet (e.g. when a module is destroyed).
   *
   * @param {OkalitRouter} outlet — The router outlet element to remove.
   */
  unregisterOutlet(outlet) {
    this._outlets.delete(outlet);
  }

  /**
   * Destroys the router singleton, removing event listeners and
   * clearing the global instance reference.
   */
  destroy() {
    window.removeEventListener('popstate', this._onPopState);
    instance = null;
  }

  // --- Internal ---

  /**
   * Handles browser back/forward button navigation events.
   *
   * @private
   */
  _onPopState() {
    this._resolve(window.location.pathname + window.location.search);
  }

  /**
   * Core route resolution logic. Matches the path against the route tree,
   * runs guards, updates reactive state, clears scoped channels on route
   * change, and notifies all registered outlets.
   *
   * @private
   * @param {string} fullPath — Full path including query string.
   */
  async _resolve(fullPath) {
    const [pathname, search] = fullPath.split('?');
    const path = pathname || '/';
    const query = Object.fromEntries(new URLSearchParams(search || ''));

    const match = this._matchRoute(this._routes, path);
    if (!match) {
      console.warn(`[okalit-router] No route matched: ${path}`);
      return;
    }

    // Run guards BEFORE loading anything
    const guardsPassed = await this._runGuards(match.guards, path, match);
    if (!guardsPassed) return;

    // Update reactive state
    this.currentPath.value = path;
    this.params.value = match.params;
    this.query.value = query;

    // Determine what changed and clear scoped channels
    const prevRoute = this.currentRoute.value;
    if (prevRoute) {
      const prevPage = prevRoute.chain[prevRoute.chain.length - 1]?.component;
      const newPage = match.chain[match.chain.length - 1]?.component;
      const prevModule = prevRoute.chain[0]?.component;
      const newModule = match.chain[0]?.component;

      if (prevPage !== newPage) clearChannelsByScope('page');
      if (prevModule !== newModule) clearChannelsByScope('module');
    }

    this.currentRoute.value = match;

    // Notify all outlets
    for (const outlet of this._outlets) {
      outlet._renderRoute(match);
    }
  }

  /**
   * Executes route guards sequentially before navigation completes.
   * Guards can return `false` to cancel navigation, or a string path to redirect.
   *
   * @private
   * @param {Function[]} guards — Array of guard functions to execute.
   * @param {string} path — The target path being navigated to.
   * @param {Object} match — The matched route object.
   * @returns {Promise<boolean>} True if all guards pass, false otherwise.
   */
  async _runGuards(guards, path, match) {
    if (!guards || !guards.length) return true;

    for (const guard of guards) {
      const result = await guard({ path, params: match.params, route: match });
      if (result === false) return false;
      if (typeof result === 'string') {
        // Guard returned a redirect path
        this.navigate(result, { replace: true });
        return false;
      }
    }
    return true;
  }

  /**
   * Match a path against the route tree.
   * Returns a flat match object with the chain of matched routes.
   */
  _matchRoute(routes, path, basePath = '', parentGuards = []) {
    for (const route of routes) {
      const fullPattern = normalizePath(basePath + '/' + route.path);

      // For routes with children, use prefix matching
      // For leaf routes, use exact matching
      const hasChildren = route.children && route.children.length;
      const match = hasChildren
        ? matchPrefix(fullPattern, path)
        : matchPath(fullPattern, path);

      if (match) {
        const guards = [...parentGuards, ...(route.guards || [])];
        const result = {
          route,
          params: match.params,
          guards,
          chain: [route],
        };

        // If route has children, try to match deeper
        if (route.children && route.children.length) {
          const childMatch = this._matchRoute(route.children, path, fullPattern, guards);
          if (childMatch) {
            childMatch.chain = [route, ...childMatch.chain];
            return childMatch;
          }
        }

        // Exact match or this route is a leaf
        if (match.exact || !route.children) {
          return result;
        }
      }
    }
    return null;
  }
}

// --- Path utilities ---

/**
 * Normalizes a URL path by removing duplicate slashes and ensuring
 * a leading slash.
 *
 * @param {string} path — Raw path string.
 * @returns {string} Normalized path (e.g. '/users/42').
 */
function normalizePath(path) {
  return '/' + path.split('/').filter(Boolean).join('/');
}

/**
 * Match a pattern like /users/:id against a path like /users/42
 * Returns { params, exact } or null
 */
function matchPath(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  // Exact match requires same length
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeParam(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return { params, exact: true };
}

/**
 * Prefix match: pattern must match the beginning of the path
 */
function matchPrefix(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (pathParts.length < patternParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeParam(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return { params, exact: patternParts.length === pathParts.length };
}

/**
 * Safely decode a URL segment. Returns the original value
 * if decoding fails (malformed percent-encoding).
 *
 * @param {string} value — URL-encoded path segment.
 * @returns {string} Decoded string or original value on failure.
 */
function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Navigation helper for use outside components.
 * Delegates to the singleton router instance.
 *
 * @param {string} path — The target path to navigate to.
 * @param {Object} [options] — Navigation options (e.g. { replace: true }).
 */
export function navigate(path, options) {
  Router.getInstance()?.navigate(path, options);
}
