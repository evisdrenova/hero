import { useState, useCallback } from "react";
import {
  useEntireSettingsQuery,
  useEntireLogsQuery,
  useActiveSessionsQuery,
} from "../../hooks/use-tauri-query";
import { BranchDebugView } from "./DebugView";

interface BranchDebugContainerProps {
  repoPath: string;
  branch: string;
}

export function BranchDebugContainer({ repoPath }: BranchDebugContainerProps) {
  const [tailLines, setTailLines] = useState(500);

  const { data: settings, isLoading: settingsLoading } = useEntireSettingsQuery(repoPath);
  const { data: logs, isLoading: logsLoading } = useEntireLogsQuery(repoPath, tailLines);
  const { data: sessions, isLoading: sessionsLoading } = useActiveSessionsQuery(repoPath);

  const handleLoadMore = useCallback(() => {
    setTailLines((prev) => prev + 500);
  }, []);

  return (
    <BranchDebugView
      settings={settings ?? null}
      settingsLoading={settingsLoading}
      logs={logs ?? null}
      logsLoading={logsLoading}
      activeSessions={sessions ?? []}
      sessionsLoading={sessionsLoading}
      onLoadMore={handleLoadMore}
    />
  );
}
