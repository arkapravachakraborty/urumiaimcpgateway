import { timingSafeEqual } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface McpHttpServerOptions {
  name: string;
  version: string;
  createServer: () => McpServer;
  port?: number;
  host?: string;
  allowedHosts?: string[];
  bearerToken?: string;
}

export interface RunningMcpServer {
  app: Express;
  httpServer: HttpServer;
  url: string;
  close: () => Promise<void>;
}

const portSchema = z.coerce.number().int().min(0).max(65_535);
const bearerTokenSchema = z.string().min(1).optional();
const allowedHostsSchema = z.array(z.string().trim().min(1));

function log(
  level: "info" | "error",
  event: string,
  fields: Record<string, string | number> = {},
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    }),
  );
}

function isAuthorized(request: Request, bearerToken: string | undefined): boolean {
  if (bearerToken === undefined) {
    return true;
  }

  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const suppliedToken = Buffer.from(authorization.slice("Bearer ".length));
  const expectedToken = Buffer.from(bearerToken);
  return (
    suppliedToken.length === expectedToken.length && timingSafeEqual(suppliedToken, expectedToken)
  );
}

function jsonRpcError(message: string): {
  jsonrpc: "2.0";
  error: { code: number; message: string };
  id: null;
} {
  return {
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  };
}

export async function startMcpServer(options: McpHttpServerOptions): Promise<RunningMcpServer> {
  const port = portSchema.parse(options.port ?? process.env.PORT ?? "3000");
  const bearerToken = bearerTokenSchema.parse(options.bearerToken ?? process.env.MCP_BEARER_TOKEN);
  const host = options.host ?? "0.0.0.0";
  const defaultAllowedHosts = ["localhost", "127.0.0.1", "[::1]", options.name];
  const configuredAllowedHosts =
    process.env.MCP_ALLOWED_HOSTS === undefined ? [] : process.env.MCP_ALLOWED_HOSTS.split(",");
  const allowedHosts = allowedHostsSchema.parse(
    options.allowedHosts ?? [...defaultAllowedHosts, ...configuredAllowedHosts],
  );
  const app = createMcpExpressApp({ host, allowedHosts });

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const startedAt = Date.now();
    response.once("finish", () => {
      log("info", "http_request", {
        service: options.name,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  const authenticate: RequestHandler = (request, response, next) => {
    if (!isAuthorized(request, bearerToken)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  app.post("/mcp", authenticate, async (request: Request, response: Response) => {
    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    try {
      server = options.createServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      log("error", "mcp_request_failed", {
        service: options.name,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      if (!response.headersSent) {
        response.status(500).json(jsonRpcError("Internal server error"));
      }
    } finally {
      const cleanup: Promise<void>[] = [];
      if (transport) {
        cleanup.push(transport.close());
      }
      if (server) {
        cleanup.push(server.close());
      }
      await Promise.all(cleanup);
    }
  });

  app.get("/mcp", authenticate, (_request, response) => {
    response.status(405).json(jsonRpcError("Method not allowed."));
  });

  app.delete("/mcp", authenticate, (_request, response) => {
    response.status(405).json(jsonRpcError("Method not allowed."));
  });

  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    response.status(400).json({ error: "Invalid request body" });
  });

  const httpServer = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });

  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
    throw new Error("Unable to determine the MCP server address");
  }

  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        removeSignalHandlers();
        if (error) {
          reject(error);
          return;
        }
        log("info", "server_stopped", { service: options.name });
        resolve();
      });
    });
    return closePromise;
  };

  const shutdown = (signal: NodeJS.Signals): void => {
    log("info", "shutdown_started", { service: options.name, signal });
    void close().catch((error: unknown) => {
      log("error", "shutdown_failed", {
        service: options.name,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      process.exitCode = 1;
    });
  };
  const onSigint = (): void => shutdown("SIGINT");
  const onSigterm = (): void => shutdown("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  function removeSignalHandlers(): void {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }

  log("info", "server_started", {
    service: options.name,
    host,
    port: address.port,
  });

  return {
    app,
    httpServer,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await close();
    },
  };
}
