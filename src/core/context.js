import { loadConfig } from "../config/loadConfig.js";
import { loadCommandLimits } from "../config/loadCommandLimits.js";
import { createCommandLimitsStore } from "../db/commandLimitsStore.js";
import { createVaultService } from "./vault.js";
import { createLogger } from "../utils/logger.js";

const BUILTIN_EXTERNAL_VAULT_MODULE = "./src/core/hashicorpVault.js";
const DEFAULT_COMMAND_LIMITS_PATH = "mcp/cloud-command-limits.json";

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

  if (process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED) {
    options.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
  }

  if (process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT) {
    options.COMMAND_LIMITS_LOCAL_POSTGRES_PORT = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;
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

function shouldFailClosedOnExternalVault() {
  const provider = (process.env.VAULT_PROVIDER ?? "").toLowerCase();
  return provider === "external" && Boolean(process.env.VAULT_ADDR) && Boolean(process.env.VAULT_TOKEN);
}

function resolveCommandLimitsSource(options) {
  return options.commandLimitsSource ?? process.env.CLOUD_COMMAND_LIMITS_SOURCE;
}

function resolveCommandLimitsRefreshIntervalSeconds(options) {
  const rawValue =
    options.commandLimitsRefreshIntervalSeconds ?? process.env.CLOUD_COMMAND_LIMITS_REFRESH_INTERVAL_SECONDS;

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return 0;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function startCommandLimitsRefresh({ ctx, logger, commandLimitsPath, commandLimitsSource, refreshIntervalSeconds }) {
  if (!commandLimitsSource || refreshIntervalSeconds <= 0) {
    return;
  }

  const intervalMs = refreshIntervalSeconds * 1000;
  const timer = setInterval(async () => {
    try {
      const reloaded = await loadCommandLimits({
        commandLimitsPath,
        commandLimitsSource,
      });
      await ctx.commandLimitsStore.sync(reloaded);
      logger.debug(
        { commandLimitsSource, refreshIntervalSeconds },
        "reloaded cloud command limits from external source into database",
      );
    } catch (error) {
      logger.warn({ error, commandLimitsSource }, "failed to refresh cloud command limits");
    }
  }, intervalMs);
  timer.unref();
}

export async function createExecutionContext(options) {
  const config = await loadConfig(options.config);
  const commandLimitsPath = options.commandLimitsPath ?? DEFAULT_COMMAND_LIMITS_PATH;
  const commandLimitsSource = resolveCommandLimitsSource(options);
  const refreshIntervalSeconds = resolveCommandLimitsRefreshIntervalSeconds(options);
  const initialCommandLimits = await loadCommandLimits({
    commandLimitsPath,
    commandLimitsSource,
  });
  const logger = createLogger(options.logLevel, options.loggerDestination);
  const commandLimitsStore = createCommandLimitsStore(logger);
  await commandLimitsStore.initialize();
  await commandLimitsStore.sync(initialCommandLimits);

  const vault = await createVaultService({
    initialState: config,
    logger,
    moduleSpecifier: resolveVaultModuleSpecifier(config.vault?.module),
    options: buildVaultOptions(config.vault?.options ?? {}),
    failOnExternalVaultError: shouldFailClosedOnExternalVault(),
  });

  const ctx = {
    config,
    commandLimitsConfig: {
      path: commandLimitsPath,
      source: commandLimitsSource,
      refreshIntervalSeconds,
    },
    commandLimitsStore,
    logger,
    providers: vault.get(["providers"], config.providers),
    vault,
  };

  startCommandLimitsRefresh({
    ctx,
    logger,
    commandLimitsPath,
    commandLimitsSource,
    refreshIntervalSeconds,
  });

  return ctx;
}
