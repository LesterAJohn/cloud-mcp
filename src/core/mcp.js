import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { createExecutionContext } from "./context.js";
import { createHttpMcpServer } from "../http/server.js";
import {
  createBearerToken,
  createVaultTokenEntry,
  mergeVaultTokenIndex,
  normalizeTokenIndexPath,
  tokenIndexPathToVaultPath,
} from "../http/tokenIndex.js";
import {
  forcePushCommandLimits,
  getCommandLimits,
  getSupportedCommandLimitSections,
  replaceCommandLimits,
  setProviderCommandLimits,
} from "./commandLimitsAdmin.js";
import { runProviderCommand } from "./execute.js";

const PROVIDER_AUTH_KEY_PATH = ["mcp", "authorization", "providerKey"];

function toTextContent(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function initializeProviderAuthorizationKey(ctx, options = {}) {
  const configuredKey = options.providerAuthorizationKey ?? process.env.MCP_PROVIDER_AUTH_KEY;
  if (typeof configuredKey === "string" && configuredKey.length > 0) {
    ctx.vault.set(PROVIDER_AUTH_KEY_PATH, configuredKey);
  }
}

function validateProviderAuthorization(ctx, authorizationKey) {
  const expectedKey = ctx.vault.get(PROVIDER_AUTH_KEY_PATH, null);
  if (!expectedKey) {
    return;
  }

  if (!authorizationKey || authorizationKey !== expectedKey) {
    throw new Error("Unauthorized: invalid authorizationKey for provider vault operations");
  }
}

function registerProviderTools(mcpServer, ctx, providerNames) {
  mcpServer.registerTool(
    "list_providers",
    {
      description:
        "Read-only. List provider names currently available in the vault/config store. Use this before get_provider or run_provider when you need to discover the active provider list; it does not add, remove, or validate provider configs.",
    },
    async () => toTextContent(providerNames),
  );

  mcpServer.registerTool(
    "get_provider",
    {
      description:
        "Read-only. Fetch one provider configuration from the vault. Use it to inspect the stored command, env, and profile settings before editing or running a provider. Returns null when the provider is missing; if provider vault authorization is enabled, authorizationKey is required.",
      inputSchema: {
        provider: z.string().min(1).describe("Provider name as stored in the vault, for example aws or gcp"),
        authorizationKey: z.string().min(1).optional().describe("Required only when MCP_PROVIDER_AUTH_KEY is configured"),
      },
    },
    async ({ provider, authorizationKey }) => {
      validateProviderAuthorization(ctx, authorizationKey);
      return toTextContent(ctx.vault.get(["providers", provider], null));
    },
  );

  mcpServer.registerTool(
    "set_provider",
    {
      description:
        "Mutating and high-risk. Store or replace a provider configuration in the vault, then expose it through the provider tool list. Use this to register a new cloud CLI or update the stored command/env/profile mapping; if provider vault authorization is enabled, authorizationKey is required.",
      inputSchema: {
        provider: z.string().min(1).describe("Provider name as stored in the vault, for example aws or azure"),
        authorizationKey: z.string().min(1).optional().describe("Required only when MCP_PROVIDER_AUTH_KEY is configured"),
        config: z
          .object({
            command: z.string().min(1).describe("CLI command to execute, for example aws or gcloud"),
            env: z.record(z.string(), z.string()).default({}).describe("Base environment variables injected for every run"),
            defaultProfile: z.string().min(1).optional().describe("Optional default profile name"),
            profiles: z
              .record(
                z.string(),
                z.object({
                  args: z.array(z.string()).default([]).describe("Extra argv segments for this profile"),
                  env: z.record(z.string(), z.string()).default({}).describe("Environment overrides for this profile"),
                  users: z.array(z.string()).default([]).describe("Allowed user identities; empty means allow all"),
                }),
              )
              .default({})
              .describe("Profile-specific args, env, and user access rules"),
            profileSupport: z
              .object({
                mode: z.enum(["arg", "env"]).describe("How profile selection is passed to the CLI"),
                flag: z.string().min(1).optional().describe("CLI flag name when mode is arg"),
                envVar: z.string().min(1).optional().describe("Environment variable name when mode is env"),
              })
              .optional()
              .describe("Optional CLI-specific profile wiring"),
          })
          .describe("Provider config payload to persist"),
      },
    },
    async ({ provider, config, authorizationKey }) => {
      validateProviderAuthorization(ctx, authorizationKey);
      ctx.vault.setProvider(provider, config);
      if (!providerNames.includes(provider)) {
        providerNames.push(provider);
        providerNames.sort();
      }

      return toTextContent({ ok: true, provider, config });
    },
  );

  mcpServer.registerTool(
    "run_provider",
    {
      description:
        "Executes a provider CLI command. High-risk because it spawns the configured CLI and can reach external cloud APIs. Use this when you need a dynamic provider name; prefer run_<provider> for a fixed provider. args must be literal argv segments, not shell text, and provider limits or profile access checks can reject the request.",
      inputSchema: {
        provider: z.string().min(1).describe("Provider name as configured in the vault"),
        args: z
          .array(z.string())
          .default([])
          .describe("Literal argv segments passed to the CLI, for example ['sts', 'get-caller-identity']"),
        profile: z.string().min(1).optional().describe("Optional provider profile or context name"),
        user: z.string().min(1).optional().describe("Optional user identity used for profile access checks"),
      },
    },
    async ({ provider, args, profile, user }) => {
      const result = await runProviderCommand({ provider, args, profile, user, ctx, stdio: "pipe" });
      return toTextContent(result);
    },
  );

  for (const provider of providerNames) {
    mcpServer.registerTool(
      `run_${provider}`,
      {
        description:
          `Executes the ${provider} CLI command. High-risk because it runs the configured binary and can change or query cloud state. Use this when the provider is fixed; args must be literal argv segments, not shell text, and profile or command-limit checks can reject the request.`,
        inputSchema: {
          args: z
            .array(z.string())
            .default([])
            .describe("Literal argv segments passed to the CLI, for example ['projects', 'list']"),
          profile: z.string().min(1).optional().describe("Optional provider profile or context name"),
          user: z.string().min(1).optional().describe("Optional user identity used for profile access checks"),
        },
      },
      async ({ args, profile, user }) => {
        const result = await runProviderCommand({ provider, args, profile, user, ctx, stdio: "pipe" });
        return toTextContent(result);
      },
    );
  }
}

function registerCommandLimitsTools(mcpServer, ctx) {
  const providerSectionEnum = getSupportedCommandLimitSections();

  mcpServer.registerTool(
    "get_command_limits",
    {
      description:
        "Read-only. Return the effective command-limit policy currently loaded from the database. Use this before editing limits or debugging denied commands; it reflects the normalized canonical sections that are actually enforced at runtime.",
    },
    async () => toTextContent(await getCommandLimits(ctx)),
  );

  mcpServer.registerTool(
    "set_command_limit_section",
    {
      description:
        "Mutating and high-risk. Replace one provider command-limit section in the database and then force-push the effective policy to the configured JSON target. Use canonical section names or supported aliases; allowedPrefixes are literal command prefixes such as s3 or sts.get-caller-identity, not shell globs. If provider vault authorization is enabled, authorizationKey is required.",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Required only when MCP_PROVIDER_AUTH_KEY is configured"),
        provider: z
          .enum([
            "aws",
            "aws.*",
            "gcp",
            "gcp.*",
            "gcloud",
            "gcloud.*",
            "azure",
            "azure.*",
            "az",
            "az.*",
            "oci",
            "oci.*",
            "alibaba",
            "alibaba.*",
            "aliyun",
            "aliyun.*",
            "digitalocean",
            "digitalocean.*",
            "doctl",
            "doctl.*",
            "ibmcloud",
            "ibmcloud.*",
            "tencent",
            "tencent.*",
            "tccli",
            "tccli.*",
            "huawei",
            "huawei.*",
            "hcloud",
            "hcloud.*",
          ])
          .describe("Provider section to replace"),
        allowedPrefixes: z
          .array(z.string())
          .default([])
          .describe("Allowed command prefixes for the section; empty array allows everything for that provider"),
        pushTarget: z
          .enum(["auto", "internal", "external"])
          .default("auto")
          .describe("Where to force-push the JSON copy after the database update"),
      },
    },
    async ({ provider, allowedPrefixes, pushTarget, authorizationKey }) => {
      validateProviderAuthorization(ctx, authorizationKey);
      const limits = await setProviderCommandLimits(ctx, provider, allowedPrefixes);
      const pushed = await forcePushCommandLimits(ctx, pushTarget);
      return toTextContent({
        updatedSection: provider,
        limits,
        pushed,
      });
    },
  );

  mcpServer.registerTool(
    "replace_command_limits",
    {
      description:
        "Mutating and high-risk. Replace the entire command-limit policy in the database and then force-push the effective JSON copy. Use this for full policy resets or bulk edits; the payload must include the canonical provider sections, and if provider vault authorization is enabled, authorizationKey is required.",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Required only when MCP_PROVIDER_AUTH_KEY is configured"),
        commandLimits: z
          .object({
            "aws.*": z.array(z.string()).default([]),
            "gcp.*": z.array(z.string()).default([]),
            "azure.*": z.array(z.string()).default([]),
            "oci.*": z.array(z.string()).default([]),
            "alibaba.*": z.array(z.string()).default([]),
            "digitalocean.*": z.array(z.string()).default([]),
            "ibmcloud.*": z.array(z.string()).default([]),
            "tencent.*": z.array(z.string()).default([]),
            "huawei.*": z.array(z.string()).default([]),
          })
          .describe("Full canonical command-limits payload using aws.*, gcp.*, azure.*, oci.*, alibaba.*, digitalocean.*, ibmcloud.*, tencent.*, and huawei.*"),
        pushTarget: z
          .enum(["auto", "internal", "external"])
          .default("auto")
          .describe("Where to force-push the JSON copy after the database update"),
      },
    },
    async ({ commandLimits, pushTarget, authorizationKey }) => {
      validateProviderAuthorization(ctx, authorizationKey);
      const limits = await replaceCommandLimits(ctx, commandLimits);
      const pushed = await forcePushCommandLimits(ctx, pushTarget);
      return toTextContent({ limits, pushed });
    },
  );

  mcpServer.registerTool(
    "push_command_limits",
    {
      description:
        "Mutating and high-risk. Force-push the current database-backed command limits to the internal file or external source without changing the database itself. Use this after manual DB edits or to sync the JSON artifact; if provider vault authorization is enabled, authorizationKey is required. The auto target prefers the external source when one is configured.",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Required only when MCP_PROVIDER_AUTH_KEY is configured"),
        pushTarget: z
          .enum(["auto", "internal", "external"])
          .default("auto")
          .describe("Choose internal file, external source, or auto selection"),
      },
    },
    async ({ pushTarget, authorizationKey }) => {
      validateProviderAuthorization(ctx, authorizationKey);
      return toTextContent(await forcePushCommandLimits(ctx, pushTarget));
    },
  );
}

