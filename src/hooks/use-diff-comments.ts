import { useState, useCallback, useMemo, useEffect } from "react";
import {
  applySemanticReviewComments,
  createManualDiffComment,
  type DiffComment,
} from "../features/diff/comments";

export type { DiffComment } from "../features/diff/comments";

function loadComments(storageKey: string): DiffComment[] {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw).map(normalizeComment) : [];
  } catch {
    return [];
  }
}

function normalizeComment(comment: DiffComment): DiffComment {
  return {
    ...comment,
    source: comment.source ?? "manual",
    readonly: comment.readonly ?? false,
  };
}

function saveComments(storageKey: string, comments: DiffComment[]) {
  if (comments.length === 0) {
    localStorage.removeItem(storageKey);
  } else {
    localStorage.setItem(storageKey, JSON.stringify(comments));
  }
}

export function useDiffComments(storageKey: string) {
  const [comments, setComments] = useState<DiffComment[]>(() =>
    loadComments(storageKey)
  );

  // Re-load when storageKey changes
  useEffect(() => {
    setComments(loadComments(storageKey));
  }, [storageKey]);

  // Persist on every change
  useEffect(() => {
    saveComments(storageKey, comments);
  }, [storageKey, comments]);

  const commentsByLine = useMemo(() => {
    const map = new Map<string, DiffComment[]>();
    for (const c of comments) {
      const existing = map.get(c.lineKey);
      if (existing) {
        existing.push(c);
      } else {
        map.set(c.lineKey, [c]);
      }
    }
    return map;
  }, [comments]);

  const addComment = useCallback(
    (
      filePath: string,
      lineKey: string,
      lineKind: "add" | "delete" | "context",
      lineContent: string,
      lineNumber: number,
      comment: string
    ) => {
      const newComment = createManualDiffComment({
        filePath,
        lineKey,
        lineKind,
        lineContent,
        lineNumber,
        comment,
      });
      setComments((prev) => [...prev, newComment]);
    },
    []
  );

  const updateComment = useCallback((id: string, comment: string) => {
    setComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, comment } : c))
    );
  }, []);

  const deleteComment = useCallback((id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setComments([]);
  }, []);

  const clearManualComments = useCallback(() => {
    setComments((prev) => prev.filter((comment) => comment.source !== "manual"));
  }, []);

  const replaceSemanticReviewComments = useCallback((nextComments: DiffComment[]) => {
    setComments((prev) => applySemanticReviewComments(prev, nextComments));
  }, []);

  return {
    comments,
    commentsByLine,
    addComment,
    updateComment,
    deleteComment,
    clearAll,
    clearManualComments,
    replaceSemanticReviewComments,
  };
}
