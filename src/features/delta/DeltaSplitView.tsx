import { useState, useCallback } from "react";
import { EventFeed } from "./EventFeed";
import { PlanningChat } from "./PlanningChat";
import type { PlanningMessage } from "./PlanningChat";
import { PlanPane } from "./PlanPane";
import type { DeltaMetadata, DeltaEvent, TaskState, TaskDAG } from "./types";
import type { PermissionRequest } from "../chat/stream-json";

interface DeltaSplitViewProps {
  delta: DeltaMetadata;
  events: DeltaEvent[];
  tasks: TaskState[];
  dag: TaskDAG | null;
  plan: string;
  planningMessages: PlanningMessage[];
  planningPendingText: string;
  planningIsStreaming: boolean;
  pendingPermission: PermissionRequest | null;
  onPermissionResponse: (requestId: string, allow: boolean) => void;
  onAnswerQuestion: (questionId: string, answer: string, taskId: string) => void;
  onApprovePlan: () => void;
  onUpdatePlan: (content: string) => void;
  onSendMessage: (message: string) => void;
  onStopAgent: () => void;
}

export function DeltaSplitView({
  delta,
  events,
  tasks,
  dag,
  plan,
  planningMessages,
  planningPendingText,
  planningIsStreaming,
  pendingPermission,
  onPermissionResponse,
  onAnswerQuestion,
  onApprovePlan,
  onUpdatePlan,
  onSendMessage,
  onStopAgent,
}: DeltaSplitViewProps) {
  const isPlanning = delta.status === "planning";
  const [splitPct, setSplitPct] = useState(50);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = (e.target as HTMLElement).parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      const onMove = (ev: MouseEvent) => {
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        setSplitPct(Math.max(25, Math.min(75, pct)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    []
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left pane: Chat during planning, Event Feed otherwise */}
      <div className="flex flex-col overflow-hidden" style={{ width: `${splitPct}%` }}>
        {isPlanning ? (
          <PlanningChat
            messages={planningMessages}
            pendingText={planningPendingText}
            isStreaming={planningIsStreaming}
            pendingPermission={pendingPermission}
            onPermissionResponse={onPermissionResponse}
            onSendMessage={onSendMessage}
            onStopAgent={onStopAgent}
          />
        ) : (
          <EventFeed
            events={events}
            tasks={tasks}
            isPlanning={false}
            onAnswerQuestion={onAnswerQuestion}
            onSendMessage={onSendMessage}
          />
        )}
      </div>

      {/* Resize handle */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-border-subtle transition-colors hover:bg-accent/40 active:bg-accent/60"
        onMouseDown={handleDragStart}
      />

      {/* Right pane: Plan Document */}
      <div className="flex flex-col overflow-hidden" style={{ width: `${100 - splitPct}%` }}>
        <PlanPane
          plan={plan}
          dag={dag}
          tasks={tasks}
          isPlanning={isPlanning}
          deltaStatus={delta.status}
          onUpdatePlan={onUpdatePlan}
          onApprovePlan={onApprovePlan}
        />
      </div>
    </div>
  );
}
