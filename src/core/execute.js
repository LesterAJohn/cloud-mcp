import { execa } from "execa";

export async function runProviderCommand({ provider, args, ctx, stdio = "inherit" }) {
  const providerConfig = ctx.vault.get(["providers", provider], ctx.providers[provider]);

  if (!providerConfig) {
    const knownProviders = Object.keys(ctx.vault.get(["providers"], ctx.providers) ?? {}).join(", ");
    throw new Error(`Unknown provider '${provider}'. Known providers: ${knownProviders}`);
  }

  const command = providerConfig.command;
  const mergedEnv = {
    ...process.env,
    ...providerConfig.env,
  };

  ctx.logger.debug({ provider, command, args }, "spawning provider command");

  if (stdio === "inherit") {
    await execa(command, args, {
      env: mergedEnv,
      stdio: "inherit",
      preferLocal: false,
    });

    return null;
  }

  const result = await execa(command, args, {
    env: mergedEnv,
    preferLocal: false,
    reject: false,
    all: true,
  });

  if (result.exitCode !== 0) {
    const errorOutput = (result.all ?? result.stderr ?? "").trim();
    throw new Error(errorOutput || `Command failed with exit code ${result.exitCode}`);
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    all: result.all ?? result.stdout ?? "",
    exitCode: result.exitCode ?? 0,
  };
}
