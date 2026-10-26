import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { RunningMcpServer } from "@repo/mcp-kit";
import { startMcpServer } from "@repo/mcp-kit";
import { createUtilsServer } from "./server.js";

let runningServer: RunningMcpServer;
let client: Client;

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

before(async () => {
  runningServer = await startMcpServer({
    name: "mcp-utils-test",
    version: "1.0.0",
    host: "127.0.0.1",
    port: 0,
    bearerToken: "utils-test-token",
    createServer: createUtilsServer,
  });
  const unauthorized = await fetch(`${runningServer.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);
  client = new Client({ name: "mcp-utils-test-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${runningServer.url}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer utils-test-token" } },
    }),
  );
});

after(async () => {
  await client.close();
  await runningServer.close();
});

test("lists and calls utility tools using the MCP client", async () => {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name).sort(), [
    "calculate",
    "current_time",
    "search",
  ]);
  assert.ok(tools.tools.every(({ description, inputSchema }) => description && inputSchema));

  const calculated = await client.callTool(
    {
      name: "calculate",
      arguments: { expression: "(12 + 3) * 4 / 2" },
    },
    CallToolResultSchema,
  );
  assert.equal(calculated.isError, undefined);
  assert.equal(firstText(calculated), "30");

  const time = await client.callTool({ name: "current_time", arguments: {} }, CallToolResultSchema);
  assert.ok(Number.isFinite(Date.parse(firstText(time))));

  const found = await client.callTool(
    {
      name: "search",
      arguments: { query: "JSON-RPC" },
    },
    CallToolResultSchema,
  );
  assert.match(firstText(found), /JSON-RPC 2\.0/);
});

test("rejects executable syntax and division by zero", async () => {
  const executable = await client.callTool(
    {
      name: "calculate",
      arguments: { expression: "1 + process.exit()" },
    },
    CallToolResultSchema,
  );
  assert.equal(executable.isError, true);

  const divisionByZero = await client.callTool(
    {
      name: "calculate",
      arguments: { expression: "10 / 0" },
    },
    CallToolResultSchema,
  );
  assert.equal(divisionByZero.isError, true);
});
