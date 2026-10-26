import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { decryptCredential, encryptCredential, parseEncryptionKey } from "./crypto.js";
import { HealthChecker } from "./health-checker.js";
import { startGateway } from "./gateway.js";
import type { AuditLogInput, GatewayDataRepository } from "./repository.js";
import {
  UpstreamManager,
  type ServerHealthUpdate,
  type UpstreamServer,
} from "./upstream-manager.js";

const encryptionKey = randomBytes(32);
const user = { id: "test-user", email: "test@example.com" };

class FakeRepository implements GatewayDataRepository {
  readonly servers: UpstreamServer[];
  readonly audits: AuditLogInput[] = [];
  pingFails = false;

  constructor(servers: UpstreamServer[]) {
    this.servers = servers;
  }

  async findEnabledServers(): Promise<UpstreamServer[]> {
    return this.servers.filter(({ enabled }) => enabled);
  }

  async findServers(): Promise<UpstreamServer[]> {
    return [...this.servers];
  }

  async findServerBySlug(slug: string): Promise<UpstreamServer | null> {
    return this.servers.find((server) => server.slug === slug) ?? null;
  }

  async updateServerHealth(slug: string, update: ServerHealthUpdate): Promise<void> {
    const server = this.servers.find((item) => item.slug === slug);
    if (!server) throw new Error("Missing fake upstream.");
    Object.assign(server, update);
  }

  async ping(): Promise<void> {
    if (this.pingFails) throw new Error("Database unavailable");
  }

  async findUser(id: string): Promise<typeof user | null> {
    return id === user.id ? user : null;
  }

  async createAuditLog(input: AuditLogInput): Promise<void> {
    this.audits.push(input);
  }
}

interface FakeUpstream {
  url: string;
  close(): Promise<void>;
}

