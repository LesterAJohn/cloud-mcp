import { createLocalVault } from "./vault.js";

function parseKvVersion(value) {
  return String(value ?? "2") === "1" ? 1 : 2;
}

function normalizeBaseAddress(address) {
  return String(address ?? "").replace(/\/+$/, "");
}

function normalizePath(value) {
  return String(value ?? "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function buildReadPath({ kvMount, kvVersion, secretPath }) {
  if (kvVersion === 1) {
    return `${kvMount}/${secretPath}`;
  }

  return `${kvMount}/data/${secretPath}`;
}

function buildWritePath({ kvMount, kvVersion, secretPath }) {
  if (kvVersion === 1) {
    return `${kvMount}/${secretPath}`;
  }

  return `${kvMount}/data/${secretPath}`;
}

function buildDeletePath({ kvMount, kvVersion, secretPath }) {
  if (kvVersion === 1) {
    return `${kvMount}/${secretPath}`;
  }

  return `${kvMount}/data/${secretPath}`;
}

function getSecretData(payload, kvVersion) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const values = kvVersion === 1 ? payload?.data : payload?.data?.data;
  if (!values || typeof values !== "object") {
    return {};
  }

  return values;
}

function normalizeProviderName(providerName) {
  return String(providerName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
}

function buildProviderSecretPath(basePath, providerName) {
  return `${basePath}/${normalizeProviderName(providerName)}`;
}

function normalizePathSegments(pathInput) {
  if (Array.isArray(pathInput)) {
    return pathInput.filter((segment) => typeof segment === "string" && segment.length > 0);
  }

  if (typeof pathInput === "string") {
    return pathInput
      .split(".")
      .flatMap((segment) => segment.split("/"))
      .filter((segment) => segment.length > 0);
  }

  return [];
}

function setNestedValue(target, pathSegments, value) {
  if (!pathSegments.length) {
    return;
  }

  let current = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index];
    if (!current[segment] || typeof current[segment] !== "object") {
      current[segment] = {};
    }

    current = current[segment];
  }

  current[pathSegments[pathSegments.length - 1]] = value;
}

function pathMatches(pathInput, expectedSegments) {
  const actual = normalizePathSegments(pathInput);
  if (actual.length !== expectedSegments.length) {
    return false;
  }

  return actual.every((segment, index) => segment === expectedSegments[index]);
}

