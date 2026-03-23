import { useState } from "react";
import { Plus, ChevronDown, ChevronRight, Loader2, Circle, CheckCircle, XCircle, Pencil, Play } from "lucide-react";
import { useDeltaListQuery, useDeltaTasksQuery } from "../../hooks/use-delta-query";
import type { DeltaStatus } from "./types";

interface DeltaSidebarProps {
  activeDeltaId: string | null;
  onSelectDelta: (deltaId: string) => void;
  onNewDelta: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent<HTMLDivElement>) => void;
}

function statusIcon(status: DeltaStatus) {
  switch (status) {
    case "planning": return <Pencil size={12} className="text-fg-subtle" />;
    case "ready":
    case "executing": return <Play size={12} className="text-orange-400" />;
    case "reviewing": return <Loader2 size={12} className="text-yellow animate-spin" />;
    case "completed": return <CheckCircle size={12} className="text-green" />;
    case "cancelled": return <XCircle size={12} className="text-red" />;
    default: return <Circle size={12} className="text-fg-subtle" />;
  }
}

function statusLabel(status: DeltaStatus): string {
  switch (status) {
    case "planning": return "Planning";
    case "ready": return "Ready";
    case "executing": return "Running";
    case "reviewing": return "Reviewing";
    case "completed": return "Done";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function DeltaProgress({ deltaId }: { deltaId: string }) {
  const { data: tasks } = useDeltaTasksQuery(deltaId);
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter(t => t.status === "done").length;
  return (
    <span className="text-[10px] text-fg-subtle">
      {done}/{tasks.length}
    </span>
  );
}

export function DeltaSidebar({
  activeDeltaId,
  onSelectDelta,
  onNewDelta,
  width,
  onResizeStart,
}: DeltaSidebarProps) {
  const { data: deltas, isLoading } = useDeltaListQuery();
  const [historyOpen, setHistoryOpen] = useState(false);

  const activeDeltas = (deltas ?? []).filter(
    d => d.status !== "completed" && d.status !== "cancelled"
  );
  const completedDeltas = (deltas ?? []).filter(
    d => d.status === "completed" || d.status === "cancelled"
  );

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-bg-raised"
      style={{ width }}
    >
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-xs font-semibold text-fg-muted">Deltas</span>
        <button
          onClick={onNewDelta}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
          title="New Delta"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Delta list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-fg-subtle" />
          </div>
        )}

        {activeDeltas.map((delta) => (
          <button
            key={delta.id}
            onClick={() => onSelectDelta(delta.id)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
              activeDeltaId === delta.id
                ? "bg-accent/10 text-fg"
                : "text-fg-muted hover:bg-bg-hover hover:text-fg"
            }`}
          >
            {statusIcon(delta.status)}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px]">{delta.name}</span>
              <span className="text-[10px] text-fg-subtle">
                {statusLabel(delta.status)}
              </span>
            </div>
            <DeltaProgress deltaId={delta.id} />
          </button>
        ))}

        {activeDeltas.length === 0 && !isLoading && (
          <div className="px-3 py-6 text-center text-xs text-fg-subtle">
            No active Deltas.
            <br />
            <button
              onClick={onNewDelta}
              className="mt-1 text-accent hover:underline"
            >
              Create one
            </button>
          </div>
        )}

        {/* History section */}
        {completedDeltas.length > 0 && (
          <div className="mt-2 border-t border-border-subtle pt-1">
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle"
            >
              {historyOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              History
            </button>
            {historyOpen &&
              completedDeltas.map((delta) => (
                <button
                  key={delta.id}
                  onClick={() => onSelectDelta(delta.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    activeDeltaId === delta.id
                      ? "bg-accent/10 text-fg"
                      : "text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
                  }`}
                >
                  {statusIcon(delta.status)}
                  <span className="truncate text-[12px]">{delta.name}</span>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent/30 transition-colors"
        onMouseDown={onResizeStart}
      />
    </div>
  );
}
