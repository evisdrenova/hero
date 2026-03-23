import { useState, useRef, useEffect } from "react";
import { QuestionCard } from "./QuestionCard";
import type { DeltaEvent, TaskState } from "./types";

interface EventFeedProps {
  events: DeltaEvent[];
  tasks: TaskState[];
  isPlanning: boolean;
  onAnswerQuestion: (questionId: string, answer: string, taskId: string) => void;
  onSendMessage: (message: string) => void;
}

type FilterType = "all" | "questions" | "decisions" | "progress";

export function EventFeed({
  events,
  tasks: _tasks,
  isPlanning,
  onAnswerQuestion,
  onSendMessage,
}: EventFeedProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [message, setMessage] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events.length]);

  const filteredEvents = events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "questions") return e.type === "question" || e.type === "question_answered";
    if (filter === "decisions") return e.type === "plan_update";
    if (filter === "progress") return e.type === "progress" || e.type === "task_state" || e.type === "task_complete";
    return true;
  });

  const answeredIds = new Set(
    events
      .filter((e): e is Extract<DeltaEvent, { type: "question_answered" }> => e.type === "question_answered")
      .map((e) => e.question_id)
  );

  const handleSend = () => {
    if (!message.trim()) return;
    onSendMessage(message.trim());
    setMessage("");
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="flex gap-1 border-b border-border-subtle px-3 py-1.5">
        {(["all", "questions", "decisions", "progress"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
              filter === f
                ? "bg-accent/10 text-accent"
                : "text-fg-subtle hover:text-fg-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Events */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {filteredEvents.length === 0 && (
          <p className="py-8 text-center text-xs text-fg-subtle">
            {isPlanning ? "Start planning by describing your feature below." : "Waiting for agent activity..."}
          </p>
        )}

        {filteredEvents.map((event, idx) => (
          <EventItem
            key={idx}
            event={event}
            isAnswered={event.type === "question" && answeredIds.has(event.id)}
            onAnswerQuestion={onAnswerQuestion}
          />
        ))}
      </div>

      {/* Message input */}
      <div className="border-t border-border-subtle px-3 py-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={isPlanning ? "Describe your feature..." : "Send a message to agents..."}
            className="flex-1 rounded border border-border bg-bg px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim()}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function EventItem({
  event,
  isAnswered,
  onAnswerQuestion,
}: {
  event: DeltaEvent;
  isAnswered: boolean;
  onAnswerQuestion: (questionId: string, answer: string, taskId: string) => void;
}) {
  switch (event.type) {
    case "user_message":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-lg bg-accent/10 px-3 py-2 text-xs text-fg">
            {event.message}
          </div>
        </div>
      );
    case "progress":
      return (
        <div className="flex gap-2 text-xs">
          <span className="shrink-0 text-fg-subtle">{event.agent}</span>
          <span className="text-fg-muted">{event.message}</span>
        </div>
      );
    case "question":
      return (
        <QuestionCard
          event={event}
          isAnswered={isAnswered}
          onAnswer={(answer) => onAnswerQuestion(event.id, answer, event.task_id)}
        />
      );
    case "task_complete":
      return (
        <div className="flex items-center gap-2 rounded bg-green/5 px-2 py-1.5 text-xs">
          <span className="text-green">✓</span>
          <span className="font-medium text-green">Task complete:</span>
          <span className="text-fg-muted">{event.summary}</span>
        </div>
      );
    case "task_state":
      return (
        <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <span>→</span>
          <span>{event.task_id}: {event.from} → {event.to}</span>
          {event.reason && <span className="text-fg-faint">({event.reason})</span>}
        </div>
      );
    case "gate_result":
      return (
        <div className={`flex items-center gap-2 text-xs ${event.passed ? "text-green" : "text-red"}`}>
          <span>{event.passed ? "✓" : "✗"}</span>
          <span>Gate {event.gate_index}: {event.gate_type}</span>
        </div>
      );
    case "plan_update":
      return (
        <div className="flex gap-2 text-xs">
          <span className="shrink-0 text-accent">decision</span>
          <span className="text-fg-muted">{event.content}</span>
        </div>
      );
    case "review_finding":
      return (
        <div className={`rounded border px-2 py-1.5 text-xs ${
          event.severity === "error"
            ? "border-red/30 bg-red/5 text-red"
            : "border-yellow/30 bg-yellow/5 text-yellow"
        }`}>
          <div className="font-medium">{event.severity}: {event.file}{event.line ? `:${event.line}` : ""}</div>
          <div className="text-fg-muted">{event.message}</div>
        </div>
      );
    case "question_answered":
      return (
        <div className="flex gap-2 text-xs text-fg-subtle">
          <span>↳</span>
          <span>Answered: {event.answer} (by {event.answered_by})</span>
        </div>
      );
    default:
      return null;
  }
}
