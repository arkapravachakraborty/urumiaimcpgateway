import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  parseCachedTools,
  type GatewayRepository,
  type UpstreamServer,
  UpstreamManager,
} from "./upstream-manager.js";
import { UpstreamTimeoutError } from "./upstream-manager.js";

const CHECK_INTERVAL_MS = 15_000;

export class HealthChecker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly repository: GatewayRepository,
    private readonly upstreamManager: UpstreamManager,
    private readonly timeoutMs = 3_000,
    private readonly intervalMs = CHECK_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.checkAll();
    this.timer = setInterval(() => void this.checkAll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async checkAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const servers = await this.repository.findServers();
      const results = await Promise.allSettled(servers.map((server) => this.checkOne(server)));
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("[gateway] upstream health update failed", safeErrorMessage(result.reason));
        }
      }
    } catch (error) {
      console.error("[gateway] upstream health check failed", safeErrorMessage(error));
    } finally {
      this.running = false;
    }
  }

  private async checkOne(server: UpstreamServer): Promise<void> {
    if (!server.enabled) {
      await this.repository.updateServerHealth(server.slug, {
        status: "DISABLED",
        statusCheckedAt: new Date(),
        lastError: null,
        cachedTools: null,
      });
      return;
    }

    try {
      const tools = await withHealthTimeout(
        this.upstreamManager.checkServer(server),
        this.timeoutMs,
      );
      await this.repository.updateServerHealth(server.slug, {
        status: "CONNECTED",
        statusCheckedAt: new Date(),
        lastError: null,
        cachedTools: tools,
      });
    } catch (error) {
      await this.repository.updateServerHealth(server.slug, {
        status: "UNREACHABLE",
        statusCheckedAt: new Date(),
        lastError: truncate(safeErrorMessage(error)),
        cachedTools: parseToolCache(server.cachedTools),
      });
    }
  }
}

function withHealthTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpstreamTimeoutError(timeoutMs)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function parseToolCache(value: unknown): Tool[] | null {
  if (!Array.isArray(value)) return null;
  return parseCachedTools(value);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown upstream error";
}

function truncate(value: string): string {
  return value.slice(0, 1_000);
}
