import type { TaskDAG as TaskDAGType, TaskState } from "./types";

interface TaskDAGViewProps {
  dag: TaskDAGType;
  tasks: TaskState[];
}

function statusColor(status: string): string {
  switch (status) {
    case "blocked": return "bg-fg-faint";
    case "ready": return "bg-blue";
    case "running": return "bg-accent";
    case "blocked_on_question": return "bg-yellow";
    case "verifying": return "bg-yellow";
    case "done": return "bg-green";
    default: return "bg-fg-subtle";
  }
}

export function TaskDAGView({ dag, tasks }: TaskDAGViewProps) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const layers = computeLayers(dag);

  return (
    <div className="flex flex-col items-center gap-3 py-3">
      {layers.map((layer, layerIdx) => (
        <div key={layerIdx} className="flex items-center gap-4">
          {layer.map((taskId) => {
            const def = dag.tasks.find((t) => t.id === taskId);
            const state = taskMap.get(taskId);
            if (!def) return null;
            return (
              <div
                key={taskId}
                className="flex flex-col items-center gap-1 rounded border border-border-subtle px-3 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${statusColor(state?.status ?? "blocked")}`} />
                  <span className="text-[11px] font-medium text-fg">{def.title}</span>
                </div>
                <span className="text-[9px] text-fg-subtle">{def.agent}</span>
              </div>
            );
          })}
        </div>
      ))}
      {layers.length > 1 && (
        <div className="text-[9px] text-fg-faint">↓ dependency order ↓</div>
      )}
    </div>
  );
}

function computeLayers(dag: TaskDAGType): string[][] {
  const taskDepth = new Map<string, number>();
  const taskMap = new Map(dag.tasks.map((t) => [t.id, t]));

  function getDepth(id: string): number {
    if (taskDepth.has(id)) return taskDepth.get(id)!;
    const task = taskMap.get(id);
    if (!task || task.depends_on.length === 0) {
      taskDepth.set(id, 0);
      return 0;
    }
    const depth = 1 + Math.max(...task.depends_on.map(getDepth));
    taskDepth.set(id, depth);
    return depth;
  }

  for (const task of dag.tasks) getDepth(task.id);

  const maxDepth = Math.max(0, ...taskDepth.values());
  const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const [id, depth] of taskDepth) {
    layers[depth].push(id);
  }
  return layers;
}
