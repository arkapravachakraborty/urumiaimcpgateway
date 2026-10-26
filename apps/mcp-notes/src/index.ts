import { startMcpServer } from "@repo/mcp-kit";
import { createNotesServer, NoteStore } from "./server.js";

const store = new NoteStore();

await startMcpServer({
  name: "mcp-notes",
  version: "1.0.0",
  port: Number(process.env.PORT ?? 3001),
  createServer: () => createNotesServer(store),
});