async function startFakeUpstream(
  name: string,
  options: {
    delayToolsListMs?: number;
    slowToolMs?: number;
    expectedHeaders?: Record<string, string>;
  } = {},
): Promise<FakeUpstream> {
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  app.use(express.json());
  app.post("/mcp", async (request, response) => {
    if (request.body?.method === "tools/list" && options.delayToolsListMs) {
      await delay(options.delayToolsListMs);
    }
    if (
      Object.entries(options.expectedHeaders ?? {}).some(
        ([header, value]) => request.header(header) !== value,
      )
    ) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    const server = new McpServer({ name, version: "1.0.0" });
    server.registerTool(
      "search",
      {
        description: `${name} search tool.`,
        inputSchema: { query: z.string() },
      },
      async ({ query }) => ({
        content: [{ type: "text", text: `${name}:${query}` }],
      }),
    );
    if (options.slowToolMs) {
      server.registerTool(
        "wait_tool",
        { description: "Wait for a configured interval.", inputSchema: {} },
        async () => {
          await delay(options.slowToolMs ?? 0);
          return { content: [{ type: "text", text: "finished" }] };
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let cleanedUp = false;
    const cleanup = async (): Promise<void> => {
      if (cleanedUp) return;
      cleanedUp = true;
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    };
    response.once("close", () => void cleanup());
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) response.status(500).end();
      console.error("fake upstream request failed", error);
      await cleanup();
    }
  });

  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function server(
  slug: string,
  url: string,
  options: Partial<UpstreamServer> = {},
): UpstreamServer {
  return {
    id: slug,
    slug,
    name: slug,
    url,
    enabled: true,
    authType: "NONE",
    authHeaderName: null,
    encryptedCredential: null,
    callTimeoutMs: 150,
    status: "CONNECTED",
    cachedTools: null,
    ...options,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let healthyNotes: FakeUpstream;
let healthyUtils: FakeUpstream;
let slowUpstream: FakeUpstream;
let gatewayClient: Client;
let gatewayServer: Awaited<ReturnType<typeof startGateway>>;
let repository: FakeRepository;
let healthChecker: HealthChecker;

before(async () => {
  healthyNotes = await startFakeUpstream("notes");
  healthyUtils = await startFakeUpstream("utils");
  slowUpstream = await startFakeUpstream("slow", {
    delayToolsListMs: 3_500,
    slowToolMs: 500,
  });
  repository = new FakeRepository([
    server("notes", healthyNotes.url),
    server("utils", healthyUtils.url),
    server("slow", slowUpstream.url, {
      cachedTools: [
        {
          name: "cached",
          description: "Cached fallback tool.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }),
    server("dead", "http://127.0.0.1:1/mcp", {
      cachedTools: [
        {
          name: "cached_dead",
          description: "Cached dead upstream tool.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }),
    server("disabled", healthyNotes.url, { enabled: false, status: "DISABLED" }),
  ]);
  const upstreamManager = new UpstreamManager(repository, encryptionKey, {
    healthTimeoutMs: 2_500,
  });
  gatewayServer = await startGateway({
    repository,
    upstreamManager,
    devUserId: user.id,
    host: "127.0.0.1",
    port: 0,
  });
  gatewayClient = await connectGatewayClient(gatewayServer);
});

after(async () => {
  await gatewayClient?.close().catch(() => undefined);
  healthChecker?.stop();
  await gatewayServer?.close();
  await Promise.all([
    healthyNotes?.close(),
    healthyUtils?.close(),
    slowUpstream?.close(),
  ]);
});

test("gateway exposes prefixed live and cached tools without collisions", async () => {
  const { tools } = await gatewayClient.listTools();
  const names = tools.map(({ name }) => name);

  assert.ok(names.includes("notes__search"), JSON.stringify(names));
  assert.ok(names.includes("utils__search"), JSON.stringify(names));
  assert.ok(names.includes("slow__cached"), JSON.stringify(names));
  assert.ok(names.includes("dead__cached_dead"), JSON.stringify(names));
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.some((name) => name.startsWith("disabled__")), false);
});

test("calls healthy tools while dead and slow upstream failures are isolated", async () => {
  gatewayClient = await connectGatewayClient(gatewayServer);

  const notes = await gatewayClient.callTool(
    { name: "notes__search", arguments: { query: "hello" } },
    CallToolResultSchema,
  );
  assert.equal(firstText(notes), "notes:hello");

  const utils = await gatewayClient.callTool(
    { name: "utils__search", arguments: { query: "hello" } },
    CallToolResultSchema,
  );
  assert.equal(firstText(utils), "utils:hello");

  const dead = await gatewayClient.callTool(
    { name: "dead__search", arguments: {} },
    CallToolResultSchema,
  );
  assert.equal(dead.isError, true);
  assert.match(firstText(dead), /Server 'dead' is unreachable/);

  const disabled = await gatewayClient.callTool(
    { name: "disabled__search", arguments: {} },
    CallToolResultSchema,
  );
  assert.equal(disabled.isError, true);
  assert.match(firstText(disabled), /Server 'disabled' is disabled/);

  const missing = await gatewayClient.callTool(
    { name: "missing__search", arguments: {} },
    CallToolResultSchema,
  );
  assert.equal(missing.isError, true);
  assert.match(firstText(missing), /Server 'missing' does not exist/);

  const slow = await gatewayClient.callTool(
    { name: "slow__wait_tool", arguments: {} },
    CallToolResultSchema,
  );
  assert.equal(slow.isError, true);
  assert.match(firstText(slow), /timed out after 150ms/);
});

test("health checks run in parallel, cache tools, and isolate dead upstreams", async () => {
  const manager = new UpstreamManager(repository, encryptionKey, { healthTimeoutMs: 2_500 });
  healthChecker = new HealthChecker(repository, manager, 2_500, 15_000);

  const started = Date.now();
  await healthChecker.checkAll();
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2_800, `health checks should run concurrently, took ${elapsed}ms`);
  assert.equal((await repository.findServerBySlug("notes"))?.status, "CONNECTED");
  assert.equal((await repository.findServerBySlug("utils"))?.status, "CONNECTED");
  assert.equal((await repository.findServerBySlug("slow"))?.status, "UNREACHABLE");
  assert.equal((await repository.findServerBySlug("dead"))?.status, "UNREACHABLE");
  assert.ok(Array.isArray((await repository.findServerBySlug("notes"))?.cachedTools));

  const readyResponse = await fetch(`${gatewayServer.url}/readyz`);
  assert.equal(readyResponse.status, 200);
  repository.pingFails = true;
  const notReadyResponse = await fetch(`${gatewayServer.url}/readyz`);
  assert.equal(notReadyResponse.status, 503);
  repository.pingFails = false;

  const dead = await gatewayClient.callTool(
    { name: "dead__search", arguments: {} },
    CallToolResultSchema,
  );
  assert.equal(dead.isError, true);
  assert.match(firstText(dead), /Server 'dead' is unreachable/);
});

test("writes audit rows for successful and failed tool calls", () => {
  assert.ok(repository.audits.some((audit) => audit.status === "success" && audit.serverSlug === "notes"));
  assert.ok(repository.audits.some((audit) => audit.status === "timeout" && audit.serverSlug === "slow"));
  assert.ok(repository.audits.some((audit) => audit.status === "rejected" && audit.serverSlug === "dead"));
  assert.ok(repository.audits.some((audit) => audit.status === "rejected" && audit.serverSlug === "disabled"));
  assert.ok(repository.audits.some((audit) => audit.status === "rejected" && audit.serverSlug === "missing"));
  assert.ok(repository.audits.every((audit) => audit.userId === user.id && audit.source === "mcp"));
});

test("sends decrypted bearer and custom-header credentials to upstreams", async () => {
  const bearerUpstream = await startFakeUpstream("bearer", {
    expectedHeaders: { Authorization: "Bearer bearer-secret" },
  });
  const headerUpstream = await startFakeUpstream("header", {
    expectedHeaders: { "X-API-Key": "header-secret" },
  });
  try {
    const testRepository = new FakeRepository([
      server("bearer", bearerUpstream.url, {
        authType: "BEARER",
        encryptedCredential: encryptCredential("bearer-secret", encryptionKey),
      }),
      server("header", headerUpstream.url, {
        authType: "HEADER",
        authHeaderName: "X-API-Key",
        encryptedCredential: encryptCredential("header-secret", encryptionKey),
      }),
    ]);
    const manager = new UpstreamManager(testRepository, encryptionKey);
    assert.equal(
      firstText(await manager.callTool("bearer", "search", { query: "token" })),
      "bearer:token",
    );
    assert.equal(
      firstText(await manager.callTool("header", "search", { query: "token" })),
      "header:token",
    );
  } finally {
    await Promise.all([bearerUpstream.close(), headerUpstream.close()]);
  }
});

test("AES-256-GCM credentials decrypt and reject tampering", () => {
  const encrypted = encryptCredential("private-token", encryptionKey);
  assert.equal(decryptCredential(encrypted, encryptionKey), "private-token");
  assert.deepEqual(
    parseEncryptionKey(encryptionKey.toString("base64")),
    encryptionKey,
  );
  assert.throws(() => decryptCredential(`${encrypted.slice(0, -2)}xx`, encryptionKey));
  assert.throws(() => parseEncryptionKey("too-short"));
});

function firstText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content: unknown = "content" in result ? result.content : undefined;
  const first = Array.isArray(content) ? content[0] : undefined;
  if (
    first === null ||
    typeof first !== "object" ||
    !("type" in first) ||
    first.type !== "text" ||
    !("text" in first) ||
    typeof first.text !== "string"
  ) {
    throw new Error("Expected text MCP content.");
  }
  return first.text;
}

async function connectGatewayClient(
  runningServer: Awaited<ReturnType<typeof startGateway>>,
): Promise<Client> {
  const client = new Client({ name: "gateway-test-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${runningServer.url}/mcp`)),
  );
  return client;
}
