import type { DeltaEvent } from "./types";

type ReviewFinding = Extract<DeltaEvent, { type: "review_finding" }>;

interface ReviewSummaryProps {
  findings: ReviewFinding[];
  onDismiss: (index: number) => void;
  onRequestFixes: (taskId: string) => void;
  onApproveMerge: () => void;
}

export function ReviewSummary({
  findings,
  onDismiss,
  onRequestFixes,
  onApproveMerge,
}: ReviewSummaryProps) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity !== "error" && f.severity !== "warning");

  return (
    <div className="space-y-3 p-3">
      <h3 className="text-xs font-semibold text-fg">Review Summary</h3>

      <div className="flex gap-3 text-xs">
        {errors.length > 0 && (
          <span className="text-red">{errors.length} error{errors.length > 1 ? "s" : ""}</span>
        )}
        {warnings.length > 0 && (
          <span className="text-yellow">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</span>
        )}
        {infos.length > 0 && (
          <span className="text-fg-subtle">{infos.length} info</span>
        )}
        {findings.length === 0 && (
          <span className="text-green">No issues found</span>
        )}
      </div>

      {findings.map((finding, idx) => (
        <div
          key={idx}
          className={`rounded border px-3 py-2 text-xs ${
            finding.severity === "error"
              ? "border-red/30 bg-red/5"
              : finding.severity === "warning"
              ? "border-yellow/30 bg-yellow/5"
              : "border-border-subtle bg-bg-overlay"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-fg">
              {finding.file}{finding.line ? `:${finding.line}` : ""}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => onDismiss(idx)}
                className="rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-bg-hover"
              >
                Dismiss
              </button>
              <button
                onClick={() => onRequestFixes(finding.task_id)}
                className="rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
              >
                Fix
              </button>
            </div>
          </div>
          <p className="mt-1 text-fg-muted">{finding.message}</p>
          {finding.suggestion && (
            <p className="mt-0.5 text-fg-subtle">Suggestion: {finding.suggestion}</p>
          )}
        </div>
      ))}

      {/* Action buttons */}
      <div className="flex justify-end gap-2 pt-2">
        {errors.length > 0 && (
          <button
            onClick={() => {
              const taskIds = new Set(errors.map((f) => f.task_id));
              taskIds.forEach((id) => onRequestFixes(id));
            }}
            className="rounded border border-red/30 px-3 py-1.5 text-xs text-red hover:bg-red/5"
          >
            Request Fixes ({errors.length})
          </button>
        )}
        <button
          onClick={onApproveMerge}
          disabled={errors.length > 0}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Approve & Merge
        </button>
      </div>
    </div>
  );
}
