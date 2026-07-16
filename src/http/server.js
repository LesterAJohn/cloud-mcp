import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { UnauthorizedError, parseHttpAuthConfig } from "./auth.js";

function asPath(value, fallback) {
  const candidate = String(value ?? fallback).trim();
  if (!candidate.startsWith("/")) {
    return `/${candidate}`;
  }

  return candidate;
}

function headerValue(headers, key) {
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function splitCsv(input) {
  return String(input ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function asBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function stripPort(host) {
  if (!host) {
    return "";
  }

  const trimmed = host.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end >= 0 ? trimmed.slice(0, end + 1) : trimmed;
  }

  return trimmed.split(":")[0];
}

function normalizeIp(ip) {
  if (!ip) {
    return "";
  }

  const candidate = String(ip).trim();
  if (candidate.startsWith("::ffff:")) {
    return candidate.slice(7);
  }

  return candidate;
}

function getRequestIp(req, trustedProxy) {
  if (trustedProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded ?? "").split(",")[0];
    const forwardedIp = normalizeIp(first);
    if (forwardedIp) {
      return forwardedIp;
    }
  }

  return normalizeIp(req.socket?.remoteAddress ?? "");
}

function createRateLimiter(windowMs, maxRequests) {
  const buckets = new Map();
  const safeWindow = Math.max(windowMs, 1);
  const safeMax = Math.max(maxRequests, 1);

  return {
    check(key) {
      const now = Date.now();
      const bucketKey = key || "unknown";
      const bucket = buckets.get(bucketKey);

      if (!bucket || now - bucket.windowStart >= safeWindow) {
        buckets.set(bucketKey, { count: 1, windowStart: now });
        return { allowed: true, remaining: Math.max(safeMax - 1, 0), retryAfterSeconds: Math.ceil(safeWindow / 1000) };
      }

      if (bucket.count >= safeMax) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(safeWindow / 1000) };
      }

      bucket.count += 1;
      return {
        allowed: true,
        remaining: Math.max(safeMax - bucket.count, 0),
        retryAfterSeconds: Math.ceil(safeWindow / 1000),
      };
    },
  };
}

async function readJsonBody(req, maxBodyBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new Error(`Request body exceeds MCP_HTTP_MAX_BODY_BYTES (${maxBodyBytes})`);
    }

    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function writeJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

