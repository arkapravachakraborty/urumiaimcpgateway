import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function loadGatewayEnvironment(): void {
  loadDotenv({ path: path.join(repositoryRoot, ".env.local"), override: false });
  loadDotenv({ path: path.join(repositoryRoot, ".env"), override: false });
}
