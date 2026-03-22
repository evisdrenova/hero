import { useState, useRef, useEffect } from "react";
import { TerminalSquare, ChevronDown } from "lucide-react";
import type { Tab } from "../App";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  busyTabIds: Set<string>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddAgentTab?: (agent: string) => void;
  onAddParallelAgent?: (agent: string) => void;
}

const AGENT_OPTIONS = ["claude", "codex", "gemini", "cursor"] as const;

function agentDisplayName(agent: string | null): string | null {
  if (!agent) return null;
  if (agent === "claude-code") return "claude";
  if (agent === "codex") return "codex";
  if (agent === "gemini") return "gemini";
  if (agent === "cursor") return "cursor";
  return agent;
}

export function TabBar({
  tabs,
  activeTabId,
  busyTabIds,
  onSelectTab,
  onCloseTab,
  onAddAgentTab,
  onAddParallelAgent,
}: TabBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border bg-bg-raised pl-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isAgent = tab.kind === "agent";
        const isBusy = busyTabIds.has(tab.id);
        const label = isAgent
          ? agentDisplayName(tab.agent) ?? tab.branch
          : tab.branch;

        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`relative flex h-full items-center gap-1.5 border-r border-border-subtle px-3.5 text-xs whitespace-nowrap transition-colors ${
              isActive
                ? "bg-bg-hover text-fg"
                : "text-fg-subtle hover:bg-bg-overlay hover:text-fg-muted"
            }`}
          >
            {/* Status dot — pulses when busy */}
            <span
              className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                tab.hasActiveSession
                  ? isAgent
                    ? "bg-orange-400"
                    : "bg-green"
                  : "bg-fg-subtle"
              }`}
              style={isBusy ? { animation: "pulse 1.5s ease-in-out infinite" } : undefined}
            />

            {/* Icon */}
            {isAgent ? (
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-accent" />
              </span>
            ) : (
              <TerminalSquare size={14} className="shrink-0" />
            )}

            {/* Label */}
            {label}

            {/* Close button */}
            <span
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="ml-2 text-sm leading-none text-fg-faint hover:text-fg"
            >
              ×
            </span>

            {/* Active indicator */}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
            )}
          </button>
        );
      })}

      {/* Add tab button with dropdown */}
      <div ref={dropdownRef} className="relative flex h-full items-center">
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex h-full cursor-pointer items-center gap-0.5 px-3 text-base text-fg-subtle hover:text-fg-muted"
        >
          +
          <ChevronDown size={10} />
        </button>

        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[180px] rounded-lg border border-border bg-bg-overlay py-1 shadow-lg">
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Agent
            </div>
            {AGENT_OPTIONS.map((agent) => (
              <button
                key={agent}
                onClick={() => {
                  onAddAgentTab?.(agent);
                  setDropdownOpen(false);
                }}
                className="px-3 py-1.5 text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg w-full text-left"
              >
                {agent}
              </button>
            ))}
            <div className="my-1 border-t border-border-subtle" />
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Parallel (own worktree)
            </div>
            {AGENT_OPTIONS.map((agent) => (
              <button
                key={`parallel-${agent}`}
                onClick={() => {
                  onAddParallelAgent?.(agent);
                  setDropdownOpen(false);
                }}
                className="px-3 py-1.5 text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg w-full text-left"
              >
                {agent}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
