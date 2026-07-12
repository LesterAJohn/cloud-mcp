import assert from "node:assert/strict";
import test from "node:test";

import { createExecutionContext } from "../src/core/context.js";
import { createLocalVault, createVaultService } from "../src/core/vault.js";

test("local vault stores nested attributes", () => {
  const vault = createLocalVault({
    providers: {
      aws: {
        command: "aws",
      },
    },
  });

  assert.equal(vault.get(["providers", "aws", "command"]), "aws");
  vault.set(["providers", "aws", "env"], { AWS_PROFILE: "default" });
  assert.deepEqual(vault.getProvider("aws"), {
    command: "aws",
    env: {
      AWS_PROFILE: "default",
    },
  });
  assert.deepEqual(vault.list("providers"), ["aws"]);
});

test("vault service falls back when external vault is unavailable", async () => {
  const vault = await createVaultService({
    initialState: { providers: { gcp: { command: "gcloud" } } },
    moduleSpecifier: "./does-not-exist.js",
  });

  assert.equal(vault.get(["providers", "gcp", "command"]), "gcloud");
});

test("execution context forwards VAULT_ADDR and VAULT_TOKEN to external vault options", async () => {
  const previousModule = process.env.CLOUD_WRAP_VAULT_MODULE;
  const previousAddr = process.env.VAULT_ADDR;
  const previousToken = process.env.VAULT_TOKEN;

  process.env.CLOUD_WRAP_VAULT_MODULE = "./test/fixtures/external-vault.js";
  process.env.VAULT_ADDR = "https://vault.example.local:8200";
  process.env.VAULT_TOKEN = "test-token";

  try {
    const ctx = await createExecutionContext({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    assert.equal(
      ctx.vault.get(["_meta", "options", "VAULT_ADDR"]),
      "https://vault.example.local:8200",
    );
    assert.equal(ctx.vault.get(["_meta", "options", "VAULT_TOKEN"]), "test-token");
  } finally {
    if (previousModule === undefined) {
      delete process.env.CLOUD_WRAP_VAULT_MODULE;
    } else {
      process.env.CLOUD_WRAP_VAULT_MODULE = previousModule;
    }

    if (previousAddr === undefined) {
      delete process.env.VAULT_ADDR;
    } else {
      process.env.VAULT_ADDR = previousAddr;
    }

    if (previousToken === undefined) {
      delete process.env.VAULT_TOKEN;
    } else {
      process.env.VAULT_TOKEN = previousToken;
    }
  }
});

test("execution context forwards extended VAULT_* options", async () => {
  const previousModule = process.env.CLOUD_WRAP_VAULT_MODULE;
  const previousProvider = process.env.VAULT_PROVIDER;
  const previousAddr = process.env.VAULT_ADDR;
  const previousToken = process.env.VAULT_TOKEN;
  const previousNamespace = process.env.VAULT_NAMESPACE;
  const previousKvMount = process.env.VAULT_KV_MOUNT;
  const previousKvVersion = process.env.VAULT_KV_VERSION;
  const previousSecretPath = process.env.VAULT_SECRET_PATH;

  process.env.CLOUD_WRAP_VAULT_MODULE = "./test/fixtures/external-vault.js";
  process.env.VAULT_PROVIDER = "external";
  process.env.VAULT_ADDR = "https://vault.example.local:8200";
  process.env.VAULT_TOKEN = "test-token";
  process.env.VAULT_NAMESPACE = "team-a";
  process.env.VAULT_KV_MOUNT = "secret";
  process.env.VAULT_KV_VERSION = "2";
  process.env.VAULT_SECRET_PATH = "cloud-wrap/providers";

  try {
    const ctx = await createExecutionContext({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    assert.equal(ctx.vault.get(["_meta", "options", "VAULT_PROVIDER"]), "external");
    assert.equal(ctx.vault.get(["_meta", "options", "VAULT_ADDR"]), "https://vault.example.local:8200");
    assert.equal(ctx.vault.get(["_meta", "options", "VAULT_TOKEN"]), "test-token");
    assert.equal(ctx.vault.get(["_meta", "options", "VAULT_NAMESPACE"]), "team-a");
    assert.equal(ctx.vault.get(["_meta", "options", "VAULT_KV_MOUNT"]), "secret");
    assert.equal(ctx.vault.get(["_meta", "options", "VAULT_KV_VERSION"]), "2");
    assert.equal(ctx.vault.get(["_meta", "options", "VAULT_SECRET_PATH"]), "cloud-wrap/providers");
  } finally {
    if (previousModule === undefined) {
      delete process.env.CLOUD_WRAP_VAULT_MODULE;
    } else {
      process.env.CLOUD_WRAP_VAULT_MODULE = previousModule;
    }

    if (previousProvider === undefined) {
      delete process.env.VAULT_PROVIDER;
    } else {
      process.env.VAULT_PROVIDER = previousProvider;
    }

    if (previousAddr === undefined) {
      delete process.env.VAULT_ADDR;
    } else {
      process.env.VAULT_ADDR = previousAddr;
    }

    if (previousToken === undefined) {
      delete process.env.VAULT_TOKEN;
    } else {
      process.env.VAULT_TOKEN = previousToken;
    }

    if (previousNamespace === undefined) {
      delete process.env.VAULT_NAMESPACE;
    } else {
      process.env.VAULT_NAMESPACE = previousNamespace;
    }

    if (previousKvMount === undefined) {
      delete process.env.VAULT_KV_MOUNT;
    } else {
      process.env.VAULT_KV_MOUNT = previousKvMount;
    }

    if (previousKvVersion === undefined) {
      delete process.env.VAULT_KV_VERSION;
    } else {
      process.env.VAULT_KV_VERSION = previousKvVersion;
    }

    if (previousSecretPath === undefined) {
      delete process.env.VAULT_SECRET_PATH;
    } else {
      process.env.VAULT_SECRET_PATH = previousSecretPath;
    }
  }
});

test("auto-selects built-in external vault module from VAULT_PROVIDER", async () => {
  const previousModule = process.env.CLOUD_WRAP_VAULT_MODULE;
  const previousProvider = process.env.VAULT_PROVIDER;
  const previousAddr = process.env.VAULT_ADDR;
  const previousToken = process.env.VAULT_TOKEN;
  const previousNamespace = process.env.VAULT_NAMESPACE;
  const previousFetch = globalThis.fetch;

  process.env.VAULT_PROVIDER = "external";
  process.env.VAULT_ADDR = "http://vault.mock:8200";
  process.env.VAULT_TOKEN = "mock-token";
  process.env.VAULT_NAMESPACE = "engineering";
  delete process.env.CLOUD_WRAP_VAULT_MODULE;

  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });

    if (init.method === "GET" && String(url).endsWith("/secret/data/cloud-mcp/providers/aws")) {
      return new Response(
        JSON.stringify({
          data: {
            data: {
              provider: {
                command: "aws-from-external-vault",
                env: {},
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (init.method === "GET") {
      return new Response("", { status: 404 });
    }

    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const ctx = await createExecutionContext({
      config: "cloud-wrap.config.example.json",
      logLevel: "silent",
    });

    assert.equal(ctx.providers.aws.command, "aws-from-external-vault");
    assert.equal(calls.length > 0, true);
    const readPaths = calls
      .filter((call) => call.init.method === "GET")
      .map((call) => call.url)
      .sort();

    assert.deepEqual(readPaths, [
      "http://vault.mock:8200/v1/secret/data/cloud-mcp/providers/aws",
      "http://vault.mock:8200/v1/secret/data/cloud-mcp/providers/azure",
      "http://vault.mock:8200/v1/secret/data/cloud-mcp/providers/gcp",
      "http://vault.mock:8200/v1/secret/data/cloud-mcp/providers/oci",
    ]);

    const firstHeaders = calls[0].init.headers;
    assert.equal(firstHeaders["X-Vault-Token"], "mock-token");
    assert.equal(firstHeaders["X-Vault-Namespace"], "engineering");

    const writePaths = calls
      .filter((call) => call.init.method === "POST")
      .map((call) => call.url)
      .sort();
    assert.deepEqual(writePaths, [
      "http://vault.mock:8200/v1/secret/data/cloud-mcp/providers/aws",
      "http://vault.mock:8200/v1/secret/data/cloud-mcp/providers/azure",
      "http://vault.mock:8200/v1/secret/data/cloud-mcp/providers/gcp",
      "http://vault.mock:8200/v1/secret/data/cloud-mcp/providers/oci",
    ]);

    const headers = calls.find((call) => call.init.method === "POST").init.headers;
    assert.equal(headers["X-Vault-Token"], "mock-token");
    assert.equal(headers["X-Vault-Namespace"], "engineering");
  } finally {
    globalThis.fetch = previousFetch;

    if (previousModule === undefined) {
      delete process.env.CLOUD_WRAP_VAULT_MODULE;
    } else {
      process.env.CLOUD_WRAP_VAULT_MODULE = previousModule;
    }

    if (previousProvider === undefined) {
      delete process.env.VAULT_PROVIDER;
    } else {
      process.env.VAULT_PROVIDER = previousProvider;
    }

    if (previousAddr === undefined) {
      delete process.env.VAULT_ADDR;
    } else {
      process.env.VAULT_ADDR = previousAddr;
    }

    if (previousToken === undefined) {
      delete process.env.VAULT_TOKEN;
    } else {
      process.env.VAULT_TOKEN = previousToken;
    }

    if (previousNamespace === undefined) {
      delete process.env.VAULT_NAMESPACE;
    } else {
      process.env.VAULT_NAMESPACE = previousNamespace;
    }
  }
});