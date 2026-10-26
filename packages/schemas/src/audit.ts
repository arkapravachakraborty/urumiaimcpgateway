import { z } from "zod";

export const AuditStatusSchema = z.enum(["success", "error", "timeout", "rejected"]);

export const AuditSourceSchema = z.enum(["mcp", "chat"]);

/**
 * Query filter schema for retrieving audit logs.
 */
export const AuditLogFilterInputSchema = z.object({
  userId: z.string().optional(),
  userEmail: z.string().optional(),
  serverSlug: z.string().optional(),
  toolName: z.string().optional(),
  status: AuditStatusSchema.optional(),
  source: AuditSourceSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

/**
 * Output representation of an audit log entry.
 */
export const AuditLogOutputSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  userEmail: z.string(),
  serverSlug: z.string().nullable(),
  toolName: z.string(),
  startedAt: z.coerce.date(),
  durationMs: z.number().int(),
  status: AuditStatusSchema,
  error: z.string().nullable(),
  source: AuditSourceSchema,
});

export const AuditLogListOutputSchema = z.object({
  items: z.array(AuditLogOutputSchema),
  nextCursor: z.string().nullable().optional(),
  total: z.number().int().optional(),
});

export type AuditStatus = z.infer<typeof AuditStatusSchema>;
export type AuditSource = z.infer<typeof AuditSourceSchema>;
export type AuditLogFilterInput = z.infer<typeof AuditLogFilterInputSchema>;
export type AuditLogOutput = z.infer<typeof AuditLogOutputSchema>;
export type AuditLogListOutput = z.infer<typeof AuditLogListOutputSchema>;
