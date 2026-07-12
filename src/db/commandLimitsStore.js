import { Pool } from "pg";

const COMMAND_LIMIT_KEYS = [
  "aws.*",
  "gcp.*",
  "azure.*",
  "oci.*",
  "alibaba.*",
  "digitalocean.*",
  "ibmcloud.*",
  "tencent.*",
  "huawei.*",
];
const TABLE_NAME = "cloud_mcp.command_limits";

const DEFAULT_COMMAND_LIMITS = {
  "aws.*": [],
  "gcp.*": [],
  "azure.*": [],
  "oci.*": [],
  "alibaba.*": [],
  "digitalocean.*": [],
  "ibmcloud.*": [],
  "tencent.*": [],
  "huawei.*": [],
};

function normalizeLimits(input = {}) {
  return {
    "aws.*": Array.isArray(input["aws.*"]) ? input["aws.*"] : [],
    "gcp.*": Array.isArray(input["gcp.*"]) ? input["gcp.*"] : [],
    "azure.*": Array.isArray(input["azure.*"]) ? input["azure.*"] : [],
    "oci.*": Array.isArray(input["oci.*"]) ? input["oci.*"] : [],
    "alibaba.*": Array.isArray(input["alibaba.*"]) ? input["alibaba.*"] : [],
    "digitalocean.*": Array.isArray(input["digitalocean.*"]) ? input["digitalocean.*"] : [],
    "ibmcloud.*": Array.isArray(input["ibmcloud.*"]) ? input["ibmcloud.*"] : [],
    "tencent.*": Array.isArray(input["tencent.*"]) ? input["tencent.*"] : [],
    "huawei.*": Array.isArray(input["huawei.*"]) ? input["huawei.*"] : [],
  };
}

function resolveDatabaseUrl() {
  return process.env.COMMAND_LIMITS_DATABASE_URL ?? process.env.DATABASE_URL;
}

function createInMemoryStore(logger) {
  let limits = { ...DEFAULT_COMMAND_LIMITS };

  return {
    async initialize() {
      logger?.debug?.("command limits store running in in-memory mode");
    },
    async sync(commandLimits) {
      limits = normalizeLimits(commandLimits);
    },
    async getAll() {
      return limits;
    },
    mode: "memory",
  };
}

function createPostgresStore(databaseUrl, logger) {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    async initialize() {
      const client = await pool.connect();
      try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS cloud_mcp`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            provider_prefix TEXT PRIMARY KEY,
            allowed_prefixes JSONB NOT NULL DEFAULT '[]'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          INSERT INTO ${TABLE_NAME} (provider_prefix, allowed_prefixes, updated_at)
          SELECT provider_prefix, allowed_prefixes, COALESCE(updated_at, NOW())
          FROM public.command_limits
          WHERE to_regclass('public.command_limits') IS NOT NULL
          ON CONFLICT (provider_prefix) DO NOTHING
        `);

        for (const providerPrefix of COMMAND_LIMIT_KEYS) {
          await client.query(
            `
              INSERT INTO ${TABLE_NAME} (provider_prefix, allowed_prefixes)
              VALUES ($1, '[]'::jsonb)
              ON CONFLICT (provider_prefix) DO NOTHING
            `,
            [providerPrefix],
          );
        }
      } finally {
        client.release();
      }
    },
    async sync(commandLimits) {
      const normalized = normalizeLimits(commandLimits);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        for (const providerPrefix of COMMAND_LIMIT_KEYS) {
          await client.query(
            `
              INSERT INTO ${TABLE_NAME} (provider_prefix, allowed_prefixes, updated_at)
              VALUES ($1, $2::jsonb, NOW())
              ON CONFLICT (provider_prefix)
              DO UPDATE SET allowed_prefixes = EXCLUDED.allowed_prefixes, updated_at = NOW()
            `,
            [providerPrefix, JSON.stringify(normalized[providerPrefix])],
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async getAll() {
      const { rows } = await pool.query(
        `
          SELECT provider_prefix, allowed_prefixes
          FROM ${TABLE_NAME}
          WHERE provider_prefix = ANY($1::text[])
        `,
        [COMMAND_LIMIT_KEYS],
      );

      const byProvider = { ...DEFAULT_COMMAND_LIMITS };
      for (const row of rows) {
        const providerPrefix = row.provider_prefix;
        if (providerPrefix in byProvider) {
          byProvider[providerPrefix] = Array.isArray(row.allowed_prefixes) ? row.allowed_prefixes : [];
        }
      }

      return byProvider;
    },
    mode: "postgres",
  };
}

export function createCommandLimitsStore(logger) {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return createInMemoryStore(logger);
  }

  logger?.info?.({ databaseUrl: "set" }, "using postgres for command limits");
  return createPostgresStore(databaseUrl, logger);
}