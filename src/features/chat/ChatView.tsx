import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatSession } from "./chat-session";

interface ChatViewProps {
  session: ChatSession | null;
}

export function ChatView({ session }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, session?.pendingText]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-fg-subtle text-sm">
        Type a task for Claude...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-3">
      {session.messages.map((msg) => (
        <div key={msg.id} className={`mb-4 ${msg.role === "user" ? "ml-8" : "mr-8"}`}>
          {msg.role === "user" ? (
            <div className="rounded-lg bg-bg-hover px-3 py-2 text-[13px] text-fg-muted">
              {msg.content}
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none text-[13px] text-fg">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      ))}

      {session.pendingText && (
        <div className="mb-4 mr-8">
          <div className="prose prose-invert prose-sm max-w-none text-[13px] text-fg">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {session.pendingText}
            </ReactMarkdown>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
