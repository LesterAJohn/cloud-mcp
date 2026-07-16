import { createHash } from "node:crypto";

function splitCsv(input) {
  return String(input ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function normalizeAuthMode(mode) {
  const normalized = String(mode ?? "none").trim().toLowerCase();
  if (["none", "token", "oauth2", "both"].includes(normalized)) {
    return normalized;
  }

  throw new Error("MCP_HTTP_AUTH_MODE must be one of: none, token, oauth2, both");
}

function parseAudience(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
  }

  if (typeof value === "string") {
    return splitCsv(value);
  }

  return [];
}

function parseScopes(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
  }

  if (typeof value === "string") {
    return value
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

function hasAllRequired(values, required) {
  if (required.length === 0) {
    return true;
  }

  const valueSet = new Set(values);
  return required.every((item) => valueSet.has(item));
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function extractBearerToken(req) {
  const header = req.headers?.authorization;
  if (!header || Array.isArray(header)) {
    return null;
  }

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

export function createBearerTokenVerifier(input = {}) {
  const tokens = Array.isArray(input.tokens) ? input.tokens : splitCsv(input.tokens);
  const allowedTokens = new Set(tokens.filter((token) => typeof token === "string" && token.trim().length > 0));

  return {
    async verify(token) {
      if (!token || !allowedTokens.has(token)) {
        return null;
      }

      return {
        type: "token",
      };
    },
  };
}

function normalizeTokenSource(source) {
  const normalized = String(source ?? "env").trim().toLowerCase();
  if (["env", "vault"].includes(normalized)) {
    return normalized;
  }

  throw new Error("MCP_HTTP_TOKEN_SOURCE must be one of: env, vault");
}

function parsePathSegments(pathValue, fallbackPath) {
  const value = String(pathValue ?? fallbackPath)
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return value.split("/").filter((segment) => segment.length > 0);
}

function isExpired(expiresAt) {
  if (!expiresAt) {
    return false;
  }

  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() <= Date.now();
}

function findTokenRecord(indexDocument, tokenHash, defaultUserId) {
  if (!indexDocument || typeof indexDocument !== "object") {
    return null;
  }

  if (indexDocument.tokens && typeof indexDocument.tokens === "object") {
    const tokenRecord = indexDocument.tokens[tokenHash];
    if (tokenRecord && typeof tokenRecord === "object") {
      return {
        userId: tokenRecord.userId ?? defaultUserId,
        record: tokenRecord,
      };
    }
  }

  if (indexDocument.users && typeof indexDocument.users === "object") {
    if (defaultUserId) {
      const defaultToken = indexDocument.users?.[defaultUserId]?.tokens?.[tokenHash];
      if (defaultToken && typeof defaultToken === "object") {
        return {
          userId: defaultUserId,
          record: defaultToken,
        };
      }
    }

    for (const [userId, userEntry] of Object.entries(indexDocument.users)) {
      const tokenRecord = userEntry?.tokens?.[tokenHash];
      if (tokenRecord && typeof tokenRecord === "object") {
        return {
          userId,
          record: tokenRecord,
        };
      }
    }
  }

  const topLevelRecord = indexDocument[tokenHash];
  if (topLevelRecord && typeof topLevelRecord === "object") {
    return {
      userId: topLevelRecord.userId ?? defaultUserId,
      record: topLevelRecord,
    };
  }

  return null;
}

export function createVaultTokenVerifier(input = {}) {
  const vault = input.vault;
  if (!vault || typeof vault.get !== "function") {
    throw new Error("vault service is required when MCP_HTTP_TOKEN_SOURCE=vault");
  }

  const tokenIndexPath = parsePathSegments(input.tokenIndexPath, "cloud-mcp/http/auth/token-index");
  const requiredScopes = Array.isArray(input.requiredScopes) ? input.requiredScopes : splitCsv(input.requiredScopes);
  const requiredAudience = Array.isArray(input.requiredAudience)
    ? input.requiredAudience
    : splitCsv(input.requiredAudience);
  const defaultUserId = String(input.defaultUserId ?? "default").trim() || "default";
  const cacheTtlMs = Number.parseInt(String(input.cacheTtlMs ?? 15_000), 10);

  const tokenCache = new Map();

  return {
    async verify(token) {
      if (!token || typeof token !== "string") {
        return null;
      }

      const now = Date.now();
      const cached = tokenCache.get(token);
      if (cached && cached.expiresAt > now) {
        return cached.result;
      }

      const tokenHash = createHash("sha256").update(token).digest("hex");
      const indexDocument = vault.get(tokenIndexPath, null);
      const located = findTokenRecord(indexDocument, tokenHash, defaultUserId);

      if (!located || !located.record) {
        tokenCache.set(token, { result: null, expiresAt: now + Math.max(cacheTtlMs, 1000) });
        return null;
      }

      const record = located.record;
      if (record.active === false || isExpired(record.expiresAt)) {
        tokenCache.set(token, { result: null, expiresAt: now + Math.max(cacheTtlMs, 1000) });
        return null;
      }

      const scopes = parseScopes(record.scope ?? record.scopes);
      const audience = parseAudience(record.aud ?? record.audience);

      if (!hasAllRequired(scopes, requiredScopes)) {
        tokenCache.set(token, { result: null, expiresAt: now + Math.max(cacheTtlMs, 1000) });
        return null;
      }

      if (!hasAllRequired(audience, requiredAudience)) {
        tokenCache.set(token, { result: null, expiresAt: now + Math.max(cacheTtlMs, 1000) });
        return null;
      }

      const result = {
        type: "token",
        source: "vault",
        userId: located.userId ?? defaultUserId,
        tokenId: record.tokenId ?? null,
        scope: scopes,
        audience,
      };

      tokenCache.set(token, {
        result,
        expiresAt: now + Math.max(cacheTtlMs, 1000),
      });

      return result;
    },
  };
}

export function createOAuth2IntrospectionVerifier(input = {}) {
  const introspectionUrl = String(input.introspectionUrl ?? "").trim();
  if (!introspectionUrl) {
    throw new Error("MCP_HTTP_OAUTH2_INTROSPECTION_URL is required when MCP_HTTP_AUTH_MODE is oauth2 or both");
  }

  const clientId = String(input.clientId ?? "").trim();
  const clientSecret = String(input.clientSecret ?? "").trim();
  const timeoutMs = Number.parseInt(String(input.timeoutMs ?? 5000), 10);
  const cacheTtlMs = Number.parseInt(String(input.cacheTtlMs ?? 30_000), 10);
  const requiredScopes = Array.isArray(input.requiredScopes) ? input.requiredScopes : splitCsv(input.requiredScopes);
  const requiredAudience = Array.isArray(input.requiredAudience)
    ? input.requiredAudience
    : splitCsv(input.requiredAudience);

  const tokenCache = new Map();

  return {
    async verify(token) {
      const now = Date.now();
      const cached = tokenCache.get(token);
      if (cached && cached.expiresAt > now) {
        return cached.result;
      }

      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
      };

      const body = new URLSearchParams({ token });
      if (clientId && clientSecret) {
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        headers.authorization = `Basic ${credentials}`;
      } else if (clientId) {
        body.set("client_id", clientId);
      }

      const response = await fetch(introspectionUrl, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`OAuth introspection failed: ${response.status} ${message || response.statusText}`);
      }

      const payload = await response.json();
      if (!payload?.active) {
        tokenCache.set(token, { result: null, expiresAt: now + Math.max(cacheTtlMs, 1000) });
        return null;
      }

      const tokenScopes = parseScopes(payload.scope ?? payload.scopes);
      const tokenAudience = parseAudience(payload.aud ?? payload.audience);

      if (!hasAllRequired(tokenScopes, requiredScopes)) {
        tokenCache.set(token, { result: null, expiresAt: now + Math.max(cacheTtlMs, 1000) });
        return null;
      }

      if (!hasAllRequired(tokenAudience, requiredAudience)) {
        tokenCache.set(token, { result: null, expiresAt: now + Math.max(cacheTtlMs, 1000) });
        return null;
      }

      const result = {
        type: "oauth2",
        sub: payload.sub ?? null,
        scope: tokenScopes,
        audience: tokenAudience,
        payload,
      };

      tokenCache.set(token, {
        result,
        expiresAt: now + Math.max(cacheTtlMs, 1000),
      });

      return result;
    },
  };
}

export function createRequestAuthenticator(input = {}) {
  const authMode = normalizeAuthMode(input.authMode);
  if (authMode === "none") {
    return async () => ({ type: "none" });
  }

  const bearerVerifier = input.bearerVerifier;
  const oauth2Verifier = input.oauth2Verifier;

  if ((authMode === "token" || authMode === "both") && !bearerVerifier) {
    throw new Error("Bearer verifier is required when MCP_HTTP_AUTH_MODE is token or both");
  }

  if ((authMode === "oauth2" || authMode === "both") && !oauth2Verifier) {
    throw new Error("OAuth2 verifier is required when MCP_HTTP_AUTH_MODE is oauth2 or both");
  }

  return async (req) => {
    const token = extractBearerToken(req);
    if (!token) {
      throw new UnauthorizedError("Missing bearer token");
    }

    if (authMode === "token") {
      const auth = await bearerVerifier.verify(token);
      if (!auth) {
        throw new UnauthorizedError("Invalid bearer token");
      }

      return auth;
    }

    if (authMode === "oauth2") {
      const auth = await oauth2Verifier.verify(token);
      if (!auth) {
        throw new UnauthorizedError("OAuth token rejected");
      }

      return auth;
    }

    const [bearerAuth, oauthAuth] = await Promise.all([
      bearerVerifier.verify(token),
      oauth2Verifier.verify(token),
    ]);

    if (bearerAuth) {
      return bearerAuth;
    }

    if (oauthAuth) {
      return oauthAuth;
    }

    throw new UnauthorizedError("Token did not pass any configured authentication method");
  };
}

export function parseHttpAuthConfig(options = {}) {
  const authMode = normalizeAuthMode(options.authMode ?? process.env.MCP_HTTP_AUTH_MODE ?? "none");
  const tokenSource = normalizeTokenSource(options.tokenSource ?? process.env.MCP_HTTP_TOKEN_SOURCE ?? "env");

  const authTokens = options.authTokens ?? process.env.MCP_HTTP_AUTH_TOKENS ?? "";
  const vaultTokenConfig = {
    vault: options.vault,
    tokenIndexPath: options.vaultTokenIndexPath ?? process.env.MCP_HTTP_VAULT_TOKEN_INDEX_PATH,
    defaultUserId: options.vaultTokenDefaultUserId ?? process.env.MCP_HTTP_VAULT_TOKEN_DEFAULT_USER_ID,
    requiredScopes:
      options.vaultTokenRequiredScopes ??
      process.env.MCP_HTTP_VAULT_TOKEN_REQUIRED_SCOPES ??
      options.oauthRequiredScopes ??
      process.env.MCP_HTTP_OAUTH2_REQUIRED_SCOPES,
    requiredAudience:
      options.vaultTokenRequiredAudience ??
      process.env.MCP_HTTP_VAULT_TOKEN_REQUIRED_AUDIENCE ??
      options.oauthRequiredAudience ??
      process.env.MCP_HTTP_OAUTH2_REQUIRED_AUDIENCE,
    cacheTtlMs: options.vaultTokenCacheTtlMs ?? process.env.MCP_HTTP_VAULT_TOKEN_CACHE_TTL_MS,
  };
  const oauthConfig = {
    introspectionUrl: options.oauthIntrospectionUrl ?? process.env.MCP_HTTP_OAUTH2_INTROSPECTION_URL,
    clientId: options.oauthClientId ?? process.env.MCP_HTTP_OAUTH2_CLIENT_ID,
    clientSecret: options.oauthClientSecret ?? process.env.MCP_HTTP_OAUTH2_CLIENT_SECRET,
    requiredScopes: options.oauthRequiredScopes ?? process.env.MCP_HTTP_OAUTH2_REQUIRED_SCOPES,
    requiredAudience: options.oauthRequiredAudience ?? process.env.MCP_HTTP_OAUTH2_REQUIRED_AUDIENCE,
    timeoutMs: options.oauthTimeoutMs ?? process.env.MCP_HTTP_OAUTH2_TIMEOUT_MS,
    cacheTtlMs: options.oauthCacheTtlMs ?? process.env.MCP_HTTP_OAUTH2_CACHE_TTL_MS,
  };

  let bearerVerifier = null;
  if (authMode === "token" || authMode === "both") {
    bearerVerifier =
      tokenSource === "vault" ? createVaultTokenVerifier(vaultTokenConfig) : createBearerTokenVerifier({ tokens: authTokens });
  }

  const oauth2Verifier =
    authMode === "oauth2" || authMode === "both" ? createOAuth2IntrospectionVerifier(oauthConfig) : null;

  return {
    authMode,
    tokenSource,
    authenticator: createRequestAuthenticator({
      authMode,
      bearerVerifier,
      oauth2Verifier,
    }),
  };
}
