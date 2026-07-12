#!/usr/bin/env node

import { buildProgram } from "./program.js";

async function main() {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`cloud-wrap failed: ${message}`);
  process.exitCode = 1;
});
