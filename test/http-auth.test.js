import assert from "node:assert/strict";
import test from "node:test";

import {
  UnauthorizedError,
  createBearerTokenVerifier,
  createOAuth2IntrospectionVerifier,
  createRequestAuthenticator,
  createVaultTokenVerifier,
  extractBearerToken,
  parseHttpAuthConfig,
} from "../src/http/auth.js";
import { createHash } from "node:crypto";

test("extractBearerToken returns token for Bearer header", () => {
  const token = extractBearerToken({
    headers: {
      authorization: "Bearer test-token",
    },
  });

  assert.equal(token, "test-token");
});

test("token auth mode accepts configured bearer token", async () => {
  const authenticator = createRequestAuthenticator({
    authMode: "token",
    bearerVerifier: createBearerTokenVerifier({ tokens: ["alpha", "beta"] }),
  });

  const auth = await authenticator({
    headers: {
      authorization: "Bearer alpha",
    },
  });

  assert.equal(auth.type, "token");
});

test("token auth mode rejects invalid bearer token", async () => {
  const authenticator = createRequestAuthenticator({
    authMode: "token",
    bearerVerifier: createBearerTokenVerifier({ tokens: ["alpha"] }),
  });

  await assert.rejects(
    async () =>
      authenticator({
        headers: {
          authorization: "Bearer nope",
        },
      }),
    UnauthorizedError,
  );
});

test("oauth verifier enforces required scopes and audience", async () => {
  const previousFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return {
          active: true,
          sub: "user-1",
          scope: "mcp:invoke mcp:read",
          aud: ["cloud-mcp"],
        };
      },
      async text() {
        return "";
      },
    });

    const verifier = createOAuth2IntrospectionVerifier({
      introspectionUrl: "https://auth.example.com/introspect",
      requiredScopes: ["mcp:invoke"],
      requiredAudience: ["cloud-mcp"],
      cacheTtlMs: 1000,
    });

    const auth = await verifier.verify("oauth-token");
    assert.equal(auth.type, "oauth2");
    assert.equal(auth.sub, "user-1");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("vault token verifier accepts active hashed token entry", async () => {
  const token = "vault-token-1";
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const verifier = createVaultTokenVerifier({
    vault: {
      get(path, defaultValue) {
        if (Array.isArray(path) && path.join("/") === "cloud-mcp/http/auth/token-index") {
          return {
            tokens: {
              [tokenHash]: {
                active: true,
                userId: "u1",
                tokenId: "tok-1",
                scopes: ["mcp:invoke"],
                audience: ["cloud-mcp"],
              },
            },
          };
        }

        return defaultValue;
      },
    },
    requiredScopes: ["mcp:invoke"],
    requiredAudience: ["cloud-mcp"],
  });

  const auth = await verifier.verify(token);
  assert.equal(auth.type, "token");
  assert.equal(auth.source, "vault");
  assert.equal(auth.userId, "u1");
  assert.equal(auth.tokenId, "tok-1");
});

test("vault token verifier rejects inactive token", async () => {
  const token = "vault-token-inactive";
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const verifier = createVaultTokenVerifier({
    vault: {
      get() {
        return {
          tokens: {
            [tokenHash]: {
              active: false,
            },
          },
        };
      },
    },
  });

  const auth = await verifier.verify(token);
  assert.equal(auth, null);
});

test("parseHttpAuthConfig builds vault token verifier when MCP_HTTP_TOKEN_SOURCE=vault", async () => {
  const token = "vault-token-source";
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { tokenSource, authenticator } = parseHttpAuthConfig({
    authMode: "token",
    tokenSource: "vault",
    vault: {
      get() {
        return {
          tokens: {
            [tokenHash]: {
              active: true,
              userId: "default",
            },
          },
        };
      },
    },
  });

  assert.equal(tokenSource, "vault");

  const auth = await authenticator({
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(auth.type, "token");
  assert.equal(auth.source, "vault");
});
