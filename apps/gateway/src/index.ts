import { loadGatewayEnvironment } from "./load-env.js";
import { z } from "zod";

loadGatewayEnvironment();
const devUserId = z.string().trim().min(1).optional().parse(process.env.DEV_USER_ID);
const [
  { parseEncryptionKey },
  { HealthChecker },
  { startGateway },
  { PrismaGatewayRepository },
  { UpstreamManager },
] = await Promise.all([
  import("./crypto.js"),
  import("./health-checker.js"),
  import("./gateway.js"),
  import("./repository.js"),
  import("./upstream-manager.js"),
]);
const repository = new PrismaGatewayRepository();
const encryptionKey = parseEncryptionKey(process.env.ENCRYPTION_KEY);
const upstreamManager = new UpstreamManager(repository, encryptionKey);
const healthChecker = new HealthChecker(repository, upstreamManager);
const server = await startGateway({
  repository,
  upstreamManager,
  devUserId,
});

healthChecker.start();
console.log("[gateway] listening", server.url);

const shutdown = async (): Promise<void> => {
  healthChecker.stop();
  await server.close();
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
