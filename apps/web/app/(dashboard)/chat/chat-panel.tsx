"use client";

import { useState, type FormEvent } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { Bot, ChevronDown, LoaderCircle, Send, Square, User } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";

const transport = new DefaultChatTransport({
  api: "/api/chat",
  credentials: "same-origin",
});

type ToolPart = Extract<UIMessage["parts"][number], { type: "dynamic-tool" }>;

function stringify(value: unknown, limit = 1_200): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolOutputSummary(value: unknown): string {
  if (isRecord(value) && Array.isArray(value.content)) {
    const text = value.content
      .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text")
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
    if (text) return stringify(text);
  }
  return stringify(value);
}

function ToolCallCard({ part }: { part: ToolPart }) {
  const failed = part.state === "output-error" || (isRecord(part.output) && part.output.isError === true);
  const complete = part.state === "output-available" || failed;
  return (
    <details className="my-3 rounded-lg border bg-muted/30 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        <ChevronDown className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{part.toolName}</span>
        <span
          className={
            failed
              ? "text-xs text-destructive"
              : complete
                ? "text-xs text-emerald-700 dark:text-emerald-400"
                : "text-xs text-muted-foreground"
          }
        >
          {failed ? "Failed" : complete ? "Succeeded" : "Running"}
        </span>
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Arguments</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
            {stringify(part.input) || "{}"}
          </pre>
        </div>
        {complete && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {failed ? "Error" : "Result"}
            </p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
              {failed ? part.errorText ?? toolOutputSummary(part.output) : toolOutputSummary(part.output)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const { messages, status, error, sendMessage, stop, clearError } = useChat({
    transport,
  });
  const busy = status === "submitted" || status === "streaming";

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    clearError();
    await sendMessage({ text });
  }

  return (
    <Card className="mx-auto max-w-4xl overflow-hidden">
      <CardContent className="flex min-h-[520px] flex-col px-4 sm:px-6">
        <div
          className="flex-1 space-y-5 overflow-y-auto py-5"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 ? (
            <div className="flex min-h-[390px] flex-col items-center justify-center px-4 text-center">
              <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Bot className="size-6" />
              </div>
              <h2 className="text-lg font-semibold">How can I help?</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Ask about recent orders, products, or request an action. I’ll use your enabled
                workspace tools and show each tool call here.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <Message key={message.id} message={message} />
            ))
          )}
          {error && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error.message || "The chat request failed. Please try again."}
            </div>
          )}
        </div>

        <form onSubmit={(event) => void submitMessage(event)} className="border-t py-4">
          <label className="sr-only" htmlFor="chat-message">
            Message
          </label>
          <div className="flex items-end gap-2">
            <Textarea
              id="chat-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask a question or request an action…"
              rows={2}
              className="max-h-40 min-h-14 resize-y"
              disabled={busy}
            />
            {busy ? (
              <Button type="button" variant="outline" size="icon" onClick={stop} aria-label="Stop response">
                <Square className="size-4" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send message">
                <Send className="size-4" />
              </Button>
            )}
          </div>
          {status === "submitted" && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              Connecting to tools…
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Bot className="size-4" />
        </div>
      )}
      <div
        className={`min-w-0 max-w-[88%] rounded-xl px-4 py-3 ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted/60"
        }`}
      >
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium opacity-70">
          {isUser ? <User className="size-3" /> : <Bot className="size-3" />}
          {isUser ? "You" : "Assistant"}
        </p>
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <p key={`${message.id}-${index}`} className="whitespace-pre-wrap text-sm leading-6">
                {part.text}
              </p>
            );
          }
          if (part.type === "dynamic-tool") {
            return <ToolCallCard key={part.toolCallId} part={part} />;
          }
          return null;
        })}
      </div>
      {isUser && (
        <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <User className="size-4" />
        </div>
      )}
    </div>
  );
}
