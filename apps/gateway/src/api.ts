import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { initTRPC, TRPCError } from "@trpc/server";
import {
  AdminCreateMemberInputSchema,
  AdminCreateMemberOutputSchema,
  ApiKeyListOutputSchema,
  AuditLogFilterInputSchema,
  AuditLogListOutputSchema,
  CreateApiKeyInputSchema,
  CreateApiKeyOutputSchema,
  CreateMcpServerInputSchema,
  LoginOutputSchema,
  McpServerListOutputSchema,
  McpServerOutputSchema,
  MemberListOutputSchema,
  RemoveServerInputSchema,
  SetServerEnabledInputSchema,
  TestServerConnectionOutputSchema,
  UpdateMcpServerInputSchema,
} from "@repo/schemas";
import {
  AuditSource,
  AuditStatus,
  Prisma,
  prisma,
  Role,
  ServerAuthType,
  ServerStatus,
} from "@repo/db";
import { z } from "zod";
import type { AuthenticatedUser } from "./auth.js";
import { hashApiKey } from "./auth.js";
import { encryptCredential } from "./crypto.js";
import type { GatewayDataRepository } from "./repository.js";
import type { UpstreamManager } from "./upstream-manager.js";

export interface ApiContext {
  user: AuthenticatedUser | null;
}

export interface ApiRouterOptions {
  repository: GatewayDataRepository;
  upstreamManager: UpstreamManager;
  encryptionKey: Buffer;
}

const t = initTRPC.context<ApiContext>().create();
const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required." });
  }
  return next({ ctx: { user: ctx.user } });
});
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Administrator access required." });
  }
  return next({ ctx: { user: ctx.user } });
});

