import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  ToolSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { decryptCredential } from "./crypto.js";

export type UpstreamAuthType = "NONE" | "BEARER" | "HEADER";
export type UpstreamStatus = "CONNECTED" | "UNREACHABLE" | "DISABLED";

export interface UpstreamServer {
  id: string;
  slug: string;
  name: string;
  url: string;
  enabled: boolean;
  authType: UpstreamAuthType;
  authHeaderName: string | null;
  encryptedCredential: string | null;
  callTimeoutMs: number;
  status: UpstreamStatus;
  cachedTools: unknown;
}

export interface ServerHealthUpdate {
  status: UpstreamStatus;
  statusCheckedAt: Date;
  lastError: string | null;
  cachedTools: Tool[] | null;
}

export interface GatewayRepository {
  findEnabledServers(): Promise<UpstreamServer[]>;
  findServers(): Promise<UpstreamServer[]>;
  findServerBySlug(slug: string): Promise<UpstreamServer | null>;
  updateServerHealth(slug: string, update: ServerHealthUpdate): Promise<void>;
}

export interface UpstreamManagerOptions {
  healthTimeoutMs?: number;
  clientFactory?: (server: UpstreamServer) => UpstreamClient;
}

export interface UpstreamClient {
  connect(): Promise<void>;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export class UpstreamTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms`);
    this.name = "UpstreamTimeoutError";
  }
}

export class UpstreamUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamUnavailableError";
  }
}

const cachedToolsSchema = z.array(ToolSchema);
const upstreamSlugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const upstreamToolNameSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const upstreamUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

export class UpstreamManager {
  private readonly healthTimeoutMs: number;
  private readonly clientFactory: (server: UpstreamServer) => UpstreamClient;

  constructor(
    private readonly repository: GatewayRepository,
    private readonly encryptionKey: Buffer,
    options: UpstreamManagerOptions = {},
  ) {
    this.healthTimeoutMs = options.healthTimeoutMs ?? 3_000;
    this.clientFactory = options.clientFactory ?? ((server) => this.createSdkClient(server));
  }

  async listTools(): Promise<Tool[]> {
    const servers = await this.repository.findEnabledServers();
    const settled = await Promise.allSettled(
      servers
        .filter((server) => server.status !== "UNREACHABLE")
        .map(async (server) => {
          try {
            return {
              server,
              tools: await this.withClient(server, this.healthTimeoutMs, (client) =>
                client.listTools(),
              ),
            };
          } catch {
            return { server, tools: this.getCachedTools(server) };
          }
        }),
    );

    const tools: Tool[] = [];
    const seen = new Set<string>();
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const tool of result.value.tools) {
        const slug = upstreamSlugSchema.safeParse(result.value.server.slug);
        const upstreamName = upstreamToolNameSchema.safeParse(tool.name);
        if (!slug.success || !upstreamName.success) continue;
        const name = `${slug.data}__${upstreamName.data}`;
        if (name.length > 64 || seen.has(name)) continue;
        seen.add(name);
        tools.push({ ...tool, name });
      }
    }
    return tools;
  }

  async callTool(
    slug: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const server = await this.repository.findServerBySlug(slug);
    if (!server) throw new UpstreamUnavailableError(`Server '${slug}' does not exist.`);
    if (!server.enabled) throw new UpstreamUnavailableError(`Server '${slug}' is disabled.`);
    if (server.status === "UNREACHABLE") {
      throw new UpstreamUnavailableError(`Server '${slug}' is unreachable.`);
    }
    try {
      return await this.withClient(server, server.callTimeoutMs, (client) =>
        client.callTool(toolName, args),
      );
    } catch (error) {
      if (error instanceof UpstreamTimeoutError) throw error;
      throw new UpstreamUnavailableError(`Server '${slug}' is unreachable.`);
    }
  }

  async checkServer(server: UpstreamServer): Promise<Tool[]> {
    return this.withClient(server, this.healthTimeoutMs, (client) => client.listTools());
  }

  private getCachedTools(server: UpstreamServer): Tool[] {
    const parsed = cachedToolsSchema.safeParse(server.cachedTools);
    return parsed.success ? parsed.data : [];
  }

  private async withClient<T>(
    server: UpstreamServer,
    timeoutMs: number,
    action: (client: UpstreamClient) => Promise<T>,
  ): Promise<T> {
    const client = this.clientFactory(server);
    try {
      return await withTimeout(
        (async () => {
          await client.connect();
          return action(client);
        })(),
        timeoutMs,
      );
    } finally {
      await client.close().catch((error: unknown) => {
        console.error(
          "[gateway] upstream client cleanup failed",
          error instanceof Error ? error.name : "UnknownError",
        );
      });
    }
  }

  private createSdkClient(server: UpstreamServer): UpstreamClient {
    const url = upstreamUrlSchema.parse(server.url);
    const headers = new Headers();
    if (server.authType !== "NONE") {
      if (!server.encryptedCredential) {
        throw new UpstreamUnavailableError(`Server '${server.slug}' has no configured credential.`);
      }
      const credential = decryptCredential(server.encryptedCredential, this.encryptionKey);
      if (server.authType === "BEARER") {
        headers.set("Authorization", `Bearer ${credential}`);
      } else {
        const headerName = server.authHeaderName;
        if (!headerName || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(headerName)) {
          throw new UpstreamUnavailableError(`Server '${server.slug}' has an invalid auth header.`);
        }
        headers.set(headerName, credential);
      }
    }

    const client = new Client({ name: "team-mcp-gateway", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 100,
        maxReconnectionDelay: 1_000,
        reconnectionDelayGrowFactor: 1.5,
      },
    });
    return {
      connect: () => client.connect(transport),
      listTools: async () => (await client.listTools()).tools,
      callTool: async (name, args) => {
        const result = await client.callTool(
          { name, arguments: args },
          CallToolResultSchema,
        );
        const parsed = CallToolResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new Error("Upstream returned an unsupported tool result.");
        }
        return parsed.data;
      },
      close: () => transport.close(),
    };
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpstreamTimeoutError(timeoutMs)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function parseCachedTools(value: unknown): Tool[] {
  const parsed = cachedToolsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
