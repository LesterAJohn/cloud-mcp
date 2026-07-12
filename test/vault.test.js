import assert from "node:assert/strict";
import test from "node:test";

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