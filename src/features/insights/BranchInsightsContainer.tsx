import { useMemo } from "react";
import { useBranchTranscriptsQuery } from "../../hooks/use-tauri-query";
import { extractInsights } from "../../lib/extract-insights";
import { InsightsView } from "./InsightsView";
import type { Insight } from "../../lib/extract-insights";

interface BranchInsightsContainerProps {
  repoPath: string;
  branch: string;
}

export function BranchInsightsContainer({
  repoPath,
  branch,
}: BranchInsightsContainerProps) {
  const { checkpoints, queries } = useBranchTranscriptsQuery(
    repoPath,
    branch,
    true
  );

  const loadedCount = queries.filter((q) => q.isSuccess).length;
  const totalCount = checkpoints.length;
  const isLoading = queries.some((q) => q.isLoading);

  const insights = useMemo<Insight[]>(() => {
    const all: Insight[] = [];
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      if (q.data && checkpoints[i]) {
        all.push(...extractInsights(q.data, checkpoints[i]));
      }
    }
    return all;
  }, [queries, checkpoints]);

  const loadingProgress =
    isLoading && totalCount > 0
      ? `Loaded insights from ${loadedCount}/${totalCount} checkpoints`
      : undefined;

  return (
    <InsightsView
      insights={insights}
      isLoading={isLoading && insights.length === 0}
      showCheckpointContext={true}
      loadingProgress={loadingProgress}
    />
  );
}