export async function createHttpMcpServer({ ctx, createMcpServer, options = {} }) {
  const host = String(options.httpHost ?? process.env.MCP_HTTP_HOST ?? "127.0.0.1");
  const port = Number.parseInt(String(options.httpPort ?? process.env.MCP_HTTP_PORT ?? "3000"), 10);
  const mcpPath = asPath(options.httpPath ?? process.env.MCP_HTTP_PATH, "/mcp");
  const healthPath = asPath(options.httpHealthPath ?? process.env.MCP_HTTP_HEALTH_PATH, "/healthz");
  const maxBodyBytes = Number.parseInt(
    String(options.httpMaxBodyBytes ?? process.env.MCP_HTTP_MAX_BODY_BYTES ?? "1048576"),
    10,
  );
  const trustedProxy = asBoolean(options.httpTrustedProxy ?? process.env.MCP_HTTP_TRUST_PROXY, false);
  const allowedOrigins = splitCsv(options.httpAllowedOrigins ?? process.env.MCP_HTTP_ALLOWED_ORIGINS ?? "");
  const allowedIps = splitCsv(options.httpAllowedIps ?? process.env.MCP_HTTP_ALLOWED_IPS ?? "");
  const rateLimitWindowMs = Number.parseInt(
    String(options.httpRateLimitWindowMs ?? process.env.MCP_HTTP_RATE_LIMIT_WINDOW_MS ?? "60000"),
    10,
  );
  const rateLimitMaxRequests = Number.parseInt(
    String(options.httpRateLimitMaxRequests ?? process.env.MCP_HTTP_RATE_LIMIT_MAX_REQUESTS ?? "60"),
    10,
  );
  const rateLimiter = createRateLimiter(rateLimitWindowMs, rateLimitMaxRequests);

  const sessions = new Map();
  const { authMode, tokenSource, authenticator } = parseHttpAuthConfig({
    ...options,
    vault: ctx.vault,
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const startTime = Date.now();
    const ip = getRequestIp(req, trustedProxy);

    try {
      if (req.method === "GET" && url.pathname === healthPath) {
        writeJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname !== mcpPath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      if (!["POST", "GET", "DELETE"].includes(req.method ?? "")) {
        res.writeHead(405, { Allow: "POST, GET, DELETE" });
        res.end("Method not allowed");
        return;
      }

      if (allowedIps.length > 0 && !allowedIps.includes(ip)) {
        writeJson(res, 403, {
          error: "forbidden",
          message: "Forbidden: IP address is not allowed",
        });
        return;
      }

      const origin = String(req.headers.origin ?? "").trim();
      if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
        writeJson(res, 403, {
          error: "forbidden",
          message: "Forbidden: origin is not allowed",
        });
        return;
      }

      const hostHeader = stripPort(String(req.headers.host ?? ""));
      if (allowedOrigins.length > 0 && !origin && hostHeader && !allowedOrigins.includes(hostHeader)) {
        writeJson(res, 403, {
          error: "forbidden",
          message: "Forbidden: host is not allowed",
        });
        return;
      }

      const rate = rateLimiter.check(ip);
      if (!rate.allowed) {
        writeJson(
          res,
          429,
          {
            error: "rate_limited",
            message: "Too many requests",
          },
          { "Retry-After": String(rate.retryAfterSeconds) },
        );
        return;
      }

      const auth = await authenticator(req);
      req.auth = auth;

      const sessionId = headerValue(req.headers, "mcp-session-id");

      if (req.method === "POST") {
        const body = await readJsonBody(req, maxBodyBytes);

        if (sessionId && sessions.has(sessionId)) {
          const state = sessions.get(sessionId);
          await state.transport.handleRequest(req, res, body);
          return;
        }

        if (!sessionId && isInitializeRequest(body)) {
          const mcpServer = createMcpServer();
          let transport;

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              sessions.set(newSessionId, { transport, mcpServer });
            },
          });

          transport.onclose = async () => {
            const currentSessionId = transport.sessionId;
            if (currentSessionId && sessions.has(currentSessionId)) {
              sessions.delete(currentSessionId);
            }

            await mcpServer.close();
          };

          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }

        writeJson(res, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: no valid session ID provided",
          },
          id: null,
        });
        return;
      }

      if (!sessionId || !sessions.has(sessionId)) {
        writeJson(res, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: invalid or missing session ID",
          },
          id: null,
        });
        return;
      }

      const state = sessions.get(sessionId);
      await state.transport.handleRequest(req, res);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        writeJson(
          res,
          401,
          {
            error: "unauthorized",
            message: error.message,
          },
          { "WWW-Authenticate": 'Bearer realm="cloud-mcp"' },
        );
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error({ error }, "http mcp request failed");
      writeJson(res, 500, {
        error: "internal_error",
        message,
      });
    } finally {
      ctx.logger.info(
        {
          method: req.method,
          path: url.pathname,
          statusCode: res.statusCode,
          durationMs: Date.now() - startTime,
          ip,
        },
        "http mcp access",
      );
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  ctx.logger.info(
    {
      transport: "http",
      authMode,
      tokenSource,
      trustedProxy,
      allowedOrigins,
      allowedIps,
      rateLimitWindowMs,
      rateLimitMaxRequests,
      host,
      port,
      mcpPath,
      healthPath,
    },
    "starting cloud mcp http transport",
  );

  return {
    async close() {
      for (const [sessionId, state] of sessions.entries()) {
        sessions.delete(sessionId);
        await state.transport.close();
      }

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}
