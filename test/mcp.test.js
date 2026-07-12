import assert from "node:assert/strict";
import test from "node:test";

import { createCloudMcpServer } from "../src/core/mcp.js";

test("mcp server registers provider commands", async () => {
  const { mcpServer } = await createCloudMcpServer({
    config: "cloud-wrap.config.example.json",
    logLevel: "silent",
  });

  assert.deepEqual(
    Object.keys(mcpServer._registeredTools).sort(),
    [
      "get_provider",
      "list_providers",
      "run_aws",
      "run_azure",
      "run_gcp",
      "run_oci",
      "run_provider",
      "set_provider",
    ],
  );
});

test("get_provider requires authorization key when configured", async () => {
  const previousAuthKey = process.env.MCP_PROVIDER_AUTH_KEY;
  process.env.MCP_PROVIDER_AUTH_KEY = "provider-secret";

  try {
    const { mcpServer } = await createCloudMcpServer({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    await assert.rejects(
      async () => mcpServer._registeredTools.get_provider.handler({ provider: "aws" }),
      /Unauthorized: invalid authorizationKey/,
    );

    const result = await mcpServer._registeredTools.get_provider.handler({
      provider: "aws",
      authorizationKey: "provider-secret",
    });

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.command.length > 0, true);
  } finally {
    if (previousAuthKey === undefined) {
      delete process.env.MCP_PROVIDER_AUTH_KEY;
    } else {
      process.env.MCP_PROVIDER_AUTH_KEY = previousAuthKey;
    }
  }
});

test("set_provider requires authorization key when configured", async () => {
  const previousAuthKey = process.env.MCP_PROVIDER_AUTH_KEY;
  process.env.MCP_PROVIDER_AUTH_KEY = "provider-secret";

  try {
    const { mcpServer } = await createCloudMcpServer({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    await assert.rejects(
      async () =>
        mcpServer._registeredTools.set_provider.handler({
          provider: "aws",
          config: { command: "aws", env: { AWS_REGION: "us-east-1" } },
        }),
      /Unauthorized: invalid authorizationKey/,
    );

    const setResult = await mcpServer._registeredTools.set_provider.handler({
      provider: "aws",
      authorizationKey: "provider-secret",
      config: { command: "aws-custom", env: { AWS_REGION: "us-west-2" } },
    });

    const setPayload = JSON.parse(setResult.content[0].text);
    assert.equal(setPayload.ok, true);

    const getResult = await mcpServer._registeredTools.get_provider.handler({
      provider: "aws",
      authorizationKey: "provider-secret",
    });
    const getPayload = JSON.parse(getResult.content[0].text);
    assert.equal(getPayload.command, "aws-custom");
    assert.deepEqual(getPayload.env, { AWS_REGION: "us-west-2" });
  } finally {
    if (previousAuthKey === undefined) {
      delete process.env.MCP_PROVIDER_AUTH_KEY;
    } else {
      process.env.MCP_PROVIDER_AUTH_KEY = previousAuthKey;
    }
  }
});