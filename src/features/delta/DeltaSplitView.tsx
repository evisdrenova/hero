import { EventFeed } from "./EventFeed";
import { PlanPane } from "./PlanPane";
import type { DeltaMetadata, DeltaEvent, TaskState, TaskDAG } from "./types";

interface DeltaSplitViewProps {
  delta: DeltaMetadata;
  events: DeltaEvent[];
  tasks: TaskState[];
  dag: TaskDAG | null;
  plan: string;
  onAnswerQuestion: (questionId: string, answer: string, taskId: string) => void;
  onApprovePlan: () => void;
  onUpdatePlan: (content: string) => void;
  onSendMessage: (message: string) => void;
}

export function DeltaSplitView({
  delta,
  events,
  tasks,
  dag,
  plan,
  onAnswerQuestion,
  onApprovePlan,
  onUpdatePlan,
  onSendMessage,
}: DeltaSplitViewProps) {
  const isPlanning = delta.status === "planning";

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left pane: Event Feed */}
      <div className="flex w-1/2 flex-col border-r border-border-subtle">
        <EventFeed
          events={events}
          tasks={tasks}
          isPlanning={isPlanning}
          onAnswerQuestion={onAnswerQuestion}
          onSendMessage={onSendMessage}
        />
      </div>

      {/* Right pane: Plan Document */}
      <div className="flex w-1/2 flex-col">
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
