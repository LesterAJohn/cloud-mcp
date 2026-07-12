import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { createExecutionContext } from "./context.js";
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
      },
    },
    async ({ provider, args }) => {
      const result = await runProviderCommand({ provider, args, ctx, stdio: "pipe" });
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
        },
      },
      async ({ args }) => {
        const result = await runProviderCommand({ provider, args, ctx, stdio: "pipe" });
        return toTextContent(result);
      },
    );
  }
}

export async function createCloudMcpServer(options = {}) {
  const ctx = await createExecutionContext({
    ...options,
    loggerDestination: process.stderr,
  });
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

  initializeProviderAuthorizationKey(ctx, options);

  registerProviderTools(mcpServer, ctx, providerNames);

  return { ctx, mcpServer };
}

export async function runCloudMcpServer(options = {}) {
  const { ctx, mcpServer } = await createCloudMcpServer(options);
  const transport = new StdioServerTransport();

  ctx.logger.info({ tools: Object.keys(mcpServer._registeredTools ?? {}) }, "starting cloud mcp server");
  await mcpServer.connect(transport);
}