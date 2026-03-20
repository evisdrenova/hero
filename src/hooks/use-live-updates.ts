import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "./use-tauri-event";

/**
 * Watch a repo for file changes and auto-invalidate relevant queries.
 * Starts the Rust file watcher for the repo on mount.
 */
export function useLiveUpdates(repoPath: string) {
  const queryClient = useQueryClient();
  const startedRef = useRef<Set<string>>(new Set());

  // Start watching on mount
  useEffect(() => {
    if (!repoPath || startedRef.current.has(repoPath)) return;
    startedRef.current.add(repoPath);

    invoke("watch_repo", { repoPath }).catch((err) => {
      console.warn("Failed to start file watcher:", err);
    });
  }, [repoPath]);

  // Invalidate checkpoint queries when checkpoints change
  useTauriEvent<{ repoPath: string }>("checkpoint-changed", (payload) => {
    if (payload.repoPath === repoPath || !repoPath) {
      queryClient.invalidateQueries({ queryKey: ["checkpoints"] });
    }
  });

  // Invalidate session queries when sessions change
  useTauriEvent<{ repoPath: string }>("session-changed", (payload) => {
    if (payload.repoPath === repoPath || !repoPath) {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      // Also refresh checkpoints since a session change may mean new checkpoint
      queryClient.invalidateQueries({ queryKey: ["checkpoints"] });
    }
  });

  // Invalidate repo config queries when config changes
  useTauriEvent<{ repoPath: string }>("config-changed", (_payload) => {
    queryClient.invalidateQueries({ queryKey: ["repos"] });
  });
}
