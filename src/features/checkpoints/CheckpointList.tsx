import { useState, useMemo } from "react";
import { Search, Loader2, Bot } from "lucide-react";
import { useCheckpointsQuery } from "../../hooks/use-tauri-query";
import type { CheckpointSummary } from "../../lib/ipc";

interface CheckpointListProps {
  repoPath: string;
  branch: string;
  onSelectCheckpoint?: (checkpoint: CheckpointSummary) => void;
}

/** Group checkpoints by calendar date, e.g. "Thursday 12 Mar" */
function groupByDate(
  checkpoints: CheckpointSummary[],
): { label: string; items: CheckpointSummary[] }[] {
  const groups = new Map<string, CheckpointSummary[]>();
  for (const cp of checkpoints) {
    const d = new Date(cp.created_at);
    const key = d.toDateString(); // consistent grouping key
    const existing = groups.get(key);
    if (existing) {
      existing.push(cp);
    } else {
      groups.set(key, [cp]);
    }
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const d = new Date(key);
    const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
    const day = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "short" });
    return { label: `${dayName} ${day} ${month}`, items };
  });
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function CheckpointList({
  repoPath,
  branch,
  onSelectCheckpoint,
}: CheckpointListProps) {
  const { data: realCheckpoints, isLoading } = useCheckpointsQuery(
    repoPath,
    branch,
  );

  const checkpoints = realCheckpoints ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = search
    ? checkpoints.filter(
        (cp) =>
          cp.commit_message.toLowerCase().includes(search.toLowerCase()) ||
          cp.checkpoint_id.toLowerCase().includes(search.toLowerCase()),
      )
    : checkpoints;

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <div className="min-w-0">
      {/* Search */}
      <div className="p-5 pb-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search checkpoints... (⌘K)"
            className="w-full rounded-lg border border-border bg-bg-overlay py-2 pl-9 pr-3 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent"
          />
          {isLoading && (
            <Loader2
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-fg-subtle"
            />
          )}
        </div>
      </div>

      {/* Grouped list */}
      <div className="min-w-0 overflow-hidden px-5 pb-5">
        {groups.map((group) => (
          <div key={group.label} className="mb-2">
            {/* Date header */}
            <div className="flex items-center justify-between rounded-t-lg bg-bg-hover px-4 py-2.5">
              <span className="text-[13px] font-semibold text-fg">
                {group.label}
              </span>
              <span className="text-[12px] text-fg-muted">
                {pluralize(group.items.length, "checkpoint")}
              </span>
            </div>

            {/* Rows */}
            <div className="rounded-b-lg border border-border-subtle bg-bg-overlay">
              {group.items.map((cp, idx) => {
                const agent = cp.sessions[0]?.agent ?? null;
                const isSelected = selectedId === cp.checkpoint_id;
                const isLast = idx === group.items.length - 1;
                const promptFirstLine = cp.sessions[0]?.prompt?.split("\n")[0];
                const title =
                  cp.commit_message ||
                  cp.sessions[0]?.summary?.intent ||
                  promptFirstLine ||
                  cp.checkpoint_id.slice(0, 12);

                return (
                  <button
                    key={cp.checkpoint_id}
                    onClick={() => {
                      setSelectedId(cp.checkpoint_id);
                      onSelectCheckpoint?.(cp);
                    }}
                    className={`flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? "bg-accent-bg"
                        : "hover:bg-bg-hover"
                    } ${!isLast ? "border-b border-border-subtle" : ""}`}
                  >
                    {/* SHA */}
                    <span className="shrink-0 font-mono text-[12px] text-fg-subtle">
                      {cp.commit_sha
                        ? cp.commit_sha.slice(0, 7)
                        : cp.checkpoint_id.slice(0, 7)}
                    </span>

                    {/* Title: commit message, session intent, or truncated ID */}
                    <span className="truncate text-[13px] font-semibold text-fg">
                      {title}
                    </span>

                    {/* Agent badge */}
                    {agent && (
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
                          agent === "Claude Code"
                            ? "bg-accent-bg text-accent-fg"
                            : "bg-green-bg text-green"
                        }`}
                      >
                        {agent}
                      </span>
                    )}

                    {/* Spacer */}
                    <span className="flex-1" />

                    {/* Diff stats */}
                    {(cp.additions > 0 || cp.deletions > 0) && (
                      <span className="shrink-0 font-mono text-[12px]">
                        {cp.additions > 0 && (
                          <span className="text-green">+{cp.additions}</span>
                        )}
                        {cp.additions > 0 && cp.deletions > 0 && (
                          <span className="text-fg-muted"> / </span>
                        )}
                        {cp.deletions > 0 && (
                          <span className="text-red">-{cp.deletions}</span>
                        )}
                      </span>
                    )}

                    {/* File count */}
                    <span className="shrink-0 text-[12px] text-fg-muted">
                      {pluralize(cp.files_touched.length, "file")}
                    </span>

                    {/* Avatar */}
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-hover">
                      <Bot size={14} className="text-accent-fg" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {filtered.length === 0 && !isLoading && (
          <div className="py-12 text-center text-sm text-fg-subtle">
            No checkpoints found
          </div>
        )}
      </div>
    </div>
  );
}
