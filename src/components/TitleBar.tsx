import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sun, Moon } from "lucide-react";

function getStoredTheme(): "dark" | "light" {
  return (localStorage.getItem("entire:theme") as "dark" | "light") || "dark";
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("entire:theme", theme);
}

interface TitleBarProps {
  title: string;
}

export function TitleBar({ title }: TitleBarProps) {
  const appWindow = getCurrentWindow();
  const [theme, setTheme] = useState<"dark" | "light">(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
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
      {/* Theme toggle */}
      <div className="ml-auto">
        <button
          onClick={toggleTheme}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg-muted"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </div>
  );
}
