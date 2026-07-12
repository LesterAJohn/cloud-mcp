import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { loadCommandLimits } from "../src/config/loadCommandLimits.js";
import { assertProviderCommandAllowed, isProviderCommandAllowed } from "../src/core/commandLimits.js";

test("empty command limit section allows all commands", () => {
  const commandLimits = {
    "alibaba.*": [],
    "aws.*": [],
    "azure.*": [],
    "digitalocean.*": [],
    "gcp.*": [],
    "huawei.*": [],
    "ibmcloud.*": [],
    "oci.*": [],
    "tencent.*": [],
  };

  assert.equal(isProviderCommandAllowed("aws", ["ec2", "describe-instances"], commandLimits), true);
  assert.equal(isProviderCommandAllowed("oci", ["iam", "region", "list"], commandLimits), true);
});

test("command limits allow only matching provider-prefixed commands", () => {
  const commandLimits = {
    "alibaba.*": ["ecs"],
    "aws.*": ["aws.s3", "sts.get-caller-identity"],
    "azure.*": [],
    "digitalocean.*": ["compute"],
    "gcp.*": ["projects"],
    "huawei.*": ["ecs"],
    "ibmcloud.*": ["resource"],
    "oci.*": ["oci.iam"],
    "tencent.*": ["cvm"],
  };

  assert.equal(isProviderCommandAllowed("aws", ["s3", "ls"], commandLimits), true);
  assert.equal(isProviderCommandAllowed("aws", ["sts", "get-caller-identity"], commandLimits), true);
  assert.equal(isProviderCommandAllowed("aws", ["ec2", "describe-instances"], commandLimits), false);
  assert.equal(isProviderCommandAllowed("gcp", ["projects", "list"], commandLimits), true);
  assert.equal(isProviderCommandAllowed("oci", ["iam", "region", "list"], commandLimits), true);
});

test("assertProviderCommandAllowed throws on denied command", () => {
  const commandLimits = {
    "alibaba.*": [],
    "aws.*": ["aws.s3"],
    "azure.*": [],
    "digitalocean.*": [],
    "gcp.*": [],
    "huawei.*": [],
    "ibmcloud.*": [],
    "oci.*": [],
    "tencent.*": [],
  };

  assert.throws(
    () => assertProviderCommandAllowed("aws", ["ec2", "describe-instances"], commandLimits),
    /Command 'aws.ec2.describe-instances' is not allowed by aws\.\*/,
  );
});

test("loadCommandLimits merges defaults with JSON file", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cloud-mcp-command-limits-"));
  const filePath = path.join(tempDir, "limits.json");

  await writeFile(
    filePath,
    JSON.stringify({
      "alibaba.*": [],
      "aws.*": ["aws.s3"],
      "digitalocean.*": [],
      "gcp.*": ["projects"],
      "huawei.*": [],
      "ibmcloud.*": [],
      "tencent.*": [],
    }),
    "utf8",
  );

  const loaded = await loadCommandLimits(filePath);

  assert.deepEqual(loaded, {
    "alibaba.*": [],
    "aws.*": ["aws.s3"],
    "azure.*": [],
    "digitalocean.*": [],
    "gcp.*": ["projects"],
    "huawei.*": [],
    "ibmcloud.*": [],
    "oci.*": [],
    "tencent.*": [],
  });
});

test("loadCommandLimits maps az.* and gcloud.* aliases", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cloud-mcp-command-limits-"));
  const filePath = path.join(tempDir, "limits-aliases.json");

  await writeFile(
    filePath,
    JSON.stringify({
      "aliyun.*": ["ecs.describe-instances"],
      "aws.*": ["s3"],
      "az.*": ["account.show"],
      "doctl.*": ["compute"],
      "gcloud.*": ["projects.list"],
      "tccli.*": ["cvm.DescribeInstances"],
      "huawei.*": ["ecs list-servers"],
      "ibmcloud.*": ["resource"],
      "oci.*": ["iam.region.list"],
    }),
    "utf8",
  );

  const loaded = await loadCommandLimits(filePath);

  assert.deepEqual(loaded, {
    "alibaba.*": ["ecs.describe-instances"],
    "aws.*": ["s3"],
    "azure.*": ["account.show"],
    "digitalocean.*": ["compute"],
    "gcp.*": ["projects.list"],
    "huawei.*": ["ecs list-servers"],
    "ibmcloud.*": ["resource"],
    "oci.*": ["iam.region.list"],
    "tencent.*": ["cvm.DescribeInstances"],
  });

  assert.equal(isProviderCommandAllowed("azure", ["account", "show"], loaded), true);
  assert.equal(isProviderCommandAllowed("azure", ["group", "list"], loaded), false);
  assert.equal(isProviderCommandAllowed("gcp", ["projects", "list"], loaded), true);
  assert.equal(isProviderCommandAllowed("gcp", ["compute", "instances", "list"], loaded), false);
});

test("loadCommandLimits supports commandLimitsSource file URL", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cloud-mcp-command-limits-"));
  const filePath = path.join(tempDir, "limits-file-url.json");

  await writeFile(
    filePath,
    JSON.stringify({
      "aliyun.*": ["ecs.describe-instances"],
      "aws.*": ["s3"],
      "az.*": ["account.show"],
      "doctl.*": ["compute"],
      "gcloud.*": ["projects.list"],
      "tccli.*": ["cvm.DescribeInstances"],
      "oci.*": [],
    }),
    "utf8",
  );

  const loaded = await loadCommandLimits({
    commandLimitsSource: pathToFileURL(filePath).href,
  });

  assert.deepEqual(loaded, {
    "alibaba.*": ["ecs.describe-instances"],
    "aws.*": ["s3"],
    "azure.*": ["account.show"],
    "digitalocean.*": ["compute"],
    "gcp.*": ["projects.list"],
    "huawei.*": [],
    "ibmcloud.*": [],
    "oci.*": [],
    "tencent.*": ["cvm.DescribeInstances"],
  });
});

test("loadCommandLimits supports commandLimitsSource HTTP URL", async () => {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        "aliyun.*": ["ecs"],
        "aws.*": ["sts.get-caller-identity"],
        "doctl.*": ["compute"],
        "gcloud.*": ["projects"],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const loaded = await loadCommandLimits({
      commandLimitsSource: "https://example.com/cloud-command-limits.json",
    });

    assert.deepEqual(loaded, {
      "alibaba.*": ["ecs"],
      "aws.*": ["sts.get-caller-identity"],
      "azure.*": [],
      "digitalocean.*": ["compute"],
      "gcp.*": ["projects"],
      "huawei.*": [],
      "ibmcloud.*": [],
      "oci.*": [],
      "tencent.*": [],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});