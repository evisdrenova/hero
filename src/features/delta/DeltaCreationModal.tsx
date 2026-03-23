import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useReposQuery } from "../../hooks/use-tauri-query";
import { useCreateDeltaMutation } from "../../hooks/use-delta-query";
import type { DeltaRepo } from "./types";

interface DeltaCreationModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (deltaId: string) => void;
}

export function DeltaCreationModal({ open, onClose, onCreated }: DeltaCreationModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { data: repos } = useReposQuery();
  const createMutation = useCreateDeltaMutation();
  const [name, setName] = useState("");
  const [selectedRepos, setSelectedRepos] = useState<DeltaRepo[]>([]);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);

  if (!open) return null;

  const toggleRepo = (repoPath: string) => {
    setSelectedRepos((prev) => {
      const exists = prev.find((r) => r.path === repoPath);
      if (exists) return prev.filter((r) => r.path !== repoPath);
      return [...prev, { path: repoPath, role: "" }];
    });
  };

  const handleSubmit = async () => {
    if (!name.trim() || selectedRepos.length === 0) return;
    try {
      const delta = await createMutation.mutateAsync({
        name: name.trim(),
        repos: selectedRepos,
        description: description.trim() || undefined,
      });
      setName("");
      setSelectedRepos([]);
      setDescription("");
      onCreated(delta.id);
      onClose();
    } catch (err) {
      console.error("[delta] create failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className="w-[480px] rounded-lg border border-border bg-bg-raised shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">New Delta</h2>
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Add OAuth2 authentication"
              className="w-full rounded border border-border bg-bg px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
              autoFocus
            />
          </div>

          {/* Repos */}
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Repositories</label>
            <div className="max-h-[140px] overflow-y-auto rounded border border-border bg-bg p-1">
              {(repos ?? []).map((repo) => {
                const isSelected = selectedRepos.some((r) => r.path === repo.path);
                return (
                  <button
                    key={repo.path}
                    onClick={() => toggleRepo(repo.path)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? "bg-accent/10 text-fg"
                        : "text-fg-muted hover:bg-bg-hover"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        isSelected
                          ? "border-accent bg-accent text-white"
                          : "border-border"
                      }`}
                    >
                      {isSelected && (
                        <span className="text-[8px] leading-none">✓</span>
                      )}
                    </span>
                    <span className="truncate">{repo.name}</span>
                    <span className="ml-auto truncate text-[10px] text-fg-subtle">
                      {repo.path}
                    </span>
                  </button>
                );
              })}
              {(repos ?? []).length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-fg-subtle">
                  No repos registered. Add a repo first.
                </p>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">
              Objective
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you want to build or fix..."
              rows={3}
              className="w-full resize-none rounded border border-border bg-bg px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || selectedRepos.length === 0 || createMutation.isPending}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create Delta"}
          </button>
        </div>
      </div>
    </div>
  );
}
