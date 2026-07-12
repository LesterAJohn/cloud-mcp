import { execa } from "execa";
import { assertProviderCommandAllowed } from "./commandLimits.js";

function resolveExecutionUser(explicitUser) {
  if (typeof explicitUser === "string" && explicitUser.trim().length > 0) {
    return explicitUser.trim();
  }

  for (const candidate of [process.env.CLOUD_MCP_USER, process.env.MCP_USER, process.env.USER]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function assertProfileUserAuthorized({ provider, profile, profileConfig, executionUser }) {
  const allowedUsers = Array.isArray(profileConfig?.users)
    ? profileConfig.users.filter((user) => typeof user === "string" && user.trim().length > 0)
    : [];

  if (allowedUsers.length === 0) {
    return;
  }

  if (!executionUser || !allowedUsers.includes(executionUser)) {
    throw new Error(
      `Unauthorized: user '${executionUser ?? "unknown"}' is not allowed to use profile '${profile}' for provider '${provider}'`,
    );
  }
}

function resolveProviderExecution(provider, providerConfig, requestedArgs, selectedProfile, selectedUser) {
  const args = Array.isArray(requestedArgs) ? [...requestedArgs] : [];
  const profile = selectedProfile ?? providerConfig.defaultProfile;
  const profiles = providerConfig.profiles ?? {};
  const profileConfig = profile ? profiles[profile] : undefined;
  const executionUser = resolveExecutionUser(selectedUser);

  if (profile && profileConfig) {
    assertProfileUserAuthorized({
      provider,
      profile,
      profileConfig,
      executionUser,
    });
  }

  const env = {
    ...(providerConfig.env ?? {}),
    ...(profileConfig?.env ?? {}),
  };

  let finalArgs = [...(Array.isArray(profileConfig?.args) ? profileConfig.args : []), ...args];

  if (profile) {
    const profileSupport = providerConfig.profileSupport;
    if (!profileSupport) {
      throw new Error(`Provider does not define profileSupport, but profile '${profile}' was requested`);
    }

    if (profileSupport.mode === "arg") {
      const flag = profileSupport.flag ?? "--profile";
      finalArgs = [flag, profile, ...finalArgs];
    }

    if (profileSupport.mode === "env") {
      const envVar = profileSupport.envVar;
      if (!envVar) {
        throw new Error("Provider profileSupport mode 'env' requires envVar");
      }

      env[envVar] = profile;
    }
  }

  return {
    env,
    finalArgs,
    profile,
    user: executionUser,
  };
}

export async function runProviderCommand({ provider, args, profile, user, ctx, stdio = "inherit" }) {
  const providerConfig = ctx.vault.get(["providers", provider], ctx.providers[provider]);

  if (!providerConfig) {
    const knownProviders = Object.keys(ctx.vault.get(["providers"], ctx.providers) ?? {}).join(", ");
    throw new Error(`Unknown provider '${provider}'. Known providers: ${knownProviders}`);
  }

  const command = providerConfig.command;
  const execution = resolveProviderExecution(provider, providerConfig, args, profile, user);
  const mergedEnv = {
    ...process.env,
    ...execution.env,
  };

  const commandLimits = await ctx.commandLimitsStore.getAll();
  assertProviderCommandAllowed(provider, execution.finalArgs, commandLimits);

  ctx.logger.debug(
    { provider, command, args: execution.finalArgs, profile: execution.profile, user: execution.user },
    "spawning provider command",
  );

  if (stdio === "inherit") {
    await execa(command, execution.finalArgs, {
      env: mergedEnv,
      stdio: "inherit",
      preferLocal: false,
    });

    return null;
  }

  const result = await execa(command, execution.finalArgs, {
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
