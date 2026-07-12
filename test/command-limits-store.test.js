import assert from "node:assert/strict";
import test from "node:test";

import { createCommandLimitsStore } from "../src/db/commandLimitsStore.js";

test("command limits store uses in-memory mode without database URL", async () => {
  const previousCommandLimitsDb = process.env.COMMAND_LIMITS_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousLocalEnabled = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
  const previousLocalPort = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;

  delete process.env.COMMAND_LIMITS_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
  delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;

  try {
    const store = createCommandLimitsStore();
    assert.equal(store.mode, "memory");

    await store.initialize();
    await store.sync({
      "aws.*": ["s3"],
      "gcp.*": ["projects"],
      "azure.*": [],
      "oci.*": ["iam"],
      "alibaba.*": ["ecs"],
      "digitalocean.*": [],
      "ibmcloud.*": ["resource"],
      "tencent.*": [],
      "huawei.*": ["ecs"],
    });

    const loaded = await store.getAll();
    assert.deepEqual(loaded, {
      "aws.*": ["s3"],
      "gcp.*": ["projects"],
      "azure.*": [],
      "oci.*": ["iam"],
      "alibaba.*": ["ecs"],
      "digitalocean.*": [],
      "ibmcloud.*": ["resource"],
      "tencent.*": [],
      "huawei.*": ["ecs"],
    });
  } finally {
    if (previousCommandLimitsDb === undefined) {
      delete process.env.COMMAND_LIMITS_DATABASE_URL;
    } else {
      process.env.COMMAND_LIMITS_DATABASE_URL = previousCommandLimitsDb;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    if (previousLocalEnabled === undefined) {
      delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
    } else {
      process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED = previousLocalEnabled;
    }

    if (previousLocalPort === undefined) {
      delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;
    } else {
      process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT = previousLocalPort;
    }
  }
});

test("command limits store auto-enables local postgres when enabled with port", () => {
  const previousCommandLimitsDb = process.env.COMMAND_LIMITS_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousLocalEnabled = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
  const previousLocalPort = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;

  delete process.env.COMMAND_LIMITS_DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED = "true";
  process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT = "55432";

  try {
    const store = createCommandLimitsStore();
    assert.equal(store.mode, "postgres");
  } finally {
    if (previousCommandLimitsDb === undefined) {
      delete process.env.COMMAND_LIMITS_DATABASE_URL;
    } else {
      process.env.COMMAND_LIMITS_DATABASE_URL = previousCommandLimitsDb;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    if (previousLocalEnabled === undefined) {
      delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
    } else {
      process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED = previousLocalEnabled;
    }

    if (previousLocalPort === undefined) {
      delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;
    } else {
      process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT = previousLocalPort;
    }
  }
});

test("command limits store requires local postgres port when local postgres is enabled", () => {
  const previousCommandLimitsDb = process.env.COMMAND_LIMITS_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousLocalEnabled = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
  const previousLocalPort = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;

  delete process.env.COMMAND_LIMITS_DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED = "true";
  delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;

  try {
    assert.throws(
      () => createCommandLimitsStore(),
      /COMMAND_LIMITS_LOCAL_POSTGRES_PORT is required when COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED is enabled/,
    );
  } finally {
    if (previousCommandLimitsDb === undefined) {
      delete process.env.COMMAND_LIMITS_DATABASE_URL;
    } else {
      process.env.COMMAND_LIMITS_DATABASE_URL = previousCommandLimitsDb;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    if (previousLocalEnabled === undefined) {
      delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
    } else {
      process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED = previousLocalEnabled;
    }

    if (previousLocalPort === undefined) {
      delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;
    } else {
      process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT = previousLocalPort;
    }
  }
});

test("external database URL disables local postgres auto-mode", () => {
  const previousCommandLimitsDb = process.env.COMMAND_LIMITS_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousLocalEnabled = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
  const previousLocalPort = process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;

  process.env.COMMAND_LIMITS_DATABASE_URL = "postgres://external/db";
  process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED = "true";
  delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;
  delete process.env.DATABASE_URL;

  try {
    const store = createCommandLimitsStore();
    assert.equal(store.mode, "postgres");
  } finally {
    if (previousCommandLimitsDb === undefined) {
      delete process.env.COMMAND_LIMITS_DATABASE_URL;
    } else {
      process.env.COMMAND_LIMITS_DATABASE_URL = previousCommandLimitsDb;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    if (previousLocalEnabled === undefined) {
      delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED;
    } else {
      process.env.COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED = previousLocalEnabled;
    }

    if (previousLocalPort === undefined) {
      delete process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT;
    } else {
      process.env.COMMAND_LIMITS_LOCAL_POSTGRES_PORT = previousLocalPort;
    }
  }
});