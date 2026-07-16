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

  const sessions = new Map();
  const { authMode, tokenSource, authenticator } = parseHttpAuthConfig({
    ...options,
    vault: ctx.vault,
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);

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
