import { createHash, randomBytes } from "node:crypto";

function asArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

export function normalizeTokenIndexPath(path) {
  const raw = String(path ?? process.env.MCP_HTTP_VAULT_TOKEN_INDEX_PATH ?? "cloud-mcp/http/auth/token-index")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return raw;
}

export function tokenIndexPathToVaultPath(path) {
  return normalizeTokenIndexPath(path)
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function createBearerToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function createVaultTokenEntry({
  token,
  userId,
  tokenId,
  scopes,
  audience,
  expiresAt,
  tokenType = "bearer",
}) {
  const normalizedUserId = String(userId ?? process.env.MCP_HTTP_VAULT_TOKEN_DEFAULT_USER_ID ?? "default").trim() || "default";
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedToken) {
    throw new Error("token is required");
  }

  const tokenHash = createHash("sha256").update(normalizedToken).digest("hex");
  const entry = {
    userId: normalizedUserId,
    tokenId: String(tokenId ?? `tok-${Date.now()}`),
    tokenType,
    active: true,
    scopes: asArray(scopes),
    audience: asArray(audience),
  };

  if (expiresAt) {
    entry.expiresAt = String(expiresAt);
  }

  return {
    tokenHash,
    entry,
  };
}

export function mergeVaultTokenIndex(existingPayload, { tokenHash, entry }) {
  const base =
    existingPayload && typeof existingPayload === "object" && !Array.isArray(existingPayload) ? existingPayload : {};

  return {
    ...base,
    tokens: {
      ...(base.tokens && typeof base.tokens === "object" ? base.tokens : {}),
      [tokenHash]: {
        ...(base.tokens?.[tokenHash] && typeof base.tokens[tokenHash] === "object" ? base.tokens[tokenHash] : {}),
        ...entry,
      },
    },
  };
}
