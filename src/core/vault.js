import path from "node:path";
import { pathToFileURL } from "node:url";

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizePath(pathInput) {
  if (Array.isArray(pathInput)) {
    return pathInput.filter((segment) => segment !== "");
  }

  if (typeof pathInput === "string") {
    return pathInput.split(".").filter((segment) => segment !== "");
  }

  if (pathInput == null) {
    return [];
  }

  throw new TypeError("Vault path must be a string, array, or nullish value");
}

function getAtPath(store, pathSegments) {
  let current = store;

  for (const segment of pathSegments) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function setAtPath(store, pathSegments, value) {
  if (pathSegments.length === 0) {
    if (value == null || typeof value !== "object") {
      throw new TypeError("Vault root must be replaced with an object value");
    }

    for (const key of Object.keys(store)) {
      delete store[key];
    }

    Object.assign(store, cloneValue(value));
    return store;
  }

  let current = store;

  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index];

    if (current[segment] == null || typeof current[segment] !== "object") {
      current[segment] = {};
    }

    current = current[segment];
  }

  current[pathSegments[pathSegments.length - 1]] = cloneValue(value);
  return store;
}

function deleteAtPath(store, pathSegments) {
  if (pathSegments.length === 0) {
    return false;
  }

  let current = store;

  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index];

    if (current == null || typeof current !== "object" || !(segment in current)) {
      return false;
    }

    current = current[segment];
  }

  const lastSegment = pathSegments[pathSegments.length - 1];

  if (current == null || typeof current !== "object" || !(lastSegment in current)) {
    return false;
  }

  delete current[lastSegment];
  return true;
}

function createVaultInterface(store) {
  return {
    get(path, defaultValue) {
      const pathSegments = normalizePath(path);
      const value = getAtPath(store, pathSegments);
      return value === undefined ? defaultValue : value;
    },
    set(path, value) {
      const pathSegments = normalizePath(path);
      return setAtPath(store, pathSegments, value);
    },
    has(path) {
      const pathSegments = normalizePath(path);
      return getAtPath(store, pathSegments) !== undefined;
    },
    delete(path) {
      const pathSegments = normalizePath(path);
      return deleteAtPath(store, pathSegments);
    },
    snapshot() {
      return cloneValue(store);
    },
    list(path) {
      const value = this.get(path);
      if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }

      return Object.keys(value);
    },
    getProvider(providerName) {
      return this.get(["providers", providerName]);
    },
    setProvider(providerName, providerConfig) {
      return this.set(["providers", providerName], providerConfig);
    },
  };
}

export function createLocalVault(initialState = {}) {
  const store = cloneValue(initialState);
  return createVaultInterface(store);
}

async function tryCreateExternalVault({ initialState, moduleSpecifier, options, logger }) {
  if (!moduleSpecifier) {
    return null;
  }

  try {
    const resolvedModuleSpecifier =
      moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/")
        ? pathToFileURL(path.resolve(process.cwd(), moduleSpecifier)).href
        : moduleSpecifier;
    const module = await import(resolvedModuleSpecifier);
    const factory = module.createVault ?? module.default ?? module.vault;

    if (typeof factory === "function") {
      const vault = await factory({ initialState, options, logger });
      if (vault) {
        return vault;
      }
    }

    if (factory && typeof factory === "object") {
      return factory;
    }
  } catch (error) {
    logger?.debug?.({ error, moduleSpecifier }, "external vault unavailable, using local vault");
  }

  return null;
}

export async function createVaultService({ initialState = {}, moduleSpecifier, options = {}, logger } = {}) {
  const externalVault = await tryCreateExternalVault({
    initialState,
    moduleSpecifier,
    options,
    logger,
  });

  if (externalVault) {
    return externalVault;
  }

  return createLocalVault(initialState);
}