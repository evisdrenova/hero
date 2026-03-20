import {
  useRawCheckpointMetadataQuery,
  useRawSessionFileQuery,
  useCheckpointLogsQuery,
} from "../../hooks/use-tauri-query";
import { CheckpointDebugView } from "./DebugView";
import type { CheckpointSummary } from "../../lib/ipc";

interface CheckpointDebugContainerProps {
  repoPath: string;
  checkpoint: CheckpointSummary;
}

/** Hook wrapper to fetch a single session file — must be called at top level */
function useSessionFile(repoPath: string, sessionId: string) {
  const { data, isLoading } = useRawSessionFileQuery(repoPath, sessionId);
  return { sessionId, content: data ?? null, loading: isLoading };
}

export function CheckpointDebugContainer({
  repoPath,
  checkpoint,
}: CheckpointDebugContainerProps) {
  const { data: rawMetadata, isLoading: metadataLoading } = useRawCheckpointMetadataQuery(
    repoPath,
    checkpoint.checkpoint_id
  );

  // Fetch raw session files for each session in the checkpoint
  // We use individual hooks to satisfy React's rules of hooks (stable call count)
  // by always calling for up to 4 session slots
  const sessionIds = checkpoint.sessions.map((s) => s.session_id);
  const s0 = useSessionFile(repoPath, sessionIds[0] ?? "");
  const s1 = useSessionFile(repoPath, sessionIds[1] ?? "");
  const s2 = useSessionFile(repoPath, sessionIds[2] ?? "");
  const s3 = useSessionFile(repoPath, sessionIds[3] ?? "");

  const rawSessionFiles = [s0, s1, s2, s3]
    .slice(0, sessionIds.length)
    .filter((sf) => sf.sessionId !== "");

  const { data: checkpointLogs, isLoading: logsLoading } = useCheckpointLogsQuery(
    repoPath,
    checkpoint.checkpoint_id,
    sessionIds
  );

  return (
    <CheckpointDebugView
      rawCheckpointMetadata={rawMetadata ?? null}
      rawCheckpointMetadataLoading={metadataLoading}
      rawSessionFiles={rawSessionFiles}
      checkpointLogs={checkpointLogs ?? null}
      checkpointLogsLoading={logsLoading}
    />
  );
}
