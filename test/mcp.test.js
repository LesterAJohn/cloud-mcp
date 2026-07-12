import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
      "get_command_limits",
      "get_provider",
      "list_providers",
      "push_command_limits",
      "replace_command_limits",
      "run_aws",
      "run_azure",
      "run_gcp",
      "run_oci",
      "run_provider",
      "set_command_limit_section",
      "set_provider",
    ],
  );
});

test("set_command_limit_section updates DB limits and force-pushes to internal file", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cloud-mcp-limits-"));
  const targetPath = path.join(tempDir, "cloud-command-limits.json");

  try {
    const { mcpServer } = await createCloudMcpServer({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
      commandLimitsPath: targetPath,
    });

    await mcpServer._registeredTools.set_command_limit_section.handler({
      provider: "gcloud.*",
      allowedPrefixes: ["projects.list"],
      pushTarget: "internal",
    });

    const getResult = await mcpServer._registeredTools.get_command_limits.handler({});
    const limitsPayload = JSON.parse(getResult.content[0].text);
    assert.deepEqual(limitsPayload["gcp.*"], ["projects.list"]);

    const pushedRaw = await readFile(targetPath, "utf8");
    const pushedPayload = JSON.parse(pushedRaw);
    assert.deepEqual(pushedPayload["gcp.*"], ["projects.list"]);
    assert.deepEqual(pushedPayload["aws.*"], []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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