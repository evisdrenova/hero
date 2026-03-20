import { useState } from "react";
import {
  MessageSquare,
  ChevronUp,
  ChevronDown,
  Send,
  Clipboard,
  Trash2,
} from "lucide-react";
import type { DiffComment } from "../../hooks/use-diff-comments";
import { buildReviewPrompt } from "./build-review-prompt";

interface ReviewBarProps {
  comments: DiffComment[];
  context: { commitSha?: string; branch?: string };
  onSendToAgent: (agent: string, prompt: string) => void;
  onClearAll: () => void;
}

export function ReviewBar({
  comments,
  context,
  onSendToAgent,
  onClearAll,
}: ReviewBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (comments.length === 0) return null;

  const fileCount = new Set(comments.map((c) => c.filePath)).size;
  const prompt = buildReviewPrompt(comments, context);

  function handleCopy() {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSend() {
    onSendToAgent("claude-code", prompt);
  }

  // Group comments by file for expanded view
  const byFile = new Map<string, DiffComment[]>();
  for (const c of comments) {
    const existing = byFile.get(c.filePath);
    if (existing) existing.push(c);
    else byFile.set(c.filePath, [c]);
  }

  return (
    <div
      className="sticky bottom-0 z-20 border-t"
      style={{
        borderColor: "var(--color-accent)",
        backgroundColor: "var(--color-bg-raised)",
      }}
    >
      {/* Expanded comment list */}
      {expanded && (
        <div className="max-h-[240px] overflow-y-auto border-b border-border-subtle px-4 py-3">
          {[...byFile.entries()].map(([filePath, fileComments]) => (
            <div key={filePath} className="mb-3 last:mb-0">
              <p className="mb-1 font-mono text-[11px] font-medium text-accent-fg">
                {filePath}
              </p>
              {fileComments
                .sort((a, b) => a.lineNumber - b.lineNumber)
                .map((c) => (
                  <div
                    key={c.id}
                    className="ml-3 flex items-baseline gap-2 py-0.5"
                  >
                    <span className="shrink-0 font-mono text-[10px] text-fg-subtle">
                      L{c.lineNumber}
                    </span>
                    <span className="text-xs text-fg-muted">{c.comment}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Bar */}
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-fg-muted transition-colors hover:text-fg"
        >
          <MessageSquare size={14} style={{ color: "var(--color-accent-fg)" }} />
          <span className="text-xs font-medium">
            {comments.length} comment{comments.length !== 1 ? "s" : ""}{" "}
            <span className="font-normal text-fg-subtle">
              across {fileCount} file{fileCount !== 1 ? "s" : ""}
            </span>
          </span>
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* Copy Prompt */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded border border-border-subtle px-2.5 py-1 text-[11px] text-fg-subtle transition-colors hover:border-fg-subtle hover:text-fg"
          >
            <Clipboard size={11} />
            {copied ? "Copied!" : "Copy Prompt"}
          </button>

          {/* Clear All */}
          <button
            onClick={onClearAll}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-fg-subtle transition-colors hover:text-red"
            title="Clear all comments"
          >
            <Trash2 size={11} />
          </button>

          {/* Send to Agent */}
          <button
            onClick={handleSend}
            className="flex items-center gap-1.5 rounded px-3 py-1 text-[11px] font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            <Send size={11} />
            Send to Agent
          </button>
        </div>
      </div>
    </div>
  );
}
