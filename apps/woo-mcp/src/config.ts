import { z } from "zod";

const hostHeaderSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/[\r\n/?#\s]/.test(value), "Must be a valid HTTP Host value.");

const wooConfigSchema = z.object({
  WC_BASE_URL: z
    .string()
    .trim()
    .url()
    .superRefine((value, context) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return;
      }
      if (!["http:", "https:"].includes(url.protocol)) {
        context.addIssue({ code: "custom", message: "Must use HTTP or HTTPS." });
      }
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        context.addIssue({
          code: "custom",
          message: "Must be a store origin without credentials, path, query, or fragment.",
        });
      }
    })
    .transform((value) => value.replace(/\/+$/, "")),
  WC_PUBLIC_HOST: hostHeaderSchema.optional(),
  WC_CONSUMER_KEY: z.string().min(1),
  WC_CONSUMER_SECRET: z.string().min(1),
  MCP_AUTH_TOKEN: z.string().min(1).optional(),
});

export type WooConfig = z.infer<typeof wooConfigSchema>;

export function parseWooConfig(env: NodeJS.ProcessEnv = process.env): WooConfig {
  return wooConfigSchema.parse({
    WC_BASE_URL: env.WC_BASE_URL,
    WC_PUBLIC_HOST: env.WC_PUBLIC_HOST,
    WC_CONSUMER_KEY: env.WC_CONSUMER_KEY,
    WC_CONSUMER_SECRET: env.WC_CONSUMER_SECRET,
    MCP_AUTH_TOKEN: env.MCP_AUTH_TOKEN,
  });
}
