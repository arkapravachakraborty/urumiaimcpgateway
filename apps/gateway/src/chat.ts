import { createMCPClient } from "@ai-sdk/mcp";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { once } from "node:events";
import {
  convertToModelMessages,
  isStepCount,
  streamText,
  validateUIMessages,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { createInternalToken, readSessionCookie, resolveSessionUser } from "./auth.js";
import type { AuthStore } from "./auth.js";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.custom<UIMessage>((message): message is UIMessage => {
        if (typeof message !== "object" || message === null || Array.isArray(message)) {
          return false;
        }
        const candidate = Object.fromEntries(Object.entries(message));
        return (
          typeof candidate.id === "string" &&
          (candidate.role === "user" || candidate.role === "assistant") &&
          Array.isArray(candidate.parts)
        );
      }),
    )
    .min(1)
    .max(40),
}).strict();

const chatConfigSchema = z
  .object({
    LLM_PROVIDER: z.enum(["google", "openai-compatible"]).default("google"),
    LLM_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().trim().min(1).optional(),
    LLM_BASE_URL: z
      .string()
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
      .optional(),
    GATEWAY_INTERNAL_URL: z
      .string()
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
      .optional(),
  })
  .superRefine((config, context) => {
    if (config.LLM_PROVIDER === "google" && !config.LLM_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["LLM_API_KEY"],
        message: "LLM_API_KEY is required for the Google provider.",
      });
    }
    if (config.LLM_PROVIDER === "openai-compatible" && !config.LLM_BASE_URL) {
      context.addIssue({
        code: "custom",
        path: ["LLM_BASE_URL"],
        message: "LLM_BASE_URL is required for an OpenAI-compatible provider.",
      });
    }
  });

export interface ChatRouteOptions {
  authStore: AuthStore;
  sessionSecret: Uint8Array;
  modelFactory?: (config: z.infer<typeof chatConfigSchema>) => LanguageModel;
}

export function registerChatRoute(app: Express, options: ChatRouteOptions): void {
  app.post("/api/chat", async (request: Request, response: Response) => {
    const user = await resolveSessionUser(
      readSessionCookie(request.headers.cookie),
      options.sessionSecret,
      options.authStore,
    );
    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const parsedBody = chatRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({ error: "Invalid chat messages." });
      return;
    }

    const config = chatConfigSchema.safeParse(process.env);
    if (!config.success) {
      response.status(503).json({ error: "Chat provider is not configured." });
      return;
    }

    const serverUrl =
      config.data.GATEWAY_INTERNAL_URL ??
      (typeof request.app.locals.gatewayMcpUrl === "string"
        ? request.app.locals.gatewayMcpUrl
        : `http://127.0.0.1:${process.env.GATEWAY_PORT ?? "4000"}/mcp`);
    let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
    try {
      const internalToken = await createInternalToken(user.id, options.sessionSecret, "chat");
      client = await createMCPClient({
        transport: {
          type: "http",
          url: serverUrl,
          headers: { Authorization: `Bearer ${internalToken}` },
        },
        clientName: "team-gateway-chat",
        maxRetries: 0,
      });

      const tools = await client.tools();
      let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
      try {
        const messages = await validateUIMessages({
          messages: parsedBody.data.messages,
          tools,
        });
        modelMessages = await convertToModelMessages(messages, { tools });
      } catch {
        await client.close();
        client = undefined;
        response.status(400).json({ error: "Invalid chat messages." });
        return;
      }
      const model = options.modelFactory
        ? options.modelFactory(config.data)
        : createChatModel(config.data);

      const abortController = new AbortController();
      response.once("close", () => {
        if (!response.writableEnded) abortController.abort();
      });
      const result = streamText({
        model,
        system:
          `You are the team's WooCommerce and workspace assistant. ` +
          `Use available tools to answer store questions and to perform requested actions. ` +
          `Today's date is ${new Date().toISOString().slice(0, 10)}; use it when interpreting "today". ` +
          `Summarize tool results concisely and never claim an action succeeded unless its tool succeeded.`,
        messages: modelMessages,
        tools,
        stopWhen: isStepCount(8),
        abortSignal: abortController.signal,
        telemetry: { isEnabled: false },
      });
      const streamResponse = result.toUIMessageStreamResponse({
        headers: { "Cache-Control": "no-store" },
        onError: () => "Chat generation failed.",
      });
      response.status(streamResponse.status);
      streamResponse.headers.forEach((value, key) => response.setHeader(key, value));
      if (!streamResponse.body) {
        response.end();
        await client.close();
        return;
      }
      const reader = streamResponse.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!response.write(Buffer.from(value))) await once(response, "drain");
        }
        response.end();
      } finally {
        reader.releaseLock();
        await client.close();
      }
    } catch (error) {
      await client?.close().catch(() => undefined);
      console.error(
        "[gateway] chat request failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      if (!response.headersSent) {
        response.status(503).json({ error: "Chat request could not be started." });
      } else if (!response.destroyed) {
        response.destroy();
      }
    }
  });
}

function createChatModel(config: z.infer<typeof chatConfigSchema>): LanguageModel {
  const modelId =
    config.LLM_MODEL ?? (config.LLM_PROVIDER === "google" ? "gemini-2.5-flash" : "gpt-4o-mini");
  if (config.LLM_PROVIDER === "google") {
    const apiKey = config.LLM_API_KEY;
    if (!apiKey) throw new Error("Google provider API key is missing.");
    return createGoogleGenerativeAI({ apiKey })(modelId);
  }
  const baseURL = config.LLM_BASE_URL;
  if (!baseURL) throw new Error("OpenAI-compatible provider URL is missing.");
  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL,
    ...(config.LLM_API_KEY ? { apiKey: config.LLM_API_KEY } : {}),
  }).chatModel(modelId);
}
