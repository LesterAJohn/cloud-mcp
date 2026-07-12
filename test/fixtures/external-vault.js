export function createVault({ initialState, options }) {
  const store = {
    ...initialState,
    _meta: {
      options: { ...options },
    },
  };

  return {
    get(path, defaultValue) {
      const pathSegments = Array.isArray(path) ? path : String(path).split(".");
      let current = store;

      for (const segment of pathSegments) {
        if (current == null || typeof current !== "object") {
          return defaultValue;
        }

        current = current[segment];
      }

      return current === undefined ? defaultValue : current;
    },
    set(path, value) {
      const pathSegments = Array.isArray(path) ? path : String(path).split(".");
      let current = store;

      for (let index = 0; index < pathSegments.length - 1; index += 1) {
        const segment = pathSegments[index];
        if (current[segment] == null || typeof current[segment] !== "object") {
          current[segment] = {};
        }

        current = current[segment];
      }

      current[pathSegments[pathSegments.length - 1]] = value;
      return store;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(store));
    },
  };
}
