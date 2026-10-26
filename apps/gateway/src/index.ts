import { loadGatewayEnvironment } from "./load-env.js";
import { z } from "zod";
import bcrypt from "bcryptjs";

loadGatewayEnvironment();
const configSchema = z.object({
  ENCRYPTION_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  MCP_WOO_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    })
    .default("http://127.0.0.1:3003/mcp"),
  MCP_AUTH_TOKEN: z.string().min(1).optional(),
});
const config = configSchema.parse(process.env);
const [
  { parseEncryptionKey, encryptCredential },
  { parseSessionSecret },
  { HealthChecker },
  { startGateway },
  { PrismaGatewayRepository },
  { UpstreamManager },
  { prisma, Role, ServerAuthType, ServerStatus },
] = await Promise.all([
  import("./crypto.js"),
  import("./auth.js"),
  import("./health-checker.js"),
  import("./gateway.js"),
  import("./repository.js"),
  import("./upstream-manager.js"),
  import("@repo/db"),
]);
const repository = new PrismaGatewayRepository();
const encryptionKey = parseEncryptionKey(config.ENCRYPTION_KEY);
const sessionSecret = parseSessionSecret(config.SESSION_SECRET);
const upstreamManager = new UpstreamManager(repository, encryptionKey);
const passwordHash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);
await prisma.user.upsert({
  where: { email: config.ADMIN_EMAIL.trim().toLowerCase() },
  create: {
    email: config.ADMIN_EMAIL.trim().toLowerCase(),
    passwordHash,
    role: Role.ADMIN,
  },
  update: {
    passwordHash,
    role: Role.ADMIN,
    disabledAt: null,
  },
});
const wooServer = await prisma.mcpServer.findUnique({ where: { slug: "woo" } });
if (!wooServer) {
  await prisma.mcpServer.create({
    data: {
      slug: "woo",
      name: "WooCommerce",
      url: config.MCP_WOO_URL,
      authType: config.MCP_AUTH_TOKEN ? ServerAuthType.BEARER : ServerAuthType.NONE,
      encryptedCredential: config.MCP_AUTH_TOKEN
        ? encryptCredential(config.MCP_AUTH_TOKEN, encryptionKey)
        : null,
      enabled: true,
      status: ServerStatus.DISABLED,
      callTimeoutMs: 15_000,
    },
  });
}
const healthChecker = new HealthChecker(repository, upstreamManager);
const server = await startGateway({
  repository,
  upstreamManager,
  authStore: repository,
  sessionSecret,
  encryptionKey,
});

healthChecker.start();
console.log("[gateway] listening", server.url);

const shutdown = async (): Promise<void> => {
  healthChecker.stop();
  await server.close();
  await prisma.$disconnect();
};

const handleShutdown = (): void => {
  void shutdown().catch((error: unknown) => {
    console.error(
      "[gateway] shutdown failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    process.exitCode = 1;
  });
};

process.once("SIGINT", handleShutdown);
process.once("SIGTERM", handleShutdown);
