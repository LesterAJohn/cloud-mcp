import assert from "node:assert/strict";
import test from "node:test";

import {
  UnauthorizedError,
  createBearerTokenVerifier,
  createOAuth2IntrospectionVerifier,
  createRequestAuthenticator,
  extractBearerToken,
} from "../src/http/auth.js";

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
