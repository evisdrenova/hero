import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import type { DiffComment } from "../../hooks/use-diff-comments";

interface DiffCommentBoxProps {
  comments: DiffComment[];
  commentsEnabled: boolean;
  filePath: string;
  lineKey: string;
  lineKind: "add" | "delete" | "context";
  lineContent: string;
  lineNumber: number;
  onSave: (
    filePath: string,
    lineKey: string,
    lineKind: "add" | "delete" | "context",
    lineContent: string,
    lineNumber: number,
    comment: string
  ) => void;
  onUpdate: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function DiffCommentBox({
  comments,
  commentsEnabled,
  filePath,
  lineKey,
  lineKind,
  lineContent,
  lineNumber,
  onSave,
  onUpdate,
  onDelete,
  onClose,
}: DiffCommentBoxProps) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const showNewInput = commentsEnabled && editingId === null;

  function handleSaveNew() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSave(filePath, lineKey, lineKind, lineContent, lineNumber, trimmed);
    setDraft("");
  }

  function handleStartEdit(c: DiffComment) {
    setEditingId(c.id);
    setEditDraft(c.comment);
  }

  function handleSaveEdit() {
    if (!editingId) return;
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    onUpdate(editingId, trimmed);
    setEditingId(null);
    setEditDraft("");
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  return (
    <div
      className="border-y px-3 py-2"
      style={{
        borderColor: "var(--color-accent)",
        backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, var(--color-bg))",
      }}
    >
      {/* Existing comments */}
      {comments.map((c) => (
        <div key={c.id} className="mb-2">
          {editingId === c.id ? (
            <div className="flex flex-col gap-1.5">
              <textarea
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveEdit();
                  if (e.key === "Escape") handleCancelEdit();
                }}
                rows={2}
                className="w-full resize-none rounded border border-accent bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:ring-1 focus:ring-accent"
                placeholder="Edit comment…"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={handleSaveEdit}
                  className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:opacity-90"
                >
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="rounded px-2.5 py-1 text-[11px] text-fg-subtle transition-colors hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="group flex items-start gap-2">
              <div
                className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: "var(--color-accent)" }}
              />
              <div className="min-w-0 flex-1">
                {c.source === "semantic_review" && (
                  <span className="mb-1 inline-flex rounded-full bg-accent-bg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-fg">
                    Semantic review
                  </span>
                )}
                <p className="text-xs text-fg-muted whitespace-pre-wrap">{c.comment}</p>
              </div>
              {!c.readonly && (
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => handleStartEdit(c)}
                    className="rounded p-0.5 text-fg-subtle hover:text-accent-fg"
                    title="Edit"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => onDelete(c.id)}
                    className="rounded p-0.5 text-fg-subtle hover:text-red"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* New comment input */}
      {showNewInput && editingId === null && (
        <div className="flex flex-col gap-1.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveNew();
              if (e.key === "Escape") onClose();
            }}
            rows={2}
            className="w-full resize-none rounded border border-border-subtle bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            placeholder="Add a review comment… (⌘↵ to save)"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleSaveNew}
              disabled={!draft.trim()}
              className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] text-fg-subtle transition-colors hover:text-fg"
            >
              <X size={10} />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
