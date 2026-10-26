import { Bot, Sparkles } from "lucide-react";
import { PageHeading } from "~/components/page-heading";
import { Card, CardContent } from "~/components/ui/card";

export default function ChatPage() {
  return (
    <div>
      <PageHeading
        eyebrow="Assistant"
        title="Chat"
        description="Ask your connected tools for help from one secure conversation."
      />
      <Card className="mx-auto max-w-3xl overflow-hidden">
        <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-8 text-center">
          <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Bot className="size-7" />
          </div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="size-4" />
            Coming in the next step
          </p>
          <h2 className="text-xl font-semibold">Your tools will be ready to chat</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            The assistant experience is being connected to your MCP servers. Once enabled, you will
            be able to ask questions and take actions using the tools available in this workspace.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
