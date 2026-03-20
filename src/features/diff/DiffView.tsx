import { useEffect, useMemo, useState } from "react";
import {
  FileCode,
  FilePlus,
  FileMinus,
  ChevronDown,
  ChevronRight,
  Loader2,
  GitCommit,
  MessageSquarePlus,
  Sparkles,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useDiffQuery, useBranchDiffQuery } from "../../hooks/use-tauri-query";
import { useDiffComments } from "../../hooks/use-diff-comments";
import type { DiffComment } from "../../hooks/use-diff-comments";
import {
  runCheckpointSemanticReview,
  type CheckpointSummary,
  type FileDiff,
  type DiffLine as DiffLineType,
} from "../../lib/ipc";
import { getDiffLineTextColor } from "./colors";
import { getInitiallyExpandedFilePaths } from "./file-expansion";
import { DiffCommentBox } from "./DiffCommentBox";
import { ReviewBar } from "./ReviewBar";
import { toSemanticReviewDiffComments } from "./semantic-review";
import { canWriteDiffComments, getVisibleDiffComments } from "./comments";

interface DiffViewProps {
  repoPath: string;
  checkpoint: CheckpointSummary | null;
  onSendToAgent?: (agent: string, prompt: string) => void;
}

const STATUS_CONFIG = {
  added: { icon: FilePlus, color: "text-green", bg: "bg-green-bg", label: "Added" },
  deleted: { icon: FileMinus, color: "text-red", bg: "bg-red-bg", label: "Deleted" },
  modified: { icon: FileCode, color: "text-yellow", bg: "bg-yellow-bg", label: "Modified" },
} as const;

function makeLineKey(
  filePath: string,
  line: DiffLineType
): string {
  return `${filePath}:${line.old_lineno ?? ""}:${line.new_lineno ?? ""}`;
}

function getLineNumber(line: DiffLineType): number {
  if (line.kind === "delete") return line.old_lineno ?? 0;
  return line.new_lineno ?? line.old_lineno ?? 0;
}

function DiffLineRow({
  line,
  lineKey,
  commentCount,
  commentsEnabled,
  onCommentClick,
}: {
  line: DiffLineType;
  lineKey: string;
  commentCount: number;
  commentsEnabled: boolean;
  onCommentClick: (
    lineKey: string,
    lineContent: string,
    lineNumber: number,
    lineKind: "add" | "delete" | "context"
  ) => void;
}) {
  const isAdd = line.kind === "add";
  const isDel = line.kind === "delete";
  const textColor = getDiffLineTextColor(line.kind);

  return (
    <div
      className="group/line relative flex font-mono text-xs leading-[22px]"
      style={{
        backgroundColor: isAdd
          ? "var(--color-diff-add-bg)"
          : isDel
            ? "var(--color-diff-delete-bg)"
            : "transparent",
      }}
    >
      {/* Comment gutter — click target */}
      {commentsEnabled && (
        <button
          onClick={() =>
            onCommentClick(lineKey, line.content, getLineNumber(line), line.kind)
          }
          className="absolute left-0 top-0 z-10 flex h-[22px] w-[18px] items-center justify-center opacity-0 transition-opacity group-hover/line:opacity-100"
          style={{ color: "var(--color-accent-fg)" }}
          title="Add comment"
        >
          <MessageSquarePlus size={12} />
        </button>
      )}

      {/* Old line number */}
      <span
        className="inline-block w-[50px] shrink-0 select-none border-r px-2 text-right text-[11px] leading-[22px] text-fg-subtle"
        style={{
          borderColor: "var(--color-border-subtle)",
          backgroundColor: isDel
            ? "var(--color-diff-delete-gutter)"
            : isAdd
              ? "var(--color-diff-add-gutter)"
              : "transparent",
        }}
      >
        {line.old_lineno ?? ""}
      </span>
      {/* New line number */}
      <span
        className="inline-block w-[50px] shrink-0 select-none border-r px-2 text-right text-[11px] leading-[22px] text-fg-subtle"
        style={{
          borderColor: "var(--color-border-subtle)",
          backgroundColor: isAdd
            ? "var(--color-diff-add-gutter)"
            : isDel
              ? "var(--color-diff-delete-gutter)"
              : "transparent",
        }}
      >
        {line.new_lineno ?? ""}
      </span>
      {/* +/- indicator */}
      <span
        className="inline-block w-5 shrink-0 select-none text-center text-[11px] leading-[22px]"
        style={{ color: isAdd || isDel ? textColor : "var(--color-fg-faint)" }}
      >
        {isAdd ? "+" : isDel ? "-" : " "}
      </span>
      {/* Code content */}
      <pre
        className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-4"
        style={{ color: textColor }}
      >
        {line.content}
      </pre>

      {/* Comment count badge */}
      {commentCount > 0 && (
        <span
          className="mr-2 mt-[3px] flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {commentCount}
        </span>
      )}
    </div>
  );
}

