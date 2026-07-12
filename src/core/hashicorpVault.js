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

  return {
    readProvider,
    writeProvider,
    deleteProvider,
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

  return {
    get(path, defaultValue) {
      return localVault.get(path, defaultValue);
    },
    set(path, value) {
      const result = localVault.set(path, value);
      persistProviders();
      return result;
    },
    has(path) {
      return localVault.has(path);
    },
    delete(path) {
      const deleted = localVault.delete(path);
      if (deleted) {
        persistProviders();
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
