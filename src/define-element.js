export function defineElement({ tag, styles = [], props = [], params = [] }) {
  return function (cls, context) {
    // Inject styles, props and params as static properties on the class
    cls.styles = styles;
    cls.props = props;
    cls.params = params;

    // Build a map of prop name → type config for attribute coercion
    const propMap = {};
    for (const propDef of props) {
      const [name, config] = Object.entries(propDef)[0];
      propMap[name] = config;
    }
    cls._propMap = propMap;

    // Tell the browser which attributes to observe (kebab-case)
    cls.observedAttributes = Object.keys(propMap).map(toKebabCase);

    // Register the custom element after the class is fully defined
    context.addInitializer(function () {
      if (!customElements.get(tag)) {
        customElements.define(tag, cls);
      }
    });
  };
}

function toKebabCase(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}
