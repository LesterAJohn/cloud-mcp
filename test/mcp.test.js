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