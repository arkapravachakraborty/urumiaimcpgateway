import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export class NoteStore {
  private readonly notes: Note[] = [];

  add(title: string, content: string): Note {
    const note = {
      id: randomUUID(),
      title,
      content,
      createdAt: new Date().toISOString(),
    };
    this.notes.push(note);
    return note;
  }

  list(): readonly Note[] {
    return this.notes;
  }

  search(query: string): Note[] {
    const normalizedQuery = query.toLocaleLowerCase();
    return this.notes.filter((note) =>
      `${note.title}\n${note.content}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }
}

export function createNotesServer(store = new NoteStore()): McpServer {
  const server = new McpServer({
    name: "mcp-notes",
    version: "1.0.0",
  });

  server.registerTool(
    "add_note",
    {
      description: "Save a note with a short title and text content.",
      inputSchema: {
        title: z.string().trim().min(1).max(200).describe("A short title for the note."),
        content: z.string().trim().min(1).max(10_000).describe("The text content to save."),
      },
    },
    async ({ title, content }) => {
      const note = store.add(title, content);
      return {
        content: [{ type: "text", text: JSON.stringify(note) }],
      };
    },
  );

  server.registerTool(
    "list_notes",
    {
      description: "List all notes saved in this running notes server.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(store.list()) }],
    }),
  );

  server.registerTool(
    "search",
    {
      description: "Find saved notes whose title or content contains the query.",
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe("Text to find in note titles and content."),
      },
    },
    async ({ query }) => ({
      content: [{ type: "text", text: JSON.stringify(store.search(query)) }],
    }),
  );

  return server;
}