async function createVaultHttpClient(config) {
  const baseAddress = normalizeBaseAddress(config.address);
  const headersBase = {
    "Content-Type": "application/json",
    "X-Vault-Token": config.token,
  };

  if (config.namespace) {
    headersBase["X-Vault-Namespace"] = config.namespace;
  }

  async function request(method, path, body, allowNotFound = false) {
    const response = await fetch(`${baseAddress}/v1/${path}`, {
      method,
      headers: headersBase,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (allowNotFound && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Vault request failed (${response.status}): ${message || response.statusText}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async function readProvider(providerName) {
    const providerPath = buildProviderSecretPath(config.secretBasePath, providerName);
    const payload = await request(
      "GET",
      buildReadPath({
        kvMount: config.kvMount,
        kvVersion: config.kvVersion,
        secretPath: providerPath,
      }),
      undefined,
      true,
    );

    if (!payload) {
      return null;
    }

    const values = getSecretData(payload, config.kvVersion);
    if (values.provider && typeof values.provider === "object") {
      return values.provider;
    }

    return values;
  }

  async function writeProvider(providerName, providerConfig) {
    const providerPath = buildProviderSecretPath(config.secretBasePath, providerName);
    const values = { provider: providerConfig };
    if (config.kvVersion === 1) {
      await request(
        "POST",
        buildWritePath({
          kvMount: config.kvMount,
          kvVersion: config.kvVersion,
          secretPath: providerPath,
        }),
        values,
      );
      return;
    }

    await request(
      "POST",
      buildWritePath({
        kvMount: config.kvMount,
        kvVersion: config.kvVersion,
        secretPath: providerPath,
      }),
      { data: values },
    );
  }

  async function deleteProvider(providerName) {
    const providerPath = buildProviderSecretPath(config.secretBasePath, providerName);
    await request(
      "DELETE",
      buildDeletePath({
        kvMount: config.kvMount,
        kvVersion: config.kvVersion,
        secretPath: providerPath,
      }),
      undefined,
      true,
    );
  }

  async function readSecret(secretPath) {
    const payload = await request(
      "GET",
      buildReadPath({
        kvMount: config.kvMount,
        kvVersion: config.kvVersion,
        secretPath,
      }),
      undefined,
      true,
    );

    if (!payload) {
      return null;
    }

    return getSecretData(payload, config.kvVersion);
  }

  async function writeSecret(secretPath, value) {
    const payloadValue = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
    if (config.kvVersion === 1) {
      await request(
        "POST",
        buildWritePath({
          kvMount: config.kvMount,
          kvVersion: config.kvVersion,
          secretPath,
        }),
        payloadValue,
      );
      return;
    }

    await request(
      "POST",
      buildWritePath({
        kvMount: config.kvMount,
        kvVersion: config.kvVersion,
        secretPath,
      }),
      { data: payloadValue },
    );
  }

  async function deleteSecret(secretPath) {
    await request(
      "DELETE",
      buildDeletePath({
        kvMount: config.kvMount,
        kvVersion: config.kvVersion,
        secretPath,
      }),
      undefined,
      true,
    );
  }

  return {
    readProvider,
    writeProvider,
    deleteProvider,
    readSecret,
    writeSecret,
    deleteSecret,
  };
}

export async function createVault({ initialState, options = {}, logger }) {
  const provider = String(options.VAULT_PROVIDER ?? "external").toLowerCase();
  if (provider === "internal") {
    return createLocalVault(initialState);
  }

  const config = {
    address: options.VAULT_ADDR,
    token: options.VAULT_TOKEN,
    namespace: options.VAULT_NAMESPACE ?? null,
    kvMount: normalizePath(options.VAULT_KV_MOUNT ?? "secret"),
    kvVersion: parseKvVersion(options.VAULT_KV_VERSION),
    secretBasePath: normalizePath(options.VAULT_SECRET_PATH ?? "cloud-mcp/providers"),
    tokenIndexPath: normalizePath(options.MCP_HTTP_VAULT_TOKEN_INDEX_PATH ?? "cloud-mcp/http/auth/token-index"),
  };

  if (!config.address || !config.token) {
    throw new Error("External vault mode requires VAULT_ADDR and VAULT_TOKEN");
  }

  const client = await createVaultHttpClient(config);
  const configuredProviders = initialState?.providers ?? {};
  const configuredProviderNames = Object.keys(configuredProviders);
  const providersFromVault = {};

  await Promise.all(
    configuredProviderNames.map(async (providerName) => {
      const providerConfig = await client.readProvider(providerName);
      if (providerConfig && typeof providerConfig === "object") {
        providersFromVault[providerName] = providerConfig;
      }
    }),
  );

  const mergedState = {
    ...initialState,
    providers: {
      ...(initialState?.providers ?? {}),
      ...providersFromVault,
    },
  };

  const tokenIndexFromVault = await client.readSecret(config.tokenIndexPath);
  const tokenIndexSegments = config.tokenIndexPath.split("/").filter((segment) => segment.length > 0);
  if (tokenIndexFromVault && typeof tokenIndexFromVault === "object") {
    setNestedValue(mergedState, tokenIndexSegments, tokenIndexFromVault);
  }

  const localVault = createLocalVault(mergedState);
  let persistedProviderNames = new Set(configuredProviderNames);

  for (const providerName of Object.keys(providersFromVault)) {
    persistedProviderNames.add(providerName);
  }

  async function reconcileProviders() {
    const providers = localVault.get(["providers"], {});
    const nextProviderNames = new Set(Object.keys(providers));

    await Promise.all(
      Object.entries(providers).map(async ([providerName, providerConfig]) =>
        client.writeProvider(providerName, providerConfig),
      ),
    );

    await Promise.all(
      [...persistedProviderNames]
        .filter((providerName) => !nextProviderNames.has(providerName))
        .map(async (providerName) => client.deleteProvider(providerName)),
    );

    persistedProviderNames = nextProviderNames;
  }

  if (Object.keys(providersFromVault).length !== configuredProviderNames.length) {
    await reconcileProviders();
  }

  function persistProviders() {
    void reconcileProviders().catch((error) => {
      logger?.warn?.({ error }, "failed to persist providers to external vault");
    });
  }

  function persistTokenIndex(value) {
    void client.writeSecret(config.tokenIndexPath, value).catch((error) => {
      logger?.warn?.({ error, tokenIndexPath: config.tokenIndexPath }, "failed to persist token index to external vault");
    });
  }

  function deleteTokenIndex() {
    void client.deleteSecret(config.tokenIndexPath).catch((error) => {
      logger?.warn?.({ error, tokenIndexPath: config.tokenIndexPath }, "failed to delete token index from external vault");
    });
  }

  return {
    get(path, defaultValue) {
      return localVault.get(path, defaultValue);
    },
    set(path, value) {
      const result = localVault.set(path, value);
      persistProviders();
      if (pathMatches(path, tokenIndexSegments)) {
        persistTokenIndex(value);
      }
      return result;
    },
    has(path) {
      return localVault.has(path);
    },
    delete(path) {
      const deleted = localVault.delete(path);
      if (deleted) {
        persistProviders();
        if (pathMatches(path, tokenIndexSegments)) {
          deleteTokenIndex();
        }
      }
      return deleted;
    },
    snapshot() {
      return localVault.snapshot();
    },
    list(path) {
      return localVault.list(path);
    },
    getProvider(providerName) {
      return localVault.getProvider(providerName);
    },
    setProvider(providerName, providerConfig) {
      const result = localVault.setProvider(providerName, providerConfig);
      persistProviders();
      return result;
    },
  };
}
