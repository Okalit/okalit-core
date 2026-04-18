import { signal } from 'uhtml';
import { clearChannelsByScope } from './channel.js';

/** @type {Router|null} */
let instance = null;

export class Router {
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

  static getInstance() {
    return instance;
  }

  // --- Public API ---

  navigate(path, { replace = false } = {}) {
    if (path === this.currentPath.value) return;
    if (replace) {
      window.history.replaceState(null, '', path);
    } else {
      window.history.pushState(null, '', path);
    }
    this._resolve(path);
  }

  back() {
    window.history.back();
  }



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

  unregisterOutlet(outlet) {
    this._outlets.delete(outlet);
  }

  destroy() {
    window.removeEventListener('popstate', this._onPopState);
    instance = null;
  }

  // --- Internal ---

  _onPopState() {
    this._resolve(window.location.pathname + window.location.search);
  }

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

    // Run route-level interceptors
    const interceptorsPassed = await this._runInterceptors(match.interceptors, path, match);
    if (!interceptorsPassed) return;

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

  async _runInterceptors(interceptors, path, match) {
    if (!interceptors || !interceptors.length) return true;

    for (const interceptor of interceptors) {
      const result = await interceptor({ path, params: match.params, route: match });
      if (result === false) return false;
      if (typeof result === 'string') {
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
  _matchRoute(routes, path, basePath = '', parentGuards = [], parentInterceptors = []) {
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
        const interceptors = [...parentInterceptors, ...(route.interceptors || [])];
        const result = {
          route,
          params: match.params,
          guards,
          interceptors,
          chain: [route],
        };

        // If route has children, try to match deeper
        if (route.children && route.children.length) {
          const childMatch = this._matchRoute(route.children, path, fullPattern, guards, interceptors);
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
      params[patternParts[i].slice(1)] = pathParts[i];
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
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return { params, exact: patternParts.length === pathParts.length };
}

// Navigation helper for use outside components
export function navigate(path, options) {
  Router.getInstance()?.navigate(path, options);
}
