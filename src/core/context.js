import { loadConfig } from "../config/loadConfig.js";
import { createVaultService } from "./vault.js";
import { createLogger } from "../utils/logger.js";

export async function createExecutionContext(options) {
  const config = await loadConfig(options.config);
  const logger = createLogger(options.logLevel, options.loggerDestination);
  const vault = await createVaultService({
    initialState: config,
    logger,
    moduleSpecifier: process.env.CLOUD_WRAP_VAULT_MODULE ?? config.vault?.module,
    options: config.vault?.options ?? {},
  });

  return {
    config,
    logger,
    providers: vault.get(["providers"], config.providers),
    vault,
  };
}
