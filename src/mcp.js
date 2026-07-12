#!/usr/bin/env node

import { runCloudMcpServer } from "./core/mcp.js";

async function main() {
  const args = process.argv.slice(2);
  const options = {
    config: "cloud-wrap.config.json",
    logLevel: "info",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--config") {
      options.config = args[index + 1];
      index += 1;
    } else if (arg === "--log-level") {
      options.logLevel = args[index + 1];
      index += 1;
    }
  }

  await runCloudMcpServer(options);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`cloud-mcp failed: ${message}`);
  process.exitCode = 1;
});