function registerHttpAuthTools(mcpServer, ctx) {
  async function seedVaultToken({ token, userId, tokenId, scopes, audience, expiresAt, path, tokenType, authorizationKey }) {
    validateProviderAuthorization(ctx, authorizationKey);

    const indexPath = normalizeTokenIndexPath(path);
    const vaultPath = tokenIndexPathToVaultPath(indexPath);
    const existingPayload = ctx.vault.get(vaultPath, {});
    const { tokenHash, entry } = createVaultTokenEntry({
      token,
      userId,
      tokenId,
      scopes,
      audience,
      expiresAt,
      tokenType,
    });

    const merged = mergeVaultTokenIndex(existingPayload, {
      tokenHash,
      entry,
    });

    ctx.vault.set(vaultPath, merged);

    return {
      ok: true,
      indexPath,
      tokenHash,
      userId: entry.userId,
      tokenId: entry.tokenId,
      scopes: entry.scopes,
      audience: entry.audience,
      expiresAt: entry.expiresAt ?? null,
      tokenType: entry.tokenType,
    };
  }

  mcpServer.registerTool(
    "vault_seed_http_token",
    {
      description:
        "Mutating and high-risk. Generate a new bearer token, store only its SHA-256 hash in the Vault HTTP token index, and return the plaintext token exactly once. Use this to provision HTTP auth credentials; if provider vault authorization is enabled, authorizationKey is required.",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Required only when MCP_PROVIDER_AUTH_KEY is configured"),
        userId: z.string().min(1).optional().describe("User id stored with the token entry; defaults to MCP_HTTP_VAULT_TOKEN_DEFAULT_USER_ID or default"),
        tokenId: z.string().min(1).optional().describe("Optional token id label for auditing and rotation"),
        scopes: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .optional()
          .describe("Scopes as a comma-separated string or array of strings"),
        audience: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .optional()
          .describe("Audience as a comma-separated string or array of strings"),
        expiresAt: z.string().min(1).optional().describe("Optional ISO-8601 expiration timestamp"),
        path: z.string().min(1).optional().describe("Override for the Vault token index path"),
      },
    },
    async ({ authorizationKey, userId, tokenId, scopes, audience, expiresAt, path }) => {
      const token = createBearerToken();
      const seeded = await seedVaultToken({
        token,
        userId,
        tokenId,
        scopes,
        audience,
        expiresAt,
        path,
        tokenType: "bearer",
        authorizationKey,
      });

      return toTextContent({
        ...seeded,
        token,
      });
    },
  );

  mcpServer.registerTool(
    "vault_seed_oauth_token",
    {
      description:
        "Mutating and high-risk. Store a provided OAuth access token as a SHA-256 hash in the Vault HTTP token index. Use this when an external OAuth provider already issued the token; the plaintext token is never returned, and if provider vault authorization is enabled, authorizationKey is required.",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Required only when MCP_PROVIDER_AUTH_KEY is configured"),
        token: z.string().min(1).describe("OAuth access token to hash and store"),
        userId: z.string().min(1).optional().describe("User id stored with the token entry; defaults to MCP_HTTP_VAULT_TOKEN_DEFAULT_USER_ID or default"),
        tokenId: z.string().min(1).optional().describe("Optional token id label for auditing and rotation"),
        scopes: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .optional()
          .describe("Scopes as a comma-separated string or array of strings"),
        audience: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .optional()
          .describe("Audience as a comma-separated string or array of strings"),
        expiresAt: z.string().min(1).optional().describe("Optional ISO-8601 expiration timestamp"),
        path: z.string().min(1).optional().describe("Override for the Vault token index path"),
      },
    },
    async ({ authorizationKey, token, userId, tokenId, scopes, audience, expiresAt, path }) =>
      toTextContent(
        await seedVaultToken({
          token,
          userId,
          tokenId,
          scopes,
          audience,
          expiresAt,
          path,
          tokenType: "oauth2",
          authorizationKey,
        }),
      ),
  );
}

