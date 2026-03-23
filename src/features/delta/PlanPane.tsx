import { GateResult } from "./GateResult";
import type { TaskDAG, TaskState, DeltaStatus } from "./types";

interface PlanPaneProps {
  plan: string;
  dag: TaskDAG | null;
  tasks: TaskState[];
  isPlanning: boolean;
  deltaStatus: DeltaStatus;
  onUpdatePlan: (content: string) => void;
  onApprovePlan: () => void;
}

function taskStatusBadge(status: string) {
  switch (status) {
    case "blocked": return <span className="rounded bg-fg-faint/20 px-1 py-0.5 text-[9px] text-fg-subtle">blocked</span>;
    case "ready": return <span className="rounded bg-blue/10 px-1 py-0.5 text-[9px] text-blue">ready</span>;
    case "running": return <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent" style={{ animation: "pulse 1.5s ease-in-out infinite" }}>running</span>;
    case "blocked_on_question": return <span className="rounded bg-yellow/10 px-1 py-0.5 text-[9px] text-yellow">waiting</span>;
    case "verifying": return <span className="rounded bg-yellow/10 px-1 py-0.5 text-[9px] text-yellow">verifying</span>;
    case "done": return <span className="rounded bg-green/10 px-1 py-0.5 text-[9px] text-green">done</span>;
    default: return null;
  }
}

export function PlanPane({
  plan,
  dag,
  tasks,
  isPlanning,
  deltaStatus: _deltaStatus,
  onUpdatePlan: _onUpdatePlan,
  onApprovePlan,
}: PlanPaneProps) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
        <span className="text-xs font-semibold text-fg-muted">Plan</span>
        {isPlanning && (
          <button
            onClick={onApprovePlan}
            disabled={!plan.trim()}
            className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Approve Plan & Launch
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Plan text */}
        {isPlanning ? (
          <div className="p-3">
            {plan ? (
              <pre className="whitespace-pre-wrap font-mono text-xs text-fg-muted">{plan}</pre>
            ) : (
              <p className="py-8 text-center text-xs text-fg-subtle">
                The plan will appear here as you discuss with the planning agent...
              </p>
            )}
          </div>
        ) : (
          <div className="p-3">
            <pre className="whitespace-pre-wrap font-mono text-xs text-fg-muted">{plan}</pre>
          </div>
        )}

        {/* Task status section (during execution) */}
        {dag && !isPlanning && (
          <div className="border-t border-border-subtle px-3 py-2">
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Tasks
            </h4>
            <div className="space-y-2">
              {dag.tasks.map((taskDef) => {
                const state = taskMap.get(taskDef.id);
                return (
                  <div key={taskDef.id} className="rounded border border-border-subtle p-2">
                    <div className="flex items-center gap-2">
                      {state && taskStatusBadge(state.status)}
                      <span className="text-xs font-medium text-fg">{taskDef.title}</span>
                      <span className="ml-auto text-[10px] text-fg-subtle">{taskDef.agent}</span>
                    </div>
                    {state && state.gate_results.length > 0 && (
                      <div className="mt-1.5 space-y-0.5 pl-2">
                        {state.gate_results.map((gr, i) => (
                          <GateResult key={i} result={gr} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
