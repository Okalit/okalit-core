/**
 * Class decorator that registers a Web Component with the browser's custom element registry.
 * Injects static styles, reactive props, and sets up observed attributes automatically.
 *
 * @param {Object} config — Decorator configuration.
 * @param {string} config.tag — The custom element tag name (e.g. 'my-component').
 * @param {string[]} [config.styles=[]] — Array of CSS strings to apply to the component.
 * @param {Array<Record<string, { value: any, type?: Function }>>} [config.props=[]] — Reactive prop definitions.
 * @returns {Function} A class decorator function compatible with TC39 Stage 3 decorators.
 *
 * @example
 * @defineElement({ tag: 'user-card', styles: [css], props: [{ name: { value: '', type: String } }] })
 * class UserCard extends Okalit { ... }
 */
export function defineElement({ tag, styles = [], props = [] }) {
  return function (cls, context) {
    // Inject styles, props and params as static properties on the class
    cls.styles = styles;
    cls.props = props;

    // Build a map of prop name → type config for attribute coercion
    const propMap = {};
    for (const propDef of props) {
      const [name, config] = Object.entries(propDef)[0];
      propMap[name] = config;
    }
    cls._propMap = propMap;

    Object.defineProperty(cls, 'observedAttributes', {
      get() {
        return Object.keys(propMap).map(toKebabCase);
      },
      configurable: true,
      enumerable: true
    });

    // Register the custom element after the class is fully defined
    context.addInitializer(function () {
      if (!customElements.get(tag)) {
        customElements.define(tag, cls);
      }
    });
  };
}

/**
 * Converts a camelCase string to kebab-case for HTML attribute mapping.
 *
 * @param {string} str — camelCase input (e.g. 'myProp').
 * @returns {string} kebab-case output (e.g. 'my-prop').
 */
function toKebabCase(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}