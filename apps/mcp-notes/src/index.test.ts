import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { RunningMcpServer } from "@repo/mcp-kit";
import { startMcpServer } from "@repo/mcp-kit";
import { createNotesServer, NoteStore } from "./server.js";

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
  const store = new NoteStore();
  runningServer = await startMcpServer({
    name: "mcp-notes-test",
    version: "1.0.0",
    host: "127.0.0.1",
    port: 0,
    bearerToken: "notes-test-token",
    createServer: () => createNotesServer(store),
  });
  const unauthorized = await fetch(`${runningServer.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);
  client = new Client({ name: "mcp-notes-test-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${runningServer.url}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer notes-test-token" } },
    }),
  );
});

after(async () => {
  await client.close();
  await runningServer.close();
});

test("lists and calls notes tools using the MCP client", async () => {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name).sort(), [
    "add_note",
    "list_notes",
    "search",
  ]);
  assert.ok(tools.tools.every(({ description, inputSchema }) => description && inputSchema));

  const added = await client.callTool(
    {
      name: "add_note",
      arguments: { title: "Deployment", content: "Use the local Kubernetes cluster." },
    },
    CallToolResultSchema,
  );
  assert.equal(added.isError, undefined);

  const found = await client.callTool(
    {
      name: "search",
      arguments: { query: "kubernetes" },
    },
    CallToolResultSchema,
  );
  assert.equal(found.isError, undefined);
  assert.match(firstText(found), /"title":"Deployment"/);

  const listed = await client.callTool({ name: "list_notes", arguments: {} }, CallToolResultSchema);
  assert.equal(listed.isError, undefined);
  assert.match(firstText(listed), /"content":"Use the local Kubernetes cluster\."/);
});
