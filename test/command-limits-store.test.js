import assert from "node:assert/strict";
import test from "node:test";

import { createCommandLimitsStore } from "../src/db/commandLimitsStore.js";

test("command limits store uses in-memory mode without database URL", async () => {
  const previousCommandLimitsDb = process.env.COMMAND_LIMITS_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  delete process.env.COMMAND_LIMITS_DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    const store = createCommandLimitsStore();
    assert.equal(store.mode, "memory");

    await store.initialize();
    await store.sync({
      "aws.*": ["s3"],
      "gcp.*": ["projects"],
      "azure.*": [],
      "oci.*": ["iam"],
    });

    const loaded = await store.getAll();
    assert.deepEqual(loaded, {
      "aws.*": ["s3"],
      "gcp.*": ["projects"],
      "azure.*": [],
      "oci.*": ["iam"],
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
  }
});