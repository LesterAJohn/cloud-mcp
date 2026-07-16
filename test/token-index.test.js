import assert from "node:assert/strict";
import test from "node:test";

import {
  createBearerToken,
  createVaultTokenEntry,
  mergeVaultTokenIndex,
  normalizeTokenIndexPath,
  tokenIndexPathToVaultPath,
} from "../src/http/tokenIndex.js";

test("createBearerToken returns URL-safe random token", () => {
  const token = createBearerToken();
  assert.equal(typeof token, "string");
  assert.equal(token.length > 20, true);
});

test("createVaultTokenEntry hashes token and normalizes fields", () => {
  const { tokenHash, entry } = createVaultTokenEntry({
    token: "abc123",
    userId: "user-1",
    scopes: "mcp:invoke mcp:read",
    audience: "cloud-mcp",
    tokenType: "oauth2",
  });

  assert.equal(tokenHash.length, 64);
  assert.equal(entry.userId, "user-1");
  assert.equal(entry.tokenType, "oauth2");
  assert.deepEqual(entry.scopes, ["mcp:invoke", "mcp:read"]);
  assert.deepEqual(entry.audience, ["cloud-mcp"]);
});

test("mergeVaultTokenIndex inserts token into tokens map", () => {
  const merged = mergeVaultTokenIndex(
    { tokens: { old: { active: true } } },
    { tokenHash: "newhash", entry: { active: true, userId: "default" } },
  );

  assert.equal(merged.tokens.old.active, true);
  assert.equal(merged.tokens.newhash.userId, "default");
});

test("normalize token index path helpers", () => {
  const normalized = normalizeTokenIndexPath("/cloud-mcp/http/auth/token-index/");
  assert.equal(normalized, "cloud-mcp/http/auth/token-index");
  assert.deepEqual(tokenIndexPathToVaultPath(normalized), ["cloud-mcp", "http", "auth", "token-index"]);
});
