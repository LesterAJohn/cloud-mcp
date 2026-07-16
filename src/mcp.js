#!/usr/bin/env node

import { runCloudMcpServer } from "./core/mcp.js";

async function main() {
  const args = process.argv.slice(2);
  const options = {
    config: "cloud-wrap.config.json",
    logLevel: "info",
    transportMode: process.env.MCP_TRANSPORT_MODE ?? "both",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--config") {
      options.config = args[index + 1];
      index += 1;
    } else if (arg === "--log-level") {
      options.logLevel = args[index + 1];
      index += 1;
    } else if (arg === "--transport") {
      options.transportMode = args[index + 1];
      index += 1;
    } else if (arg === "--http-host") {
      options.httpHost = args[index + 1];
      index += 1;
    } else if (arg === "--http-port") {
      options.httpPort = args[index + 1];
      index += 1;
    } else if (arg === "--http-path") {
      options.httpPath = args[index + 1];
      index += 1;
    } else if (arg === "--http-health-path") {
      options.httpHealthPath = args[index + 1];
      index += 1;
    } else if (arg === "--http-auth-mode") {
      options.authMode = args[index + 1];
      index += 1;
    } else if (arg === "--http-token-source") {
      options.tokenSource = args[index + 1];
      index += 1;
    } else if (arg === "--http-auth-tokens") {
      options.authTokens = args[index + 1];
      index += 1;
    } else if (arg === "--http-vault-token-index-path") {
      options.vaultTokenIndexPath = args[index + 1];
      index += 1;
    } else if (arg === "--http-vault-token-default-user-id") {
      options.vaultTokenDefaultUserId = args[index + 1];
      index += 1;
    } else if (arg === "--http-vault-token-required-scopes") {
      options.vaultTokenRequiredScopes = args[index + 1];
      index += 1;
    } else if (arg === "--http-vault-token-required-audience") {
      options.vaultTokenRequiredAudience = args[index + 1];
      index += 1;
    } else if (arg === "--http-vault-token-cache-ttl-ms") {
      options.vaultTokenCacheTtlMs = args[index + 1];
      index += 1;
    } else if (arg === "--http-trust-proxy") {
      options.httpTrustedProxy = args[index + 1];
      index += 1;
    } else if (arg === "--http-allowed-origins") {
      options.httpAllowedOrigins = args[index + 1];
      index += 1;
    } else if (arg === "--http-allowed-ips") {
      options.httpAllowedIps = args[index + 1];
      index += 1;
    } else if (arg === "--http-rate-limit-window-ms") {
      options.httpRateLimitWindowMs = args[index + 1];
      index += 1;
    } else if (arg === "--http-rate-limit-max-requests") {
      options.httpRateLimitMaxRequests = args[index + 1];
      index += 1;
    } else if (arg === "--oauth-introspection-url") {
      options.oauthIntrospectionUrl = args[index + 1];
      index += 1;
    } else if (arg === "--oauth-client-id") {
      options.oauthClientId = args[index + 1];
      index += 1;
    } else if (arg === "--oauth-client-secret") {
      options.oauthClientSecret = args[index + 1];
      index += 1;
    } else if (arg === "--oauth-required-scopes") {
      options.oauthRequiredScopes = args[index + 1];
      index += 1;
    } else if (arg === "--oauth-required-audience") {
      options.oauthRequiredAudience = args[index + 1];
      index += 1;
    }
  }

  await runCloudMcpServer(options);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`cloud-mcp failed: ${message}`);
  process.exitCode = 1;
});