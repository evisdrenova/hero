interface PaneActionButtonOptions {
  tone?: "neutral" | "danger";
  disabled?: boolean;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function getPaneChrome(isActive: boolean) {
  return {
    rowClassName: cx(
      "flex items-center justify-between border-b px-3 py-1.5 text-[11px] backdrop-blur-sm transition-colors",
      isActive
        ? "border-accent/20 bg-accent-bg/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
        : "border-white/6 bg-black/55 hover:bg-black/70"
    ),
    buttonClassName: cx(
      "flex min-w-0 flex-1 items-center gap-2.5 rounded-md pr-2 text-left transition-colors",
      isActive ? "text-fg" : "text-fg-subtle hover:text-fg"
    ),
    dotClassName: cx(
      "h-1.5 w-1.5 shrink-0 rounded-full",
      isActive ? "bg-accent shadow-[0_0_10px_rgba(124,58,237,0.55)]" : "bg-fg-faint"
    ),
    titleClassName: cx(
      "truncate text-[11px] font-semibold tracking-[0.02em]",
      isActive ? "text-fg" : "text-fg-muted"
    ),
    metaClassName: "shrink-0 text-[10px] uppercase tracking-[0.12em] text-fg-faint",
    closeClassName: getPaneActionButtonClassName({ tone: "danger" }),
  };
}

export function getPaneActionButtonClassName({
  tone = "neutral",
  disabled = false,
}: PaneActionButtonOptions = {}) {
  return cx(
    "inline-flex shrink-0 items-center justify-center rounded-md px-2 py-1 text-[10px] font-medium tracking-[0.08em] uppercase transition-colors",
    tone === "danger"
      ? "text-fg-muted hover:bg-red/10 hover:text-red"
      : "text-fg-subtle hover:bg-white/5 hover:text-fg",
    disabled && "pointer-events-none opacity-40"
  );
}
