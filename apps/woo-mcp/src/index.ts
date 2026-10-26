import { parseWooConfig } from "./config.js";
import { WooCommerceClient } from "./client.js";
import { createWooServer } from "./server.js";
import { startMcpServer } from "@repo/mcp-kit";

const config = parseWooConfig();
const client = new WooCommerceClient(config);

await startMcpServer({
  name: "woo-mcp",
  version: "1.0.0",
  port: Number(process.env.PORT ?? 3003),
  bearerToken: config.MCP_AUTH_TOKEN ?? null,
  createServer: () => createWooServer(client),
});
