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
      "vault_seed_http_token",
      "vault_seed_oauth_token",
    ],
  );
});

test("vault_seed_http_token stores hashed token entry in vault index", async () => {
  const previousAuthKey = process.env.MCP_PROVIDER_AUTH_KEY;
  process.env.MCP_PROVIDER_AUTH_KEY = "provider-secret";

  try {
    const { ctx, mcpServer } = await createCloudMcpServer({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    const result = await mcpServer._registeredTools.vault_seed_http_token.handler({
      authorizationKey: "provider-secret",
      userId: "default",
      scopes: ["mcp:invoke"],
      audience: ["cloud-mcp"],
    });

    const payload = JSON.parse(result.content[0].text);
    assert.equal(typeof payload.token, "string");
    assert.equal(payload.token.length > 10, true);
    assert.equal(payload.tokenType, "bearer");

    const stored = ctx.vault.get(["cloud-mcp", "http", "auth", "token-index"], {});
    assert.equal(typeof stored.tokens[payload.tokenHash], "object");
    assert.deepEqual(stored.tokens[payload.tokenHash].scopes, ["mcp:invoke"]);
  } finally {
    if (previousAuthKey === undefined) {
      delete process.env.MCP_PROVIDER_AUTH_KEY;
    } else {
      process.env.MCP_PROVIDER_AUTH_KEY = previousAuthKey;
    }
  }
});

test("vault_seed_oauth_token stores provided token hash and does not return token", async () => {
  const previousAuthKey = process.env.MCP_PROVIDER_AUTH_KEY;
  process.env.MCP_PROVIDER_AUTH_KEY = "provider-secret";

  try {
    const { ctx, mcpServer } = await createCloudMcpServer({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    const result = await mcpServer._registeredTools.vault_seed_oauth_token.handler({
      authorizationKey: "provider-secret",
      token: "oauth-access-token",
      userId: "user-1",
      scopes: "mcp:invoke",
      audience: "cloud-mcp",
    });

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.token, undefined);
    assert.equal(payload.tokenType, "oauth2");

    const stored = ctx.vault.get(["cloud-mcp", "http", "auth", "token-index"], {});
    assert.equal(typeof stored.tokens[payload.tokenHash], "object");
    assert.equal(stored.tokens[payload.tokenHash].userId, "user-1");
  } finally {
    if (previousAuthKey === undefined) {
      delete process.env.MCP_PROVIDER_AUTH_KEY;
    } else {
      process.env.MCP_PROVIDER_AUTH_KEY = previousAuthKey;
    }
  }
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
            users: [],
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

test("run_provider enforces profile users allowlist", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cloud-mcp-profile-users-"));
  const outputPath = path.join(tempDir, "profile-users-output.json");

  try {
    const { mcpServer } = await createCloudMcpServer({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    const writerProgram = [
      "const fs = require('node:fs');",
      "const outPath = process.env.TEST_PROFILE_OUTPUT_PATH;",
      "fs.writeFileSync(outPath, JSON.stringify({ ok: true }));",
    ].join("");

    await mcpServer._registeredTools.set_provider.handler({
      provider: "profileauth",
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
          restricted: {
            args: ["-e", writerProgram],
            users: ["alice", "bob"],
          },
        },
      },
    });

    await assert.rejects(
      async () =>
        mcpServer._registeredTools.run_provider.handler({
          provider: "profileauth",
          profile: "restricted",
          user: "charlie",
          args: ["noop"],
        }),
      /Unauthorized: user 'charlie' is not allowed to use profile 'restricted'/,
    );

    await mcpServer._registeredTools.run_provider.handler({
      provider: "profileauth",
      profile: "restricted",
      user: "alice",
      args: ["noop"],
    });

    const raw = await readFile(outputPath, "utf8");
    const payload = JSON.parse(raw);
    assert.equal(payload.ok, true);
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

test("command-limit admin tools require authorization key when configured", async () => {
  const previousAuthKey = process.env.MCP_PROVIDER_AUTH_KEY;
  process.env.MCP_PROVIDER_AUTH_KEY = "provider-secret";

  try {
    const tempDir = await mkdtemp(path.join(tmpdir(), "cloud-mcp-admin-auth-"));
    const targetPath = path.join(tempDir, "cloud-command-limits.json");

    try {
      const { mcpServer } = await createCloudMcpServer({
        config: "cloud-wrap.config.example.json",
        logLevel: "silent",
        commandLimitsPath: targetPath,
      });

      await assert.rejects(
        async () =>
          mcpServer._registeredTools.set_command_limit_section.handler({
            provider: "gcloud.*",
            allowedPrefixes: ["projects.list"],
            pushTarget: "internal",
          }),
        /Unauthorized: invalid authorizationKey/,
      );

      await assert.rejects(
        async () =>
          mcpServer._registeredTools.replace_command_limits.handler({
            commandLimits: {
              "aws.*": [],
              "gcp.*": ["projects.list"],
              "azure.*": [],
              "oci.*": [],
              "alibaba.*": [],
              "digitalocean.*": [],
              "ibmcloud.*": [],
              "tencent.*": [],
              "huawei.*": [],
            },
            pushTarget: "internal",
          }),
        /Unauthorized: invalid authorizationKey/,
      );

      await assert.rejects(
        async () =>
          mcpServer._registeredTools.push_command_limits.handler({
            pushTarget: "internal",
          }),
        /Unauthorized: invalid authorizationKey/,
      );

      const setSectionResult = await mcpServer._registeredTools.set_command_limit_section.handler({
        provider: "gcloud.*",
        allowedPrefixes: ["projects.list"],
        pushTarget: "internal",
        authorizationKey: "provider-secret",
      });
      const setSectionPayload = JSON.parse(setSectionResult.content[0].text);
      assert.deepEqual(setSectionPayload.limits["gcp.*"], ["projects.list"]);

      const replaceResult = await mcpServer._registeredTools.replace_command_limits.handler({
        commandLimits: {
          "aws.*": ["sts"],
          "gcp.*": [],
          "azure.*": [],
          "oci.*": [],
          "alibaba.*": [],
          "digitalocean.*": [],
          "ibmcloud.*": [],
          "tencent.*": [],
          "huawei.*": [],
        },
        pushTarget: "internal",
        authorizationKey: "provider-secret",
      });
      const replacePayload = JSON.parse(replaceResult.content[0].text);
      assert.deepEqual(replacePayload.limits["aws.*"], ["sts"]);

      const pushResult = await mcpServer._registeredTools.push_command_limits.handler({
        pushTarget: "internal",
        authorizationKey: "provider-secret",
      });
      const pushPayload = JSON.parse(pushResult.content[0].text);
      assert.equal(pushPayload.target, "internal");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  } finally {
    if (previousAuthKey === undefined) {
      delete process.env.MCP_PROVIDER_AUTH_KEY;
    } else {
      process.env.MCP_PROVIDER_AUTH_KEY = previousAuthKey;
    }
  }
});