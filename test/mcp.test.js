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
      "run_alibaba",
      "run_aws",
      "run_azure",
      "run_digitalocean",
      "run_gcp",
      "run_huawei",
      "run_ibmcloud",
      "run_oci",
      "run_provider",
      "run_tencent",
      "set_command_limit_section",
      "set_provider",
    ],
  );
});

test("run_provider applies profile settings from provider config", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cloud-mcp-provider-profile-"));
  const outputPath = path.join(tempDir, "profile-output.json");

  try {
    const { mcpServer } = await createCloudMcpServer({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    const writerProgram = [
      "const fs = require('node:fs');",
      "const outPath = process.env.TEST_PROFILE_OUTPUT_PATH;",
      "fs.writeFileSync(outPath, JSON.stringify({ args: process.argv.slice(1), env: { TEST_PROFILE_ENV: process.env.TEST_PROFILE_ENV || null, TEST_SELECTED_PROFILE: process.env.TEST_SELECTED_PROFILE || null } }));",
    ].join("");

    await mcpServer._registeredTools.set_provider.handler({
      provider: "profiletest",
      config: {
        command: "node",
        env: {
          TEST_PROFILE_OUTPUT_PATH: outputPath,
        },
        profileSupport: {
          mode: "env",
          envVar: "TEST_SELECTED_PROFILE",
        },
        profiles: {
          prod: {
            args: ["-e", writerProgram],
            env: {
              TEST_PROFILE_ENV: "prod-profile",
            },
          },
        },
      },
    });

    await mcpServer._registeredTools.run_provider.handler({
      provider: "profiletest",
      profile: "prod",
      args: ["resource", "list"],
    });

    const raw = await readFile(outputPath, "utf8");
    const payload = JSON.parse(raw);

    assert.deepEqual(payload.args, ["resource", "list"]);
    assert.equal(payload.env.TEST_PROFILE_ENV, "prod-profile");
    assert.equal(payload.env.TEST_SELECTED_PROFILE, "prod");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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