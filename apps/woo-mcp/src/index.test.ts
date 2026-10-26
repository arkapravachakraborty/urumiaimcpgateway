import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { RunningMcpServer } from "@repo/mcp-kit";
import { startMcpServer } from "@repo/mcp-kit";
import { parseWooConfig } from "./config.js";
import {
  WooCommerceApiError,
  WooCommerceClient,
  type WooCommerceClientOptions,
} from "./client.js";
import { createWooServer } from "./server.js";

const config = parseWooConfig({
  WC_BASE_URL: "http://store.test",
  WC_PUBLIC_HOST: "shop.localtest.me:8080",
  WC_CONSUMER_KEY: "test-key",
  WC_CONSUMER_SECRET: "test-secret",
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function makeProduct(input: Partial<Record<string, unknown>> = {}) {
  return {
    id: 12,
    name: "Test item",
    status: "publish",
    price: "12.50",
    regular_price: "12.50",
    sku: "",
    permalink: "https://shop.test/product/test-item",
    ...input,
  };
}

function makeOrder(input: Partial<Record<string, unknown>> = {}) {
  return {
    id: 37,
    status: "processing",
    total: "25.00",
    currency: "USD",
    date_created: "2026-10-26T10:00:00",
    line_items: [{ name: "Test item", quantity: 2, price: "12.50" }],
    ...input,
  };
}

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
    throw new Error("Expected a text result from the MCP tool.");
  }
  return first.text;
}

function clientWith(fetchImplementation: typeof globalThis.fetch, options: WooCommerceClientOptions = {}) {
  return new WooCommerceClient(config, { ...options, fetch: fetchImplementation });
}

test("validates required environment configuration and optional host header", () => {
  assert.throws(() => parseWooConfig({}), /WC_BASE_URL/);
  assert.throws(
    () =>
      parseWooConfig({
        WC_BASE_URL: "http://store.test",
        WC_PUBLIC_HOST: "store.test\r\nAuthorization: leaked",
        WC_CONSUMER_KEY: "key",
        WC_CONSUMER_SECRET: "secret",
      }),
    /WC_PUBLIC_HOST/,
  );
});

test("sends authenticated paginated product requests and creates products", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = clientWith(async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    if (init?.method === "POST") {
      return jsonResponse(makeProduct(JSON.parse(String(init.body)) as Record<string, unknown>), {
        status: 201,
      });
    }
    return jsonResponse([makeProduct()], {
      headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1" },
    });
  });

  const listed = await client.listProducts({
    search: "tea cup",
    status: "publish",
    page: 2,
    per_page: 5,
  });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0]?.name, "Test item");
  assert.match(requests[0]!.url, /\/wp-json\/wc\/v3\/products\?/);
  assert.match(requests[0]!.url, /search=tea\+cup/);
  const headers = new Headers(requests[0]!.init.headers);
  assert.equal(headers.get("Host"), "shop.localtest.me:8080");
  assert.equal(
    headers.get("Authorization"),
    `Basic ${Buffer.from("test-key:test-secret").toString("base64")}`,
  );

  const created = await client.createProduct({
    name: "New item",
    regular_price: "9.95",
    status: "publish",
  });
  assert.equal(created.name, "New item");
  assert.equal(JSON.parse(String(requests[1]!.init.body)).status, "publish");
});

test("maps HTTP errors and request timeouts without including credentials", async () => {
  const rejected = clientWith(async () => jsonResponse(
    { code: "woocommerce_rest_cannot_view", message: "permission denied" },
    { status: 401 },
  ));
  await assert.rejects(
    rejected.listProducts({ page: 1, per_page: 10 }),
    (error: unknown) =>
      error instanceof WooCommerceApiError &&
      error.code === "http_error" &&
      error.status === 401 &&
      !error.message.includes("test-secret"),
  );

  const timeout = clientWith(async () => {
    const error = new Error("timeout");
    error.name = "TimeoutError";
    throw error;
  });
  await assert.rejects(
    timeout.getOrder(1),
    (error: unknown) => error instanceof WooCommerceApiError && error.code === "timeout",
  );
});

