import { Loader2, User, Bot, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranscriptQuery } from "../../hooks/use-tauri-query";
import { JsonViewer } from "../../components/JsonViewer";
import type { CheckpointSummary } from "../../lib/ipc";

interface TranscriptViewProps {
  repoPath: string;
  checkpoint: CheckpointSummary | null;
}

function isJsonString(text: string): boolean {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose-transcript">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function MessageContent({ content, toolInput }: { content: string; toolInput: string | null }) {
  if (toolInput) {
    if (isJsonString(toolInput)) {
      return <JsonViewer text={toolInput} />;
    }
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-fg-subtle">
        {toolInput}
      </pre>
    );
  }

  if (isJsonString(content)) {
    return <JsonViewer text={content} />;
  }

  return <MarkdownContent content={content} />;
}

export function TranscriptView({ repoPath, checkpoint }: TranscriptViewProps) {
  const {
    data: messages,
    isLoading,
    error,
  } = useTranscriptQuery(
    repoPath,
    checkpoint?.checkpoint_id ?? "",
    0 // First session
  );

  if (!checkpoint) {
    return (
      <div className="flex items-center justify-center p-20 text-fg-subtle">
        Select a checkpoint to view its transcript
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 size={20} className="animate-spin text-fg-subtle" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-6 text-center">
          <p className="text-sm text-fg-muted">
            Transcript not available for this checkpoint
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-6 text-center">
          <p className="text-sm text-fg-muted">No transcript data</p>
          <p className="mt-1 text-xs text-fg-subtle">
            This checkpoint may not have session data recorded
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      {/* Checkpoint header */}
      <div className="mb-4 rounded-lg border border-border-subtle bg-bg-overlay p-4">
        <h3 className="text-sm font-medium text-fg">
          {checkpoint.commit_message || checkpoint.checkpoint_id}
        </h3>
        <div className="mt-1 flex gap-3 text-xs text-fg-muted">
          <span className="font-mono">{checkpoint.commit_sha?.slice(0, 7) || checkpoint.checkpoint_id.slice(0, 7)}</span>
          <span>{checkpoint.files_touched.length} files</span>
          {checkpoint.sessions[0] && (
            <span>{checkpoint.sessions[0].agent}</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className="flex gap-3">
            {/* Role icon */}
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                msg.role === "user"
                  ? "bg-blue-bg text-blue"
                  : msg.role === "assistant"
                    ? "bg-accent-bg text-accent-fg"
                    : "bg-bg-hover text-fg-subtle"
              }`}
            >
              {msg.role === "user" ? (
                <User size={14} />
              ) : msg.role === "tool" ? (
                <Wrench size={14} />
              ) : (
                <Bot size={14} />
              )}
            </div>

            {/* Message content */}
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                {msg.role}
                {msg.tool_name && (
                  <span className="ml-2 normal-case tracking-normal text-blue">
                    {msg.tool_name}
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-border-subtle bg-bg-overlay p-3 text-[13px] leading-relaxed text-fg-muted">
                <MessageContent content={msg.content} toolInput={msg.tool_input} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
