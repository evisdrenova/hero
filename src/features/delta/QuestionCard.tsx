import { useState } from "react";
import type { DeltaEvent } from "./types";

type QuestionEvent = Extract<DeltaEvent, { type: "question" }>;

interface QuestionCardProps {
  event: QuestionEvent;
  isAnswered: boolean;
  onAnswer: (answer: string) => void;
}

export function QuestionCard({ event, isAnswered, onAnswer }: QuestionCardProps) {
  const [customAnswer, setCustomAnswer] = useState("");

  if (isAnswered) {
    return (
      <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-xs opacity-60">
        <div className="font-medium text-fg-muted">{event.agent} asked:</div>
        <div className="text-fg-subtle">{event.question}</div>
        <div className="mt-1 text-[10px] text-fg-faint">Answered</div>
      </div>
    );
  }

  return (
    <div className={`rounded border px-3 py-2 text-xs ${
      event.blocking
        ? "border-orange-400/40 bg-orange-400/5"
        : "border-border-subtle bg-bg-overlay"
    }`}>
      <div className="flex items-center gap-1.5">
        {event.blocking && (
          <span className="rounded bg-orange-400/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-orange-400">
            Blocking
          </span>
        )}
        <span className="font-medium text-fg-muted">{event.agent}:</span>
      </div>
      <div className="mt-1 text-fg">{event.question}</div>

      {event.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {event.options.map((opt) => (
            <button
              key={opt}
              onClick={() => onAnswer(opt)}
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-fg"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex gap-1.5">
        <input
          type="text"
          value={customAnswer}
          onChange={(e) => setCustomAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customAnswer.trim()) {
              onAnswer(customAnswer.trim());
              setCustomAnswer("");
            }
          }}
          placeholder="Type an answer..."
          className="flex-1 rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => {
            if (customAnswer.trim()) {
              onAnswer(customAnswer.trim());
              setCustomAnswer("");
            }
          }}
          disabled={!customAnswer.trim()}
          className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Answer
        </button>
      </div>
    </div>
  );
}
