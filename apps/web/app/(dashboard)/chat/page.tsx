import { PageHeading } from "~/components/page-heading";
import { ChatPanel } from "./chat-panel";

export default function ChatPage() {
  return (
    <div>
      <PageHeading
        eyebrow="Assistant"
        title="Chat"
        description="Ask questions or take action using the tools available to your account."
      />
      <ChatPanel />
    </div>
  );
}
