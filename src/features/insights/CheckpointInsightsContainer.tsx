import { useMemo } from "react";
import { useTranscriptQuery } from "../../hooks/use-tauri-query";
import { extractInsights } from "../../lib/extract-insights";
import { InsightsView } from "./InsightsView";
import type { CheckpointSummary } from "../../lib/ipc";

interface CheckpointInsightsContainerProps {
  repoPath: string;
  checkpoint: CheckpointSummary;
}

export function CheckpointInsightsContainer({
  repoPath,
  checkpoint,
}: CheckpointInsightsContainerProps) {
  const { data: messages, isLoading } = useTranscriptQuery(
    repoPath,
    checkpoint.checkpoint_id,
    0
  );

  const insights = useMemo(() => {
    if (!messages) return [];
    return extractInsights(messages, checkpoint);
  }, [messages, checkpoint]);

  return (
    <InsightsView
      insights={insights}
      isLoading={isLoading}
      showCheckpointContext={false}
    />
  );
}
