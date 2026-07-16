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
      description: "List all providers registered in the vault",
    },
    async () => toTextContent(providerNames),
  );

  mcpServer.registerTool(
    "get_provider",
    {
      description: "Get a provider configuration from the vault",
      inputSchema: {
        provider: z.string().describe("Provider name"),
        authorizationKey: z.string().min(1).optional().describe("Provider vault authorization key"),
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
      description: "Store a provider configuration in the vault",
      inputSchema: {
        provider: z.string().describe("Provider name"),
        authorizationKey: z.string().min(1).optional().describe("Provider vault authorization key"),
        config: z
          .object({
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
          })
          .describe("Provider config"),
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
      description: "Run a provider CLI command",
      inputSchema: {
        provider: z.string().describe("Provider name"),
        args: z.array(z.string()).default([]).describe("Arguments passed to the provider CLI"),
        profile: z.string().min(1).optional().describe("Optional provider profile/context name"),
        user: z.string().min(1).optional().describe("Optional user identity for profile access checks"),
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
        description: `Run the ${provider} CLI command`,
        inputSchema: {
          args: z.array(z.string()).default([]).describe("Arguments passed to the provider CLI"),
          profile: z.string().min(1).optional().describe("Optional provider profile/context name"),
          user: z.string().min(1).optional().describe("Optional user identity for profile access checks"),
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
      description: "Get effective command limits currently stored in database",
    },
    async () => toTextContent(await getCommandLimits(ctx)),
  );

  mcpServer.registerTool(
    "set_command_limit_section",
    {
      description: "Set one provider command-limit section in database and force-push cloud-command-limits JSON",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Provider vault authorization key"),
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
          .describe("Provider section"),
        allowedPrefixes: z.array(z.string()).default([]).describe("Allowed command prefixes for the section"),
        pushTarget: z
          .enum(["auto", "internal", "external"])
          .default("auto")
          .describe("Force-push target for cloud-command-limits JSON"),
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
      description: "Replace all command-limit sections in database and force-push cloud-command-limits JSON",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Provider vault authorization key"),
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
          .describe("Full canonical command-limits payload"),
        pushTarget: z
          .enum(["auto", "internal", "external"])
          .default("auto")
          .describe("Force-push target for cloud-command-limits JSON"),
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
      description: "Force-push DB command limits to internal or external cloud-command-limits JSON",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Provider vault authorization key"),
        pushTarget: z
          .enum(["auto", "internal", "external"])
          .default("auto")
          .describe("Force-push target for cloud-command-limits JSON"),
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
        "Generate an opaque bearer token and store its SHA-256 hash in the Vault HTTP token index (admin auth required when configured)",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Provider vault authorization key"),
        userId: z.string().min(1).optional().describe("User id associated to this token entry"),
        tokenId: z.string().min(1).optional().describe("Optional token id label"),
        scopes: z.union([z.string().min(1), z.array(z.string().min(1))]).optional().describe("Scopes string or array"),
        audience: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .optional()
          .describe("Audience string or array"),
        expiresAt: z.string().min(1).optional().describe("Optional ISO expiration timestamp"),
        path: z.string().min(1).optional().describe("Vault token index path override"),
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
        "Store a provided OAuth access token hash in the Vault HTTP token index (admin auth required when configured)",
      inputSchema: {
        authorizationKey: z.string().min(1).optional().describe("Provider vault authorization key"),
        token: z.string().min(1).describe("OAuth access token"),
        userId: z.string().min(1).optional().describe("User id associated to this token entry"),
        tokenId: z.string().min(1).optional().describe("Optional token id label"),
        scopes: z.union([z.string().min(1), z.array(z.string().min(1))]).optional().describe("Scopes string or array"),
        audience: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .optional()
          .describe("Audience string or array"),
        expiresAt: z.string().min(1).optional().describe("Optional ISO expiration timestamp"),
        path: z.string().min(1).optional().describe("Vault token index path override"),
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