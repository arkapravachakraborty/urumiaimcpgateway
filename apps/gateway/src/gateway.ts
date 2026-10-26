import type { Express, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GatewayDataRepository, AuditLogInput } from "./repository.js";
import { UpstreamManager } from "./upstream-manager.js";
import {
  UpstreamTimeoutError,
  UpstreamUnavailableError,
} from "./upstream-manager.js";

const portSchema = z.coerce.number().int().min(0).max(65_535);
const allowedHostsSchema = z.array(z.string().trim().min(1));
const toolCallNameSchema = z.string().regex(/^([a-z0-9-]+)__([a-zA-Z0-9_-]{1,64})$/);
const argsSchema = z.record(z.string(), z.unknown());

export interface GatewayAppOptions {
  repository: GatewayDataRepository;
  upstreamManager: UpstreamManager;
  devUserId?: string;
  source?: "mcp" | "chat";
}

export interface GatewayServerOptions extends GatewayAppOptions {
  port?: number;
  host?: string;
}

export function createGatewayApp(options: GatewayAppOptions): Express {
  const host = "0.0.0.0";
  const configuredAllowedHosts =
    process.env.MCP_ALLOWED_HOSTS === undefined ? [] : process.env.MCP_ALLOWED_HOSTS.split(",");
  const allowedHosts = allowedHostsSchema.parse([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "gateway",
    "dashboard.localtest.me",
    ...configuredAllowedHosts,
  ]);
  const app = createMcpExpressApp({ host, allowedHosts });
  app.disable("x-powered-by");
  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/readyz", async (_request, response) => {
    try {
      await options.repository.ping();
      response.status(200).json({ status: "ready" });
    } catch {
      console.error("[gateway] database readiness check failed");
      response.status(503).json({ status: "not ready" });
    }
  });

  app.post("/mcp", async (request: Request, response: Response) => {
    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    let cleanedUp = false;
    const cleanup = async (): Promise<void> => {
      if (cleanedUp) return;
      cleanedUp = true;
      await transport?.close().catch(() => undefined);
      await server?.close().catch(() => undefined);
    };
    try {
      server = createGatewayMcpServer();
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      registerGatewayHandlers(server, options);
      await server.connect(transport);
      response.once("close", () => {
        void cleanup();
      });
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error(
        "[gateway] MCP request failed",
        error instanceof Error ? error.message.slice(0, 300) : errorType(error),
      );
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Internal server error" },
          id: null,
        });
      }
    } finally {
      if (!response.headersSent || response.destroyed) await cleanup();
    }
  });

  app.get("/mcp", (_request, response) => {
    response.status(405).json({ error: "Method not allowed" });
  });
  app.delete("/mcp", (_request, response) => {
    response.status(405).json({ error: "Method not allowed" });
  });
  return app;
}

export async function startGateway(options: GatewayServerOptions): Promise<{
  app: Express;
  url: string;
  close(): Promise<void>;
}> {
  const port = portSchema.parse(options.port ?? process.env.GATEWAY_PORT ?? "4000");
  const host = options.host ?? "0.0.0.0";
  const app = createGatewayApp(options);
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
    throw new Error("Unable to determine the gateway listener address.");
  }
  return {
    app,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function createGatewayMcpServer(): McpServer {
  return new McpServer(
    { name: "team-mcp-gateway", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
}

function registerGatewayHandlers(server: McpServer, options: GatewayAppOptions): void {
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await options.upstreamManager.listTools(),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const startedAt = new Date();
    const name = request.params.name;
    const match = toolCallNameSchema.safeParse(name);
    const parsedArgs = argsSchema.safeParse(request.params.arguments ?? {});
    let status: AuditLogInput["status"] = "error";
    let errorMessage: string | null = null;
    let result: CallToolResult;
    const prefixSeparator = name.indexOf("__");
    const slug = match.success ? name.slice(0, prefixSeparator) : null;
    const toolName = match.success ? name.slice(prefixSeparator + 2) : name;
    let user: { id: string; email: string } | null = null;

    try {
      if (options.devUserId) {
        user = await options.repository.findUser(options.devUserId);
      }
      if (!user) {
        status = "rejected";
        throw new GatewayRequestError(
          options.devUserId
            ? "Development user is not available."
            : "Gateway authentication is not configured.",
        );
      }
      if (!match.success || !slug || !toolName) {
        status = "rejected";
        throw new GatewayRequestError("Invalid tool name. Expected '<serverSlug>__<toolName>'.");
      }
      if (!parsedArgs.success) {
        status = "rejected";
        throw new GatewayRequestError("Tool arguments must be a JSON object.");
      }

      result = await options.upstreamManager.callTool(slug, toolName, parsedArgs.data);
      status = result.isError ? "error" : "success";
      if (result.isError) errorMessage = extractText(result);
    } catch (error) {
      errorMessage = errorMessageFor(error);
      status =
        error instanceof UpstreamTimeoutError
          ? "timeout"
          : error instanceof GatewayRequestError || error instanceof UpstreamUnavailableError
            ? "rejected"
            : "error";
      result = errorResult(errorMessage);
    }

    const audit: AuditLogInput = {
      userId: user?.id ?? null,
      userEmail: user?.email ?? (options.devUserId ? `dev:${options.devUserId}` : "anonymous"),
      serverSlug: slug,
      toolName,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      status,
      error: errorMessage?.slice(0, 1_000) ?? null,
      source: options.source ?? "mcp",
    };

    try {
      await options.repository.createAuditLog(audit);
    } catch (error) {
      console.error("[gateway] audit log write failed", errorType(error));
      return errorResult("Tool request could not be audited.");
    }
    return result;
  });
}

class GatewayRequestError extends Error {}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function errorMessageFor(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1_000);
  return "Tool call failed.";
}

function extractText(result: CallToolResult): string | null {
  for (const content of result.content) {
    if (content.type === "text") return content.text.slice(0, 1_000);
  }
  return "Upstream tool returned an error.";
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
