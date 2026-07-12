import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { z } from "zod";
import { defaultProviders } from "./providers.js";

dotenv.config({ quiet: true });

const providerSchema = z.object({
  command: z.string().min(1),
  env: z.record(z.string(), z.string()).default({}),
  defaultProfile: z.string().min(1).optional(),
  profiles: z
    .record(
      z.string(),
      z.object({
        args: z.array(z.string()).default([]),
        env: z.record(z.string(), z.string()).default({}),
        users: z.array(z.string()).default([]),
      }),
    )
    .default({}),
  profileSupport: z
    .object({
      mode: z.enum(["arg", "env"]),
      flag: z.string().min(1).optional(),
      envVar: z.string().min(1).optional(),
    })
    .optional(),
});

const vaultOptionsSchema = z
  .object({
    VAULT_PROVIDER: z.string().optional(),
    VAULT_ADDR: z.string().optional(),
    VAULT_TOKEN: z.string().optional(),
    VAULT_NAMESPACE: z.string().optional(),
    VAULT_KV_MOUNT: z.string().optional(),
    VAULT_KV_VERSION: z.string().optional(),
    VAULT_SECRET_PATH: z.string().optional(),
    COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED: z.string().optional(),
    COMMAND_LIMITS_LOCAL_POSTGRES_PORT: z.string().optional(),
  })
  .passthrough();

const vaultSchema = z
  .object({
    module: z.string().optional(),
    options: vaultOptionsSchema.default({}),
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
