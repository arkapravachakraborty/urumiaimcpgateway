import { z } from "zod";
import { encryptCredential, parseEncryptionKey } from "./crypto.js";
import { loadGatewayEnvironment } from "./load-env.js";

loadGatewayEnvironment();
const { ServerAuthType, prisma } = await import("@repo/db");

const envSchema = z.object({
  ENCRYPTION_KEY: z.string().min(1),
  MCP_WOO_URL: z.string().url().default("http://127.0.0.1:3003/mcp"),
  MCP_NOTES_URL: z.string().url().default("http://127.0.0.1:3001/mcp"),
  MCP_UTILS_URL: z.string().url().default("http://127.0.0.1:3002/mcp"),
  MCP_AUTH_TOKEN: z.string().min(1).optional(),
});

const config = envSchema.parse(process.env);
const encryptionKey = parseEncryptionKey(config.ENCRYPTION_KEY);
const wooToken = config.MCP_AUTH_TOKEN;

const servers = [
  {
    slug: "woo",
    name: "WooCommerce",
    url: config.MCP_WOO_URL,
    authType: wooToken ? ServerAuthType.BEARER : ServerAuthType.NONE,
    encryptedCredential: wooToken ? encryptCredential(wooToken, encryptionKey) : null,
  },
  {
    slug: "notes",
    name: "Notes",
    url: config.MCP_NOTES_URL,
    authType: ServerAuthType.NONE,
    encryptedCredential: null,
  },
  {
    slug: "utils",
    name: "Utilities",
    url: config.MCP_UTILS_URL,
    authType: ServerAuthType.NONE,
    encryptedCredential: null,
  },
];

try {
  for (const server of servers) {
    const url = new URL(server.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error(`Invalid upstream URL configured for '${server.slug}'.`);
    }
    await prisma.mcpServer.upsert({
      where: { slug: server.slug },
      create: {
        ...server,
        enabled: true,
        callTimeoutMs: 15_000,
      },
      update: {
        ...server,
        enabled: true,
        status: "DISABLED",
        lastError: null,
      },
    });
  }
  console.log("[gateway] seeded upstreams: woo, notes, utils");
} finally {
  await prisma.$disconnect();
}
