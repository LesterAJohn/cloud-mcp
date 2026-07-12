import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { z } from "zod";
import { defaultProviders } from "./providers.js";

dotenv.config({ quiet: true });

const providerSchema = z.object({
  command: z.string().min(1),
  env: z.record(z.string(), z.string()).default({}),
});

const vaultSchema = z
  .object({
    module: z.string().optional(),
    options: z.record(z.string(), z.any()).default({}),
  })
  .default({ options: {} });

const configSchema = z.object({
  providers: z.record(z.string(), providerSchema),
  vault: vaultSchema.optional(),
});

export async function loadConfig(configPath) {
  const baseConfig = {
    providers: defaultProviders,
  };

  if (!configPath || !existsSync(configPath)) {
    return configSchema.parse(baseConfig);
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);

  const merged = {
    ...baseConfig,
    ...parsed,
    providers: {
      ...baseConfig.providers,
      ...parsed.providers,
    },
  };

  return configSchema.parse(merged);
}
