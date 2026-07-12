import { loadConfig } from "../config/loadConfig.js";
import { createVaultService } from "./vault.js";
import { createLogger } from "../utils/logger.js";

const BUILTIN_EXTERNAL_VAULT_MODULE = "./src/core/hashicorpVault.js";

function buildVaultOptions(configVaultOptions = {}) {
  const options = { ...configVaultOptions };

  if (process.env.VAULT_PROVIDER) {
    options.VAULT_PROVIDER = process.env.VAULT_PROVIDER;
  }

  if (process.env.VAULT_ADDR) {
    options.VAULT_ADDR = process.env.VAULT_ADDR;
  }

  if (process.env.VAULT_TOKEN) {
    options.VAULT_TOKEN = process.env.VAULT_TOKEN;
  }

  if (process.env.VAULT_NAMESPACE) {
    options.VAULT_NAMESPACE = process.env.VAULT_NAMESPACE;
  }

  if (process.env.VAULT_KV_MOUNT) {
    options.VAULT_KV_MOUNT = process.env.VAULT_KV_MOUNT;
  }

  if (process.env.VAULT_KV_VERSION) {
    options.VAULT_KV_VERSION = process.env.VAULT_KV_VERSION;
  }

  if (process.env.VAULT_SECRET_PATH) {
    options.VAULT_SECRET_PATH = process.env.VAULT_SECRET_PATH;
  }

  return options;
}

function resolveVaultModuleSpecifier(configVaultModule) {
  if (process.env.CLOUD_WRAP_VAULT_MODULE) {
    return process.env.CLOUD_WRAP_VAULT_MODULE;
  }

  if (configVaultModule) {
    return configVaultModule;
  }

  const provider = (process.env.VAULT_PROVIDER ?? "").toLowerCase();
  if (provider === "external") {
    return BUILTIN_EXTERNAL_VAULT_MODULE;
  }

  if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN) {
    return BUILTIN_EXTERNAL_VAULT_MODULE;
  }

  return undefined;
}

export async function createExecutionContext(options) {
  const config = await loadConfig(options.config);
  const logger = createLogger(options.logLevel, options.loggerDestination);
  const vault = await createVaultService({
    initialState: config,
    logger,
    moduleSpecifier: resolveVaultModuleSpecifier(config.vault?.module),
    options: buildVaultOptions(config.vault?.options ?? {}),
  });

  return {
    config,
    logger,
    providers: vault.get(["providers"], config.providers),
    vault,
  };
}