test("leaves MCP authentication optional when no Woo token is configured", async () => {
  const previousToken = process.env.MCP_BEARER_TOKEN;
  process.env.MCP_BEARER_TOKEN = "legacy-token";
  const server = await startMcpServer({
    name: "woo-mcp-optional-auth-test",
    version: "1.0.0",
    host: "127.0.0.1",
    port: 0,
    bearerToken: null,
    createServer: () => createWooServer(clientWith(async () => jsonResponse([]))),
  });

  try {
    const response = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.notEqual(response.status, 401);
  } finally {
    await server.close();
    if (previousToken === undefined) delete process.env.MCP_BEARER_TOKEN;
    else process.env.MCP_BEARER_TOKEN = previousToken;
  }
});

let runningServer: RunningMcpServer;
let mcpClient: Client;
const capturedUrls: string[] = [];

before(async () => {
  const client = clientWith(async (input, init) => {
    const url = new URL(String(input));
    capturedUrls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/products") && init?.method === "POST") {
      return jsonResponse(makeProduct(JSON.parse(String(init.body)) as Record<string, unknown>), {
        status: 201,
      });
    }
    if (url.pathname.endsWith("/products")) {
      return jsonResponse([makeProduct()], {
        headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1" },
      });
    }
    if (url.pathname.endsWith("/orders/37") && init?.method === "PUT") {
      return jsonResponse(makeOrder({ status: "completed" }));
    }
    if (url.pathname.endsWith("/orders/37")) return jsonResponse(makeOrder());
    return jsonResponse([makeOrder()], {
      headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1" },
    });
  });
  runningServer = await startMcpServer({
    name: "woo-mcp-test",
    version: "1.0.0",
    host: "127.0.0.1",
    port: 0,
    bearerToken: "woo-test-token",
    createServer: () => createWooServer(client),
  });
  const unauthorized = await fetch(`${runningServer.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);
  mcpClient = new Client({ name: "woo-mcp-test-client", version: "1.0.0" });
  await mcpClient.connect(
    new StreamableHTTPClientTransport(new URL(`${runningServer.url}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer woo-test-token" } },
    }),
  );
});

after(async () => {
  await mcpClient.close();
  await runningServer.close();
});

test("exposes concise WooCommerce tools over authenticated MCP", async () => {
  const tools = await mcpClient.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name).sort(), [
    "create_product",
    "get_order",
    "list_orders",
    "list_products",
    "update_order_status",
  ]);

  const product = await mcpClient.callTool(
    {
      name: "create_product",
      arguments: { name: "MCP product", regular_price: "4.00" },
    },
    CallToolResultSchema,
  );
  assert.equal(product.isError, undefined);
  assert.equal(JSON.parse(firstText(product)).name, "MCP product");
  assert.equal(JSON.parse(firstText(product)).status, "publish");

  const products = await mcpClient.callTool(
    { name: "list_products", arguments: { search: "Test" } },
    CallToolResultSchema,
  );
  assert.equal(products.isError, undefined);
  assert.equal(JSON.parse(firstText(products)).products[0].name, "Test item");

  const orders = await mcpClient.callTool(
    { name: "list_orders", arguments: { today: true } },
    CallToolResultSchema,
  );
  assert.equal(orders.isError, undefined);
  assert.equal(JSON.parse(firstText(orders)).orders[0].id, 37);
  assert.match(capturedUrls.find((url) => url.includes("/orders?")) ?? "", /after=/);
  assert.match(capturedUrls.find((url) => url.includes("/orders?")) ?? "", /before=/);

  const order = await mcpClient.callTool(
    { name: "get_order", arguments: { id: 37 } },
    CallToolResultSchema,
  );
  assert.equal(JSON.parse(firstText(order)).items[0].name, "Test item");

  const updated = await mcpClient.callTool(
    { name: "update_order_status", arguments: { id: 37, status: "completed" } },
    CallToolResultSchema,
  );
  assert.equal(JSON.parse(firstText(updated)).status, "completed");
});

test("rejects conflicting order date filters", async () => {
  const result = await mcpClient.callTool(
    {
      name: "list_orders",
      arguments: { today: true, after: "2026-10-26T00:00:00Z" },
    },
    CallToolResultSchema,
  );
  assert.equal(result.isError, true);
});
