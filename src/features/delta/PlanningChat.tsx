import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Square, ShieldCheck, ShieldX } from "lucide-react";
import type { PermissionRequest } from "../chat/stream-json";
import { PromptInputBox } from "../../components/ui/ai-prompt-box";

export interface PlanningMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface PlanningChatProps {
  messages: PlanningMessage[];
  pendingText: string;
  isStreaming: boolean;
  agentActivity: string | null;
  streamingStartedAt: number | null;
  pendingPermission: PermissionRequest | null;
  onPermissionResponse: (requestId: string, allow: boolean) => void;
  onSendMessage: (message: string) => void;
  onStopAgent: () => void;
}

export function PlanningChat({
  messages,
  pendingText,
  isStreaming,
  agentActivity,
  streamingStartedAt,
  pendingPermission,
  onPermissionResponse,
  onSendMessage,
  onStopAgent,
}: PlanningChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pendingText]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && !pendingText && !isStreaming && (
          <p className="py-8 text-center text-xs text-fg-subtle">
            Describe your feature to start planning...
          </p>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === "user" ? "ml-12" : ""}>
            {msg.role === "user" ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-accent/10 px-3 py-2 text-[13px] leading-relaxed text-fg">
                  {msg.content}
                </div>
              </div>
            ) : (
              <AssistantMessage content={msg.content} />
            )}
          </div>
        ))}

        {pendingText && (
          <div>
            <AssistantMessage content={pendingText} />
          </div>
        )}

        {isStreaming && !pendingText && !pendingPermission && (
          <ActivityIndicator activity={agentActivity} startedAt={streamingStartedAt} />
        )}

        {pendingPermission && (
          <PermissionPrompt
            permission={pendingPermission}
            onAllow={() => onPermissionResponse(pendingPermission.requestId, true)}
            onDeny={() => onPermissionResponse(pendingPermission.requestId, false)}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Streaming status bar + stop button */}
      {isStreaming && (
        <div className="flex items-center justify-between border-t border-border-subtle px-4 py-1.5">
          <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span>{agentActivity ?? "Planning agent is responding..."}</span>
            {streamingStartedAt && <ElapsedTimer startedAt={streamingStartedAt} />}
          </div>
          <button
            onClick={onStopAgent}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-red hover:bg-red/10"
            title="Stop agent"
          >
            <Square size={10} fill="currentColor" />
            Stop
          </button>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 px-3 py-2">
        <PromptInputBox
          onSend={(message) => {
            if (message.trim() && !isStreaming) {
              onSendMessage(message.trim());
            }
          }}
          isLoading={isStreaming}
          placeholder={isStreaming ? "Waiting for response..." : "Describe your feature or answer questions..."}
        />
      </div>
    </div>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const display = minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;

  return <span className="text-fg-faint">{display}</span>;
}

function ActivityIndicator({ activity, startedAt }: { activity: string | null; startedAt: number | null }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-raised px-4 py-3">
      <div className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
      </div>
      <span className="text-xs text-fg-subtle">
        {activity ?? "Planning agent is thinking..."}
      </span>
      {startedAt && <ElapsedTimer startedAt={startedAt} />}
    </div>
  );
}

function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="planning-markdown max-w-none text-[13px] leading-relaxed text-fg [&_p]:mb-3 [&_p]:last:mb-0 [&_ul]:mb-3 [&_ul]:ml-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ol]:mb-3 [&_ol]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_li]:text-fg-muted [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-fg [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-fg [&_h3]:mb-1.5 [&_h3]:mt-2 [&_h3]:text-[13px] [&_h3]:font-medium [&_h3]:text-fg [&_strong]:font-semibold [&_strong]:text-fg [&_em]:italic [&_em]:text-fg-muted [&_code]:rounded [&_code]:bg-bg-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:text-accent [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-bg-hover [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:border-accent/30 [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted [&_hr]:my-4 [&_hr]:border-border-subtle">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PermissionPrompt({
  permission,
  onAllow,
  onDeny,
}: {
  permission: PermissionRequest;
  onAllow: () => void;
  onDeny: () => void;
}) {
  // Build a human-readable summary of what the tool wants to do
  const description = formatPermissionDescription(permission.toolName, permission.input);

  return (
    <div className="rounded-lg border border-yellow/30 bg-yellow/5 px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <ShieldCheck size={14} className="text-yellow" />
        Permission requested
      </div>
      <p className="text-xs text-fg-muted">
        The agent wants to use <span className="font-semibold text-fg">{permission.toolName}</span>
      </p>
      {description && (
        <pre className="overflow-x-auto rounded bg-bg-hover px-3 py-2 text-[11px] text-fg-muted">
          {description}
        </pre>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onAllow}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        >
          <ShieldCheck size={12} />
          Allow
        </button>
        <button
          onClick={onDeny}
          className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-hover"
        >
          <ShieldX size={12} />
          Deny
        </button>
      </div>
    </div>
  );
}

function formatPermissionDescription(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return (input.command as string) ?? "";
    case "Write":
    case "Read":
      return (input.file_path as string) ?? "";
    case "Edit":
      return (input.file_path as string) ?? "";
    case "Glob":
      return (input.pattern as string) ?? "";
    case "Grep":
      return `${(input.pattern as string) ?? ""} ${(input.path as string) ?? ""}`.trim();
    default:
      return JSON.stringify(input, null, 2);
  }
}
