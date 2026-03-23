import { useState, useEffect } from "react";
import { Plus, ChevronDown, ChevronRight, Loader2, Circle, CheckCircle, XCircle, Pencil, Play, MoreHorizontal, Trash2 } from "lucide-react";
import { useDeltaListQuery, useDeltaTasksQuery, useDeleteDeltaMutation } from "../../hooks/use-delta-query";
import type { DeltaStatus } from "./types";

interface DeltaSidebarProps {
  activeDeltaId: string | null;
  onSelectDelta: (deltaId: string | null) => void;
  onNewDelta: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent<HTMLDivElement>) => void;
  streamingDeltaIds?: Set<string>;
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
  width: _width,
  onResizeStart,
  streamingDeltaIds,
}: DeltaSidebarProps) {
  const { data: deltas, isLoading } = useDeltaListQuery();
  const deleteMutation = useDeleteDeltaMutation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-delta-dropdown]")) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openDropdown]);

  const activeDeltas = (deltas ?? []).filter(
    d => d.status !== "completed" && d.status !== "cancelled"
  );
  const completedDeltas = (deltas ?? []).filter(
    d => d.status === "completed" || d.status === "cancelled"
  );

  const handleDelete = (deltaId: string) => {
    setOpenDropdown(null);
    if (activeDeltaId === deltaId) {
      onSelectDelta(null);
    }
    deleteMutation.mutate(deltaId);
  };

  return (
    <div
      className="relative flex flex-1 min-h-0 shrink-0 flex-col bg-bg-raised"
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
          <DeltaRow
            key={delta.id}
            deltaId={delta.id}
            name={delta.name}
            status={delta.status}
            isActive={activeDeltaId === delta.id}
            isStreaming={streamingDeltaIds?.has(delta.id) ?? false}
            isDropdownOpen={openDropdown === delta.id}
            onSelect={() => onSelectDelta(delta.id)}
            onToggleDropdown={(e) => {
              e.stopPropagation();
              setOpenDropdown(openDropdown === delta.id ? null : delta.id);
            }}
            onDelete={() => handleDelete(delta.id)}
          />
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
                <DeltaRow
                  key={delta.id}
                  deltaId={delta.id}
                  name={delta.name}
                  status={delta.status}
                  isActive={activeDeltaId === delta.id}
                  isDropdownOpen={openDropdown === delta.id}
                  onSelect={() => onSelectDelta(delta.id)}
                  onToggleDropdown={(e) => {
                    e.stopPropagation();
                    setOpenDropdown(openDropdown === delta.id ? null : delta.id);
                  }}
                  onDelete={() => handleDelete(delta.id)}
                  compact
                />
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

function DeltaRow({
  deltaId,
  name,
  status,
  isActive,
  isStreaming,
  isDropdownOpen,
  onSelect,
  onToggleDropdown,
  onDelete,
  compact,
}: {
  deltaId: string;
  name: string;
  status: DeltaStatus;
  isActive: boolean;
  isStreaming?: boolean;
  isDropdownOpen: boolean;
  onSelect: () => void;
  onToggleDropdown: (e: React.MouseEvent) => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-2 px-3 ${compact ? "py-1.5" : "py-2"} text-left transition-colors ${
          isActive
            ? "bg-accent/10 text-fg"
            : compact
              ? "text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
              : "text-fg-muted hover:bg-bg-hover hover:text-fg"
        }`}
      >
        {isStreaming ? (
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
          </span>
        ) : statusIcon(status)}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate ${compact ? "text-[12px]" : "text-[13px]"}`}>{name}</span>
          {!compact && (
            <span className="text-[10px] text-fg-subtle">
              {statusLabel(status)}
            </span>
          )}
        </div>
        {!compact && <DeltaProgress deltaId={deltaId} />}
        <div
          data-delta-dropdown
          onClick={onToggleDropdown}
          className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-bg-hover group-hover:opacity-100"
          title="Delta actions"
        >
          <MoreHorizontal size={12} className="text-fg-subtle" />
        </div>
      </button>

      {isDropdownOpen && (
        <div
          data-delta-dropdown
          className="absolute right-2 top-full z-50 mt-0.5 min-w-[140px] rounded-md border border-border bg-bg-raised py-1 shadow-lg"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-red hover:bg-bg-hover"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
