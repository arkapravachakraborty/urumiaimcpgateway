import { z } from "zod";

/**
 * Server slug per AGENTS.md:
 * "slug is lowercase [a-z0-9-], names must match ^[a-zA-Z0-9_-]{1,64}$"
 */
export const ServerSlugSchema = z
  .string()
  .min(1, "Slug is required")
  .max(64, "Slug cannot exceed 64 characters")
  .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric and dashes only");

export const ToolNameSchema = z
  .string()
  .min(1, "Tool name is required")
  .max(64, "Tool name cannot exceed 64 characters")
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, "Tool name must match ^[a-zA-Z0-9_-]{1,64}$");

export const ServerAuthTypeSchema = z.enum(["NONE", "BEARER", "HEADER"]);

export const ServerStatusSchema = z.enum(["CONNECTED", "UNREACHABLE", "DISABLED"]);

/**
 * Input for creating a new MCP server.
 * Accepts cleartext credential which the gateway will encrypt before saving.
 */
export const CreateMcpServerInputSchema = z.object({
  slug: ServerSlugSchema,
  name: z.string().min(1, "Name is required").max(100),
  url: z.string().url("Must be a valid URL"),
  enabled: z.boolean().default(true),
  authType: ServerAuthTypeSchema.default("NONE"),
  authHeaderName: z.string().min(1).max(100).optional(),
  credential: z.string().min(1).optional(),
  callTimeoutMs: z.number().int().min(1000).max(120000).default(15000),
});

/**
 * Input for updating an existing MCP server.
 */
export const UpdateMcpServerInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url("Must be a valid URL").optional(),
  enabled: z.boolean().optional(),
  authType: ServerAuthTypeSchema.optional(),
  authHeaderName: z.string().min(1).max(100).nullable().optional(),
  credential: z.string().min(1).nullable().optional(),
  callTimeoutMs: z.number().int().min(1000).max(120000).optional(),
});

/**
 * Output representation of an MCP server.
 * NEVER includes encryptedCredential or raw credential.
 */
export const McpServerOutputSchema = z.object({
  id: z.string(),
  slug: ServerSlugSchema,
  name: z.string(),
  url: z.string(),
  enabled: z.boolean(),
  authType: ServerAuthTypeSchema,
  authHeaderName: z.string().nullable(),
  hasCredential: z.boolean(),
  callTimeoutMs: z.number().int(),
  status: ServerStatusSchema,
  statusCheckedAt: z.coerce.date().nullable(),
  lastError: z.string().nullable(),
  cachedTools: z.unknown().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const McpServerListOutputSchema = z.array(McpServerOutputSchema);

export type ServerSlug = z.infer<typeof ServerSlugSchema>;
export type ToolName = z.infer<typeof ToolNameSchema>;
export type ServerAuthType = z.infer<typeof ServerAuthTypeSchema>;
export type ServerStatus = z.infer<typeof ServerStatusSchema>;
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerInputSchema>;
export type UpdateMcpServerInput = z.infer<typeof UpdateMcpServerInputSchema>;
export type McpServerOutput = z.infer<typeof McpServerOutputSchema>;
export type McpServerListOutput = z.infer<typeof McpServerListOutputSchema>;