export function createApiRouter(options: ApiRouterOptions) {
  return t.router({
    servers: t.router({
      list: adminProcedure.output(McpServerListOutputSchema).query(async () => {
        const records = await prisma.mcpServer.findMany({ orderBy: { slug: "asc" } });
        return records.map(toServerOutput);
      }),
      create: adminProcedure
        .input(CreateMcpServerInputSchema)
        .output(McpServerOutputSchema)
        .mutation(async ({ input }) => {
          if (input.authType !== "NONE" && !input.credential) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A credential is required for this authentication type.",
            });
          }
          const server = await prisma.mcpServer.create({
            data: {
              slug: input.slug,
              name: input.name,
              url: input.url,
              enabled: input.enabled,
              authType: input.authType as ServerAuthType,
              authHeaderName: input.authHeaderName ?? null,
              encryptedCredential: input.credential
                ? encryptCredential(input.credential, options.encryptionKey)
                : null,
              callTimeoutMs: input.callTimeoutMs,
              status: ServerStatus.DISABLED,
            },
          });
          return toServerOutput(server);
        }),
      update: adminProcedure
        .input(
          z.object({
            slug: z.string().min(1).max(64),
            data: UpdateMcpServerInputSchema,
          }),
        )
        .output(McpServerOutputSchema)
        .mutation(async ({ input }) => {
          const existing = await prisma.mcpServer.findUnique({
            where: { slug: input.slug },
            select: {
              authType: true,
              authHeaderName: true,
              encryptedCredential: true,
            },
          });
          if (!existing) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
          }
          const data: Prisma.McpServerUpdateInput = {};
          const update = input.data;
          const nextAuthType = update.authType ?? existing.authType;
          const nextCredential =
            update.credential === undefined
              ? existing.encryptedCredential
              : update.credential
                ? encryptCredential(update.credential, options.encryptionKey)
                : null;
          const nextHeaderName =
            update.authHeaderName === undefined ? existing.authHeaderName : update.authHeaderName;
          if (nextAuthType !== "NONE" && !nextCredential) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A credential is required for this authentication type.",
            });
          }
          if (nextAuthType === "HEADER" && !nextHeaderName) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A header name is required for header authentication.",
            });
          }
          if (update.name !== undefined) data.name = update.name;
          if (update.url !== undefined) data.url = update.url;
          if (update.enabled !== undefined) data.enabled = update.enabled;
          data.authType = nextAuthType as ServerAuthType;
          if (update.authHeaderName !== undefined) data.authHeaderName = update.authHeaderName;
          data.encryptedCredential = nextAuthType === "NONE" ? null : nextCredential;
          if (update.callTimeoutMs !== undefined) data.callTimeoutMs = update.callTimeoutMs;
          data.status = ServerStatus.DISABLED;
          data.statusCheckedAt = null;
          data.lastError = null;
          data.cachedTools = Prisma.DbNull;
          const server = await prisma.mcpServer.update({
            where: { slug: input.slug },
            data,
          });
          return toServerOutput(server);
        }),
      setEnabled: adminProcedure
        .input(SetServerEnabledInputSchema)
        .output(McpServerOutputSchema)
        .mutation(async ({ input }) => {
          const server = await prisma.mcpServer.update({
            where: { slug: input.slug },
            data: {
              enabled: input.enabled,
              status: ServerStatus.DISABLED,
              statusCheckedAt: null,
              lastError: null,
            },
          });
          return toServerOutput(server);
        }),
      remove: adminProcedure
        .input(RemoveServerInputSchema)
        .output(z.object({ success: z.literal(true) }))
        .mutation(async ({ input }) => {
          await prisma.mcpServer.delete({ where: { slug: input.slug } });
          return { success: true as const };
        }),
      testConnection: adminProcedure
        .input(RemoveServerInputSchema)
        .output(TestServerConnectionOutputSchema)
        .mutation(async ({ input }) => {
          const server = await options.repository.findServerBySlug(input.slug);
          if (!server) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
          try {
            const tools = await options.upstreamManager.checkServer(server);
            await options.repository.updateServerHealth(input.slug, {
              status: "CONNECTED",
              statusCheckedAt: new Date(),
              lastError: null,
              cachedTools: tools,
            });
            return { connected: true, toolCount: tools.length, error: null };
          } catch (error) {
            const message =
              error instanceof Error && error.name === "UpstreamTimeoutError"
                ? error.message.slice(0, 200)
                : "Connection failed.";
            await options.repository.updateServerHealth(input.slug, {
              status: "UNREACHABLE",
              statusCheckedAt: new Date(),
              lastError: message,
              cachedTools: null,
            });
            return { connected: false, toolCount: 0, error: message };
          }
        }),
    }),
    members: t.router({
      list: adminProcedure.output(MemberListOutputSchema).query(async () => {
        const members = await prisma.user.findMany({
          select: { id: true, email: true, role: true, createdAt: true, disabledAt: true },
          orderBy: { createdAt: "asc" },
        });
        return members;
      }),
      create: adminProcedure
        .input(AdminCreateMemberInputSchema)
        .output(AdminCreateMemberOutputSchema)
        .mutation(async ({ input }) => {
          const temporaryPassword = randomBytes(18).toString("base64url");
          const passwordHash = await bcrypt.hash(temporaryPassword, 12);
          const member = await prisma.user.create({
            data: {
              email: input.email.trim().toLowerCase(),
              role: input.role as Role,
              passwordHash,
            },
            select: { id: true, email: true, role: true, createdAt: true, disabledAt: true },
          });
          return { member, temporaryPassword };
        }),
      disable: adminProcedure
        .input(z.object({ userId: z.string().min(1) }))
        .output(z.object({ success: z.literal(true) }))
        .mutation(async ({ input }) => {
          await prisma.user.update({
            where: { id: input.userId },
            data: { disabledAt: new Date() },
          });
          return { success: true as const };
        }),
    }),
    keys: t.router({
      create: protectedProcedure
        .input(CreateApiKeyInputSchema)
        .output(CreateApiKeyOutputSchema)
        .mutation(async ({ ctx, input }) => {
          const key = `mcpgw_${randomBytes(32).toString("base64url")}`;
          const prefix = key.slice(0, 14);
          const record = await prisma.apiKey.create({
            data: {
              userId: ctx.user.id,
              name: input.name,
              prefix,
              keyHash: hashApiKey(key),
            },
            select: { id: true, userId: true, name: true, prefix: true, createdAt: true },
          });
          return { ...record, key };
        }),
      listMine: protectedProcedure.output(ApiKeyListOutputSchema).query(async ({ ctx }) => {
        const keys = await prisma.apiKey.findMany({
          where: { userId: ctx.user.id },
          select: {
            id: true,
            userId: true,
            name: true,
            prefix: true,
            createdAt: true,
            lastUsedAt: true,
            revokedAt: true,
          },
          orderBy: { createdAt: "desc" },
        });
        return keys;
      }),
      revoke: protectedProcedure
        .input(z.object({ id: z.string().min(1) }))
        .output(z.object({ success: z.literal(true) }))
        .mutation(async ({ ctx, input }) => {
          const result = await prisma.apiKey.updateMany({
            where: { id: input.id, userId: ctx.user.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          if (!result.count) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found." });
          return { success: true as const };
        }),
      listAll: adminProcedure
        .input(z.object({ userId: z.string().optional() }).optional())
        .output(ApiKeyListOutputSchema)
        .query(async ({ input }) => {
          return prisma.apiKey.findMany({
            where: input?.userId ? { userId: input.userId } : undefined,
            select: {
              id: true,
              userId: true,
              name: true,
              prefix: true,
              createdAt: true,
              lastUsedAt: true,
              revokedAt: true,
            },
            orderBy: { createdAt: "desc" },
          });
        }),
      revokeAny: adminProcedure
        .input(z.object({ id: z.string().min(1) }))
        .output(z.object({ success: z.literal(true) }))
        .mutation(async ({ input }) => {
          const result = await prisma.apiKey.updateMany({
            where: { id: input.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          if (!result.count) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found." });
          return { success: true as const };
        }),
    }),
    audit: t.router({
      list: protectedProcedure
        .input(AuditLogFilterInputSchema)
        .output(AuditLogListOutputSchema)
        .query(async ({ ctx, input }) => {
          const where = {
            userId: ctx.user.role === "ADMIN" ? input.userId : ctx.user.id,
            userEmail: input.userEmail
              ? { contains: input.userEmail, mode: "insensitive" as const }
              : undefined,
            serverSlug: input.serverSlug
              ? { contains: input.serverSlug, mode: "insensitive" as const }
              : undefined,
            toolName: input.toolName
              ? { contains: input.toolName, mode: "insensitive" as const }
              : undefined,
            status: input.status as AuditStatus | undefined,
            source: input.source as AuditSource | undefined,
            startedAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined,
          };
          const rows = await prisma.auditLog.findMany({
            where,
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            take: input.limit + 1,
            ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          });
          const hasMore = rows.length > input.limit;
          const items = rows.slice(0, input.limit);
          return {
            items,
            nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
          };
        }),
    }),
    auth: t.router({
      me: protectedProcedure.output(LoginOutputSchema).query(({ ctx }) => ctx.user),
    }),
  });
}

export type AppRouter = ReturnType<typeof createApiRouter>;

export function toServerOutput(server: {
  id: string;
  slug: string;
  name: string;
  url: string;
  enabled: boolean;
  authType: string;
  authHeaderName: string | null;
  encryptedCredential: string | null;
  callTimeoutMs: number;
  status: string;
  statusCheckedAt: Date | null;
  lastError: string | null;
  cachedTools: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return McpServerOutputSchema.parse({
    id: server.id,
    slug: server.slug,
    name: server.name,
    url: redactServerUrl(server.url),
    enabled: server.enabled,
    authType: server.authType,
    authHeaderName: server.authHeaderName,
    hasCredential: server.encryptedCredential !== null,
    callTimeoutMs: server.callTimeoutMs,
    status: server.status,
    statusCheckedAt: server.statusCheckedAt,
    lastError: server.lastError ? "Connection failed." : null,
    tools: server.cachedTools,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  });
}

function redactServerUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
