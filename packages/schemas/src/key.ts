import { z } from "zod";

/**
 * Input for generating a new API key.
 */
export const CreateApiKeyInputSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

/**
 * Output returned ONCE upon key creation.
 * Contains the raw secret key that must be copied immediately.
 */
export const CreateApiKeyOutputSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  prefix: z.string(),
  key: z.string(),
  createdAt: z.coerce.date(),
});

/**
 * Output representation of an API key for listing/display.
 * NEVER includes keyHash or the full plaintext key.
 */
export const ApiKeyOutputSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.coerce.date(),
  lastUsedAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
});

export const ApiKeyListOutputSchema = z.array(ApiKeyOutputSchema);

export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;
export type CreateApiKeyOutput = z.infer<typeof CreateApiKeyOutputSchema>;
export type ApiKeyOutput = z.infer<typeof ApiKeyOutputSchema>;
export type ApiKeyListOutput = z.infer<typeof ApiKeyListOutputSchema>;
