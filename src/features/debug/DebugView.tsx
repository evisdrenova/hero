import { Loader2, ChevronDown } from "lucide-react";
import { JsonViewer } from "../../components/JsonViewer";
import type { EntireSettings, EntireLogResult, SessionState } from "../../lib/ipc";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer items-center gap-2 py-2 text-xs font-semibold uppercase tracking-wider text-fg-muted select-none">
        <ChevronDown
          size={12}
          className="transition-transform group-[[open]]:rotate-0 -rotate-90"
        />
        {title}
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center gap-2 py-4 text-xs text-fg-subtle">
      <Loader2 size={14} className="animate-spin" />
      Loading...
    </div>
  );
}

// --- Checkpoint-level Debug View ---

interface CheckpointDebugViewProps {
  rawCheckpointMetadata: string | null;
  rawCheckpointMetadataLoading: boolean;
  rawSessionFiles: Array<{ sessionId: string; content: string | null; loading: boolean }>;
  checkpointLogs: EntireLogResult | null;
  checkpointLogsLoading: boolean;
}

export function CheckpointDebugView({
  rawCheckpointMetadata,
  rawCheckpointMetadataLoading,
  rawSessionFiles,
  checkpointLogs,
  checkpointLogsLoading,
}: CheckpointDebugViewProps) {
  return (
    <div className="px-5 py-4 space-y-2">
      <Section title="Raw Checkpoint Metadata">
        {rawCheckpointMetadataLoading ? (
          <LoadingBlock />
        ) : rawCheckpointMetadata ? (
          <div className="rounded-lg border border-border-subtle bg-bg-overlay p-3">
            <JsonViewer text={rawCheckpointMetadata} />
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">No metadata available</p>
        )}
      </Section>

      {rawSessionFiles.length > 0 && (
        <Section title="Raw Session Files">
          <div className="space-y-3">
            {rawSessionFiles.map((sf) => (
              <div key={sf.sessionId}>
                <div className="mb-1 font-mono text-[10px] text-fg-subtle">
                  {sf.sessionId}
                </div>
                {sf.loading ? (
                  <LoadingBlock />
                ) : sf.content ? (
                  <div className="rounded-lg border border-border-subtle bg-bg-overlay p-3">
                    <JsonViewer text={sf.content} />
                  </div>
                ) : (
                  <p className="text-xs text-fg-subtle">Session file not found</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Logs">
        {checkpointLogsLoading ? (
          <LoadingBlock />
        ) : checkpointLogs && checkpointLogs.lines.length > 0 ? (
          <div>
            <div className="mb-2 text-[10px] text-fg-subtle">
              {checkpointLogs.lines.length} matching log entries
            </div>
            <div className="max-h-[400px] overflow-y-auto rounded-lg border border-border-subtle bg-bg-overlay p-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-muted">
                {checkpointLogs.lines.join("\n")}
              </pre>
            </div>
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">No log entries for this checkpoint</p>
        )}
      </Section>
    </div>
  );
}

// --- Branch-level Debug View ---

interface BranchDebugViewProps {
  settings: EntireSettings | null;
  settingsLoading: boolean;
  logs: EntireLogResult | null;
  logsLoading: boolean;
  activeSessions: SessionState[];
  sessionsLoading: boolean;
  onLoadMore: () => void;
}

export function BranchDebugView({
  settings,
  settingsLoading,
  logs,
  logsLoading,
  activeSessions,
  sessionsLoading,
  onLoadMore,
}: BranchDebugViewProps) {
  return (
    <div className="px-5 py-4 space-y-2">
      {/* Settings */}
      <Section title="Entire Settings">
        {settingsLoading ? (
          <LoadingBlock />
        ) : settings ? (
          <div className="rounded-lg border border-border-subtle bg-bg-overlay p-3">
            <JsonViewer text={JSON.stringify(settings)} />
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">No settings file found</p>
        )}
      </Section>

      {/* Active Sessions */}
      <Section title="Active Sessions">
        {sessionsLoading ? (
          <LoadingBlock />
        ) : activeSessions.length === 0 ? (
          <p className="text-xs text-fg-subtle">No active sessions</p>
        ) : (
          <div className="space-y-2">
            {activeSessions.map((s, i) => (
              <div
                key={s.session_id ?? i}
                className="rounded-lg border border-border-subtle bg-bg-overlay p-3"
              >
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <span className="text-fg-subtle">Session ID: </span>
                    <span className="font-mono text-fg-muted">{s.session_id ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-fg-subtle">Phase: </span>
                    <span className="text-fg-muted">{s.phase ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-fg-subtle">Agent: </span>
                    <span className="text-fg-muted">{s.agent_type ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-fg-subtle">Model: </span>
                    <span className="text-fg-muted">{s.model_name ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-fg-subtle">Steps: </span>
                    <span className="text-fg-muted">{s.step_count ?? 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Logs */}
      <Section title="Logs">
        {logsLoading ? (
          <LoadingBlock />
        ) : logs ? (
          <div>
            <div className="mb-2 flex items-center gap-3 text-[10px] text-fg-subtle">
              <span>{formatBytes(logs.file_size_bytes)}</span>
              <span>{logs.total_lines} total lines</span>
              <span>Showing last {logs.lines.length}</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto rounded-lg border border-border-subtle bg-bg-overlay p-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-muted">
                {logs.lines.join("\n")}
              </pre>
            </div>
            {logs.lines.length < logs.total_lines && (
              <button
                onClick={onLoadMore}
                className="mt-2 text-[11px] text-accent-fg hover:text-accent"
              >
                Load more (showing {logs.lines.length} of {logs.total_lines})
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">No log file found</p>
        )}
      </Section>
    </div>
  );
}