export async function createCloudMcpServer(options = {}) {
  const ctx = await createExecutionContext({
    ...options,
    loggerDestination: process.stderr,
  });

  initializeProviderAuthorizationKey(ctx, options);

  return {
    ctx,
    mcpServer: createMcpServerForContext(ctx),
  };
}

function createMcpServerForContext(ctx) {
  const providerNames = Object.keys(ctx.vault.get(["providers"], ctx.providers) ?? {}).sort();

  const mcpServer = new McpServer(
    {
      name: "cloud-mcp",
      version: "1.0.0",
    },
    {
      instructions: "Use the provider tools to inspect vault-backed cloud configurations and run CLI commands.",
    },
  );

  registerProviderTools(mcpServer, ctx, providerNames);
  registerCommandLimitsTools(mcpServer, ctx);
  registerHttpAuthTools(mcpServer, ctx);

  return mcpServer;
}

export async function runCloudMcpServer(options = {}) {
  const transportMode = String(options.transportMode ?? process.env.MCP_TRANSPORT_MODE ?? "both").toLowerCase();
  if (!["stdio", "http", "both"].includes(transportMode)) {
    throw new Error(`Unsupported transport mode '${transportMode}'. Use stdio|http|both.`);
  }

  const { ctx } = await createCloudMcpServer(options);
  const servers = [];

  if (transportMode === "stdio" || transportMode === "both") {
    const stdioServer = createMcpServerForContext(ctx);
    const stdioTransport = new StdioServerTransport();
    ctx.logger.info({ tools: Object.keys(stdioServer._registeredTools ?? {}) }, "starting cloud mcp stdio transport");
    await stdioServer.connect(stdioTransport);
    servers.push(stdioServer);
  }

  let httpServer;
  if (transportMode === "http" || transportMode === "both") {
    httpServer = await createHttpMcpServer({
      ctx,
      createMcpServer: () => createMcpServerForContext(ctx),
      options,
    });
  }

  const shutdown = async () => {
    try {
      if (httpServer) {
        await httpServer.close();
      }

      for (const server of servers) {
        await server.close();
      }
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}