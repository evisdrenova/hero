import { Loader2, GitCommit, Lightbulb } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Insight } from "../../lib/extract-insights";

interface InsightsViewProps {
  insights: Insight[];
  isLoading: boolean;
  showCheckpointContext: boolean;
  loadingProgress?: string;
}

export function InsightsView({
  insights,
  isLoading,
  showCheckpointContext,
  loadingProgress,
}: InsightsViewProps) {
  if (isLoading && insights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-20">
        <Loader2 size={20} className="animate-spin text-fg-subtle" />
        {loadingProgress && (
          <span className="text-xs text-fg-subtle">{loadingProgress}</span>
        )}
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-6 text-center">
          <p className="text-sm text-fg-muted">No insights found</p>
          <p className="mt-1 text-xs text-fg-subtle">
            Insights are educational snippets marked with ★ in transcripts
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      {loadingProgress && (
        <div className="mb-3 flex items-center gap-2 text-xs text-fg-subtle">
          <Loader2 size={12} className="animate-spin" />
          {loadingProgress}
        </div>
      )}
      <div className="space-y-3">
        {insights.map((insight, i) => (
          <div
            key={`${insight.checkpointId}-${i}`}
            className="rounded-lg border border-border-subtle bg-bg-overlay p-4"
          >
            {showCheckpointContext && (
              <div className="mb-2 flex items-center gap-2 text-xs text-fg-subtle">
                <GitCommit size={12} />
                <span className="font-mono text-accent-fg">
                  {insight.commitSha
                    ? insight.commitSha.slice(0, 7)
                    : insight.checkpointId.slice(0, 7)}
                </span>
                <span className="truncate text-fg-muted">
                  {insight.commitMessage || "Untitled"}
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <Lightbulb
                size={14}
                className="mt-0.5 shrink-0 text-yellow"
              />
              <div className="prose-transcript min-w-0 flex-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {insight.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
