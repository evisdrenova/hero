import { useState } from "react";
import { Send, ChevronRight } from "lucide-react";

interface PromptBarProps {
  onSubmit: (agent: string, prompt: string) => void;
}

export function PromptBar({ onSubmit }: PromptBarProps) {
  const [input, setInput] = useState("");

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSubmit("claude-code", trimmed);
    setInput("");
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-bg-raised px-4 py-2">
      <ChevronRight size={16} className="shrink-0 text-fg-subtle" />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Type a task for Claude..."
        className="flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
      />
      <button
        onClick={handleSubmit}
        disabled={!input.trim()}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg disabled:opacity-30"
      >
        <Send size={16} />
      </button>
    </div>
  );
}