function FileEntry({
  file,
  defaultExpanded,
  commentsByLine,
  commentsEnabled,
  activeCommentLine,
  onCommentClick,
  onSaveComment,
  onUpdateComment,
  onDeleteComment,
  onCloseComment,
}: {
  file: FileDiff;
  defaultExpanded: boolean;
  commentsByLine: Map<string, DiffComment[]>;
  commentsEnabled: boolean;
  activeCommentLine: string | null;
  onCommentClick: (
    lineKey: string,
    lineContent: string,
    lineNumber: number,
    lineKind: "add" | "delete" | "context"
  ) => void;
  onSaveComment: (
    filePath: string,
    lineKey: string,
    lineKind: "add" | "delete" | "context",
    lineContent: string,
    lineNumber: number,
    comment: string
  ) => void;
  onUpdateComment: (id: string, comment: string) => void;
  onDeleteComment: (id: string) => void;
  onCloseComment: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = STATUS_CONFIG[file.status] || STATUS_CONFIG.modified;
  const Icon = config.icon;

  const additions = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.kind === "add").length,
    0
  );
  const deletions = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.kind === "delete").length,
    0
  );

  // Count comments for this file
  const fileCommentCount = Array.from(commentsByLine.entries()).reduce(
    (sum, [key, cs]) => (key.startsWith(file.path + ":") ? sum + cs.length : sum),
    0
  );

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border-subtle">
      {/* File header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 bg-bg-overlay px-3 py-2 text-left transition-colors hover:bg-bg-hover"
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-fg-subtle" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-fg-subtle" />
        )}
        <Icon size={14} className={`shrink-0 ${config.color}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
          {file.path}
        </span>
        {fileCommentCount > 0 && (
          <span
            className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            {fileCommentCount}
          </span>
        )}
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${config.bg} ${config.color}`}>
          {config.label}
        </span>
        {additions > 0 && (
          <span className="shrink-0 font-mono text-[11px] text-green">
            +{additions}
          </span>
        )}
        {deletions > 0 && (
          <span className="shrink-0 font-mono text-[11px] text-red">
            -{deletions}
          </span>
        )}
      </button>

      {/* Diff hunks */}
      {expanded && (
        <div className="overflow-x-auto border-t border-border-subtle bg-bg">
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              {/* Hunk header */}
              <div
                className="border-b px-4 py-1 font-mono text-[11px]"
                style={{
                  backgroundColor: "var(--color-diff-hunk-bg)",
                  borderColor: "var(--color-border-subtle)",
                  color: "var(--color-accent-fg)",
                }}
              >
                {hunk.header.trim()}
              </div>
              {/* Lines */}
              <div>
                {hunk.lines.map((line, li) => {
                  const lineKey = makeLineKey(file.path, line);
                  const lineComments = commentsByLine.get(lineKey) ?? [];
                  const isActive = activeCommentLine === lineKey;

                  return (
                    <div key={li}>
                      <DiffLineRow
                        line={line}
                        lineKey={lineKey}
                        commentCount={lineComments.length}
                        commentsEnabled={commentsEnabled}
                        onCommentClick={onCommentClick}
                      />
                      {/* Show comment box if line has comments or is active target */}
                      {(lineComments.length > 0 || isActive) && (
                        <DiffCommentBox
                          comments={lineComments}
                          commentsEnabled={commentsEnabled}
                          filePath={file.path}
                          lineKey={lineKey}
                          lineKind={line.kind}
                          lineContent={line.content}
                          lineNumber={getLineNumber(line)}
                          onSave={onSaveComment}
                          onUpdate={onUpdateComment}
                          onDelete={onDeleteComment}
                          onClose={onCloseComment}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {file.hunks.length === 0 && (
            <div className="px-4 py-3 text-xs text-fg-subtle">
              Binary file or no textual changes
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffFileList({
  files,
  summaryLabel,
  summaryDetail,
  storageKey,
  context,
  onSendToAgent,
  semanticReviewContext,
}: {
  files: FileDiff[];
  summaryLabel: string;
  summaryDetail?: string;
  storageKey: string;
  context: { commitSha?: string; branch?: string };
  onSendToAgent?: (agent: string, prompt: string) => void;
  semanticReviewContext?: {
    repoPath: string;
    checkpointId: string;
    commitSha: string;
  };
}) {
  const initiallyExpandedFiles = getInitiallyExpandedFilePaths(files);
  const {
    comments,
    addComment,
    updateComment,
    deleteComment,
    clearManualComments,
    replaceSemanticReviewComments,
  } = useDiffComments(storageKey);

  const [activeCommentLine, setActiveCommentLine] = useState<string | null>(
    null
  );
  const [semanticReviewNotice, setSemanticReviewNotice] = useState<string | null>(
    null
  );

  const commentsEnabled = canWriteDiffComments(Boolean(semanticReviewContext));
  const visibleComments = useMemo(
    () => getVisibleDiffComments(comments, !commentsEnabled),
    [comments, commentsEnabled]
  );
  const visibleCommentsByLine = useMemo(() => {
    const map = new Map<string, DiffComment[]>();
    for (const comment of visibleComments) {
      const existing = map.get(comment.lineKey);
      if (existing) {
        existing.push(comment);
      } else {
        map.set(comment.lineKey, [comment]);
      }
    }
    return map;
  }, [visibleComments]);

  const semanticReviewMutation = useMutation({
    mutationFn: async () => {
      if (!semanticReviewContext) {
        throw new Error("Semantic review is only available for checkpoint diffs");
      }
      return runCheckpointSemanticReview(
        semanticReviewContext.repoPath,
        semanticReviewContext.checkpointId,
        semanticReviewContext.commitSha
      );
    },
    onSuccess: (result) => {
      replaceSemanticReviewComments(
        toSemanticReviewDiffComments(result.annotations, result.review_run_id)
      );
      setSemanticReviewNotice(
        result.annotations.length > 0
          ? `Semantic review added ${result.annotations.length} comment${result.annotations.length === 1 ? "" : "s"}.`
          : "Semantic review found no high-signal changes to annotate."
      );
    },
    onError: (error) => {
      setSemanticReviewNotice(
        error instanceof Error ? error.message : "Semantic review failed"
      );
    },
  });

  useEffect(() => {
    setActiveCommentLine(null);
    setSemanticReviewNotice(null);
    semanticReviewMutation.reset();
  }, [semanticReviewMutation.reset, storageKey]);

  const totalAdditions = files.reduce(
    (sum, f) =>
      sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.kind === "add").length, 0),
    0
  );
  const totalDeletions = files.reduce(
    (sum, f) =>
      sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.kind === "delete").length, 0),
    0
  );

  function handleCommentClick(
    lineKey: string,
    _lineContent: string,
    _lineNumber: number,
    _lineKind: "add" | "delete" | "context"
  ) {
    if (!commentsEnabled) return;
    setActiveCommentLine((prev) => (prev === lineKey ? null : lineKey));
  }

  function handleSaveComment(
    filePath: string,
    lineKey: string,
    lineKind: "add" | "delete" | "context",
    lineContent: string,
    lineNumber: number,
    comment: string
  ) {
    addComment(filePath, lineKey, lineKind, lineContent, lineNumber, comment);
    // Keep the comment box open after saving
  }

  function handleCloseComment() {
    setActiveCommentLine(null);
  }

  function handleSendToAgent(agent: string, prompt: string) {
    onSendToAgent?.(agent, prompt);
  }

  return (
    <div className="relative flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-overlay px-4 py-3">
          <GitCommit size={14} className="text-fg-subtle" />
          <span className="font-mono text-xs text-fg-muted">{summaryLabel}</span>
          {summaryDetail && (
            <span className="text-xs text-fg-muted">{summaryDetail}</span>
          )}
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="text-fg-subtle">{files.length} files</span>
            {totalAdditions > 0 && (
              <span className="font-mono text-green">+{totalAdditions}</span>
            )}
            {totalDeletions > 0 && (
              <span className="font-mono text-red">-{totalDeletions}</span>
            )}
            {semanticReviewContext && (
              <button
                onClick={() => {
                  setSemanticReviewNotice(null);
                  semanticReviewMutation.mutate();
                }}
                disabled={semanticReviewMutation.isPending}
                className="flex items-center gap-1.5 rounded border border-border-subtle px-2.5 py-1 text-[11px] text-fg-subtle transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {semanticReviewMutation.isPending ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Sparkles size={11} />
                )}
                Semantic Review
              </button>
            )}
          </div>
        </div>
        {semanticReviewNotice && (
          <div className="mb-4 rounded-lg border border-border-subtle bg-bg-overlay px-4 py-2 text-xs text-fg-muted">
            {semanticReviewNotice}
          </div>
        )}
        {files.map((file) => (
          <FileEntry
            key={file.path}
            file={file}
            defaultExpanded={initiallyExpandedFiles.has(file.path)}
            commentsByLine={visibleCommentsByLine}
            commentsEnabled={commentsEnabled}
            activeCommentLine={activeCommentLine}
            onCommentClick={handleCommentClick}
            onSaveComment={handleSaveComment}
            onUpdateComment={updateComment}
            onDeleteComment={deleteComment}
            onCloseComment={handleCloseComment}
          />
        ))}
      </div>

      {/* Review bar */}
      <ReviewBar
        comments={visibleComments.filter((comment) => comment.source === "manual")}
        context={context}
        onSendToAgent={handleSendToAgent}
        onClearAll={clearManualComments}
      />
    </div>
  );
}

export function DiffView({ repoPath, checkpoint, onSendToAgent }: DiffViewProps) {
  const { data: files, isLoading, error } = useDiffQuery(
    repoPath,
    checkpoint?.commit_sha ?? ""
  );

  if (!checkpoint) {
    return (
      <div className="flex items-center justify-center p-20 text-fg-subtle">
        Select a checkpoint to view its diff
      </div>
    );
  }

  if (!checkpoint.commit_sha) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-6 text-center">
          <p className="text-sm text-fg-muted">No commit SHA available</p>
          <p className="mt-1 text-xs text-fg-subtle">
            This checkpoint's commit reference was not recorded
          </p>
          {checkpoint.files_touched.length > 0 && (
            <div className="mx-auto mt-4 max-w-md text-left">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Files touched
              </p>
              {checkpoint.files_touched.map((f) => (
                <div
                  key={f}
                  className="flex items-center gap-2 py-1 font-mono text-xs text-fg-muted"
                >
                  <FileCode size={12} className="shrink-0 text-fg-subtle" />
                  {f}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 size={20} className="animate-spin text-fg-subtle" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-6 text-center">
          <p className="text-sm text-fg-muted">Failed to load diff</p>
          <p className="mt-1 text-xs text-fg-subtle">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-6 text-center">
          <p className="text-sm text-fg-muted">No changes in this commit</p>
        </div>
      </div>
    );
  }

  return (
    <DiffFileList
      files={files}
      summaryLabel={checkpoint.commit_sha.slice(0, 7)}
      summaryDetail={checkpoint.commit_message || "Untitled commit"}
      storageKey={`entire:diff-comments:${checkpoint.commit_sha}`}
      context={{ commitSha: checkpoint.commit_sha }}
      onSendToAgent={onSendToAgent}
      semanticReviewContext={{
        repoPath,
        checkpointId: checkpoint.checkpoint_id,
        commitSha: checkpoint.commit_sha,
      }}
    />
  );
}

interface BranchDiffViewProps {
  repoPath: string;
  branch: string;
  onSendToAgent?: (agent: string, prompt: string) => void;
}

export function BranchDiffView({ repoPath, branch, onSendToAgent }: BranchDiffViewProps) {
  const { data: files, isLoading, error } = useBranchDiffQuery(repoPath, branch);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 size={20} className="animate-spin text-fg-subtle" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-6 text-center">
          <p className="text-sm text-fg-muted">Failed to load branch diff</p>
          <p className="mt-1 text-xs text-fg-subtle">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-6 text-center">
          <p className="text-sm text-fg-muted">No changes on this branch</p>
          <p className="mt-1 text-xs text-fg-subtle">
            This branch has no differences from the default branch
          </p>
        </div>
      </div>
    );
  }

  return (
    <DiffFileList
      files={files}
      summaryLabel={branch}
      summaryDetail="All changes on branch"
      storageKey={`entire:diff-comments:branch:${repoPath}:${branch}`}
      context={{ branch }}
      onSendToAgent={onSendToAgent}
    />
  );
}
