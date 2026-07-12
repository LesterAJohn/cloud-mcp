function buildRequestedCommand(provider, args) {
  if (!Array.isArray(args) || args.length === 0) {
    return provider;
  }

  const normalizedSegments = args
    .filter((segment) => typeof segment === "string" && segment.length > 0)
    .map((segment) => segment.replace(/\s+/g, "-"));

  return [provider, ...normalizedSegments].join(".");
}

function normalizeAllowedPrefix(provider, prefix) {
  if (typeof prefix !== "string") {
    return "";
  }

  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return "";
  }

  return trimmed.startsWith(`${provider}.`) || trimmed === provider ? trimmed : `${provider}.${trimmed}`;
}

export function isProviderCommandAllowed(provider, args, commandLimits) {
  const sectionKey = `${provider}.*`;
  const allowedPrefixes = commandLimits?.[sectionKey] ?? [];

  if (allowedPrefixes.length === 0) {
    return true;
  }

  const requestedCommand = buildRequestedCommand(provider, args);
  return allowedPrefixes.some((prefix) => {
    const normalizedPrefix = normalizeAllowedPrefix(provider, prefix);
    return requestedCommand === normalizedPrefix || requestedCommand.startsWith(`${normalizedPrefix}.`);
  });
}

export function assertProviderCommandAllowed(provider, args, commandLimits) {
  if (isProviderCommandAllowed(provider, args, commandLimits)) {
    return;
  }

  const requestedCommand = buildRequestedCommand(provider, args);
  const sectionKey = `${provider}.*`;
  const allowedPrefixes = commandLimits?.[sectionKey] ?? [];
  throw new Error(
    `Command '${requestedCommand}' is not allowed by ${sectionKey}. Allowed prefixes: ${allowedPrefixes.join(", ")}`,
  );
}