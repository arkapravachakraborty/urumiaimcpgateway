import { z } from "zod";
import { ServerSlugSchema } from "./server.js";

export const ChatMessageRoleSchema = z.enum(["user", "assistant", "system", "data"]);

/**
 * Chat message schema.
 */
export const ChatMessageSchema = z.object({
  id: z.string().optional(),
  role: ChatMessageRoleSchema,
  content: z.string(),
  createdAt: z.coerce.date().optional(),
});

/**
 * Payload for POST /api/chat.
 */
export const ChatInputSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1, "At least one message is required"),
  serverSlugs: z.array(ServerSlugSchema).optional(),
});

export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatInput = z.infer<typeof ChatInputSchema>;
