import type { TranscriptMessage, CheckpointSummary } from "./ipc";

export interface Insight {
  content: string;
  checkpointId: string;
  commitMessage: string;
  commitSha: string;
  timestamp: string | null;
}

const INSIGHT_REGEX = /`?★\s*Insight\s*─+`?\s*\n([\s\S]*?)\n`?─{5,}`?/g;

export function extractInsights(
  messages: TranscriptMessage[],
  checkpoint: CheckpointSummary
): Insight[] {
  const insights: Insight[] = [];

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;

    let match: RegExpExecArray | null;
    INSIGHT_REGEX.lastIndex = 0;
    while ((match = INSIGHT_REGEX.exec(msg.content)) !== null) {
      insights.push({
        content: match[1].trim(),
        checkpointId: checkpoint.checkpoint_id,
        commitMessage: checkpoint.commit_message,
        commitSha: checkpoint.commit_sha,
        timestamp: msg.timestamp,
      });
    }
  }

  return insights;
}
