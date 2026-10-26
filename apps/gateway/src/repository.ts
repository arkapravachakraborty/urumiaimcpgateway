import { AuditSource, AuditStatus, Prisma, prisma, ServerStatus } from "@repo/db";
import type { GatewayRepository, ServerHealthUpdate, UpstreamServer } from "./upstream-manager.js";
import type { AuthStore, LoginUser, StoredApiKey } from "./auth.js";
import { z } from "zod";

const upstreamRecordSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().min(1),
  url: z.url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }),
  enabled: z.boolean(),
  authType: z.enum(["NONE", "BEARER", "HEADER"]),
  authHeaderName: z.string().nullable(),
  encryptedCredential: z.string().nullable(),
  callTimeoutMs: z.number().int().min(1_000).max(120_000),
  status: z.enum(["CONNECTED", "UNREACHABLE", "DISABLED"]),
  cachedTools: z.unknown(),
});

export interface AuditLogInput {
  userId: string | null;
  userEmail: string;
  serverSlug: string | null;
  toolName: string;
  startedAt: Date;
  durationMs: number;
  status: "success" | "error" | "timeout" | "rejected";
  error: string | null;
  source: "mcp" | "chat";
}

export interface GatewayDataRepository extends GatewayRepository {
  ping(): Promise<void>;
  createAuditLog(input: AuditLogInput): Promise<void>;
}

export class PrismaGatewayRepository implements GatewayDataRepository, AuthStore {
  async findEnabledServers(): Promise<UpstreamServer[]> {
    const servers = await prisma.mcpServer.findMany({ where: { enabled: true } });
    return mapServers(servers);
  }

  async findServers(): Promise<UpstreamServer[]> {
    const servers = await prisma.mcpServer.findMany();
    return mapServers(servers);
  }

  async findServerBySlug(slug: string): Promise<UpstreamServer | null> {
    const server = await prisma.mcpServer.findUnique({ where: { slug } });
    return server ? upstreamRecordSchema.parse(server) : null;
  }

  async updateServerHealth(slug: string, update: ServerHealthUpdate): Promise<void> {
    await prisma.mcpServer.update({
      where: { slug },
      data: {
        status: update.status as ServerStatus,
        statusCheckedAt: update.statusCheckedAt,
        lastError: update.lastError,
        cachedTools:
          update.cachedTools === null
            ? Prisma.DbNull
            : (update.cachedTools as Prisma.InputJsonValue),
      },
    });
  }

  async ping(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  }

  async findAuthUserById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, disabledAt: true },
    });
    return user;
  }

  async findLoginUserByEmail(email: string): Promise<LoginUser | null> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        passwordHash: true,
        disabledAt: true,
      },
    });
    return user;
  }

  async findApiKeyByHash(keyHash: string): Promise<StoredApiKey | null> {
    return prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        revokedAt: true,
        user: {
          select: { id: true, email: true, role: true, disabledAt: true },
        },
      },
    });
  }

  async touchApiKey(id: string, lastUsedAt: Date): Promise<void> {
    await prisma.apiKey.update({ where: { id }, data: { lastUsedAt } });
  }

  async createAuditLog(input: AuditLogInput): Promise<void> {
    await prisma.auditLog.create({
      data: {
        ...input,
        status: input.status as AuditStatus,
        source: input.source as AuditSource,
        error: input.error?.slice(0, 1_000) ?? null,
      },
    });
  }
}

function mapServers(
  servers: Array<Parameters<typeof upstreamRecordSchema.parse>[0]>,
): UpstreamServer[] {
  const validated: UpstreamServer[] = [];
  for (const server of servers) {
    const parsed = upstreamRecordSchema.safeParse(server);
    if (!parsed.success) {
      console.error("[gateway] invalid upstream configuration skipped");
      continue;
    }
    validated.push(parsed.data);
  }
  return validated;
}
