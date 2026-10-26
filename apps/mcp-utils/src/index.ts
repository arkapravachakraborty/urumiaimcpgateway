import { startMcpServer } from "@repo/mcp-kit";
import { createUtilsServer } from "./server.js";

await startMcpServer({
  name: "mcp-utils",
  version: "1.0.0",
  port: Number(process.env.PORT ?? 3002),
  createServer: createUtilsServer,
});
