import type { GateResultEntry } from "./types";

interface GateResultProps {
  result: GateResultEntry;
}

export function GateResult({ result }: GateResultProps) {
  return (
    <div className={`flex items-start gap-1.5 text-[11px] ${result.passed ? "text-green" : "text-red"}`}>
      <span className="mt-0.5 shrink-0">{result.passed ? "✓" : "✗"}</span>
      <div>
        <span className="font-medium">{result.gate_type}</span>
        {result.output && (
          <pre className="mt-0.5 max-h-[60px] overflow-auto whitespace-pre-wrap text-[10px] text-fg-subtle">
            {result.output}
          </pre>
        )}
      </div>
    </div>
  );
}
