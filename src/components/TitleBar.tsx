import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sun, Moon, Settings, Eye, EyeOff, Check } from "lucide-react";

function getStoredTheme(): "dark" | "light" {
  return (localStorage.getItem("entire:theme") as "dark" | "light") || "dark";
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("entire:theme", theme);
}

const AGENT_KEYS = [
  { id: "claude", label: "Claude (Anthropic)", envVar: "ANTHROPIC_API_KEY" },
  { id: "codex", label: "Codex (OpenAI)", envVar: "OPENAI_API_KEY" },
  { id: "gemini", label: "Gemini (Google)", envVar: "GOOGLE_API_KEY" },
  { id: "cursor", label: "Cursor", envVar: "CURSOR_API_KEY" },
] as const;

type ApiKeys = Record<string, string>;

function loadApiKeys(): ApiKeys {
  try {
    return JSON.parse(localStorage.getItem("entire:api-keys") || "{}");
  } catch {
    return {};
  }
}

function saveApiKeys(keys: ApiKeys) {
  localStorage.setItem("entire:api-keys", JSON.stringify(keys));
}

/** Exported so PTY spawn code can read saved keys */
export function getApiKeys(): ApiKeys {
  return loadApiKeys();
}

interface TitleBarProps {
  title: string;
}

export function TitleBar({ title }: TitleBarProps) {
  const appWindow = getCurrentWindow();
  const [theme, setTheme] = useState<"dark" | "light">(getStoredTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keys, setKeys] = useState<ApiKeys>(loadApiKeys);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Close modal on click outside
  useEffect(() => {
    if (!settingsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [settingsOpen]);

  // Close on Escape
  useEffect(() => {
    if (!settingsOpen) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setSettingsOpen(false);
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [settingsOpen]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const handleSave = () => {
    saveApiKeys(keys);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <>
      <div
        className="flex h-[38px] shrink-0 items-center border-b border-border bg-bg-raised px-4"
        data-tauri-drag-region
      >
        {/* macOS traffic lights */}
        <div className="mr-4 flex gap-2">
          <button
            onClick={() => appWindow.close()}
            className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] transition-opacity hover:opacity-80"
          >
            <span className="hidden text-[8px] leading-none text-black/60 group-hover:inline">
              ×
            </span>
          </button>
          <button
            onClick={() => appWindow.minimize()}
            className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] transition-opacity hover:opacity-80"
          >
            <span className="hidden text-[8px] leading-none text-black/60 group-hover:inline">
              −
            </span>
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] transition-opacity hover:opacity-80"
          >
            <span className="hidden text-[8px] leading-none text-black/60 group-hover:inline">
              +
            </span>
          </button>
        </div>
        <span className="text-xs text-fg-muted" data-tauri-drag-region>
          {title}
        </span>
        {/* Right-side actions */}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => {
              setSettingsOpen((prev) => !prev);
              setSaved(false);
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg-muted"
            title="Settings"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={toggleTheme}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg-muted"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>

      {/* Settings modal overlay */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div
            ref={modalRef}
            className="w-[420px] rounded-lg border border-border bg-bg-raised shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
              <h2 className="text-sm font-semibold text-fg">Settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
              >
                ×
              </button>
            </div>

            {/* API Keys */}
            <div className="px-5 py-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                API Keys
              </h3>
              <div className="space-y-3">
                {AGENT_KEYS.map(({ id, label, envVar }) => (
                  <div key={id}>
                    <label className="mb-1 flex items-baseline justify-between">
                      <span className="text-xs font-medium text-fg-muted">
                        {label}
                      </span>
                      <span className="font-mono text-[10px] text-fg-subtle">
                        {envVar}
                      </span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type={visible[id] ? "text" : "password"}
                        value={keys[id] || ""}
                        onChange={(e) =>
                          setKeys((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                        placeholder={`Enter ${label} API key`}
                        className="flex-1 rounded border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        onClick={() =>
                          setVisible((prev) => ({
                            ...prev,
                            [id]: !prev[id],
                          }))
                        }
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
                        title={visible[id] ? "Hide" : "Show"}
                      >
                        {visible[id] ? (
                          <EyeOff size={13} />
                        ) : (
                          <Eye size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
              {saved && (
                <span className="flex items-center gap-1 text-xs text-green">
                  <Check size={12} />
                  Saved
                </span>
              )}
              <button
                onClick={() => setSettingsOpen(false)}
                className="rounded px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
