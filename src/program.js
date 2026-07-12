import { Command } from "commander";
import { createExecutionContext } from "./core/context.js";
import { runProviderCommand } from "./core/execute.js";

const KNOWN_PROVIDERS = ["aws", "gcp", "azure", "oci"];

export function buildProgram() {
  const program = new Command();

  program
    .name("cloud-wrap")
    .description("Wrapper CLI for cloud provider CLIs")
    .version("0.1.0")
    .option("--config <path>", "path to config file", "cloud-wrap.config.json")
    .option("--log-level <level>", "logger level (fatal,error,warn,info,debug,trace)", "info");

  program
    .command("list")
    .description("list configured providers")
    .action(async () => {
      const ctx = await createExecutionContext(program.opts());
      const names = Object.keys(ctx.providers);
      names.forEach((provider) => {
        process.stdout.write(`${provider}\n`);
      });
    });

  program
    .command("run")
    .description("run a provider CLI command")
    .argument("<provider>", "provider key, e.g. aws|gcp|azure|oci")
    .argument("[args...]", "arguments passed through to provider CLI")
    .allowUnknownOption(true)
    .action(async (provider, args = []) => {
      const ctx = await createExecutionContext(program.opts());
      await runProviderCommand({
        provider,
        args,
        ctx,
      });
    });

  for (const provider of KNOWN_PROVIDERS) {
    program
      .command(provider)
      .description(`shorthand for 'run ${provider} ...'`)
      .argument("[args...]", `arguments passed through to ${provider}`)
      .allowUnknownOption(true)
      .action(async (args = []) => {
        const ctx = await createExecutionContext(program.opts());
        await runProviderCommand({
          provider,
          args,
          ctx,
        });
      });
  }

  return program;
}
