import { useState, useEffect, type FormEvent } from "react";
import {
  GitBranch,
  ChevronRight,
  ChevronDown,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  MoreHorizontal,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Tab } from "../../App";
import type { BranchInfo, RepoInfo, WorktreeInfo } from "../../lib/ipc";
import {
  useCreateWorktreeMutation,
  useDeleteBranchMutation,
  useDeleteWorktreeMutation,
  useRegisterRepoMutation,
  useReposQuery,
  useUnregisterRepoMutation,
  useHideRepoMutation,
} from "../../hooks/use-tauri-query";
import { canDeletePlainBranch } from "./branch-delete-state.ts";
import { buildCreateWorktreeDraft } from "./worktree-dialog-state.ts";
import { isRepoRefreshing } from "./refresh-state";
import { deriveSuggestedWorktreePath } from "./worktree-paths.ts";

interface SidebarProps {
  activeTab: Tab;
  width: number;
  busyTabIds: Set<string>;
  tabs: Tab[];
  onBranchSelect: (branch: BranchInfo, repoPath: string) => void;
  onBranchDeleted: (branchName: string, repoPath: string) => void;
  onWorktreeDeleted: (worktreePath: string) => void;
  onWorktreeSelect: (wt: WorktreeInfo) => void;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
}

interface CreateWorktreeDialogState {
  repoPath: string;
  mode: "existing" | "new";
  branchName: string;
  targetPath: string;
  pathEdited: boolean;
  error: string | null;
}

interface DeleteWorktreeDialogState {
  repoPath: string;
  worktree: WorktreeInfo;
  error: string | null;
  forceAvailable: boolean;
}

interface DeleteBranchDialogState {
  repoPath: string;
  branchName: string;
  error: string | null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAvailableExistingBranches(repo: RepoInfo): string[] {
  const worktreeBranches = new Set(repo.worktrees.map((worktree) => worktree.branch));
  return repo.branches
    .filter((branch) => !branch.is_head && !worktreeBranches.has(branch.name))
    .map((branch) => branch.name);
}

export function Sidebar({
  activeTab,
  width: _width,
  busyTabIds,
  tabs,
  onBranchSelect,
  onBranchDeleted,
  onWorktreeDeleted,
  onWorktreeSelect,
  onResizeStart,
}: SidebarProps) {
  const { data: realRepos, isLoading, error, refetch } = useReposQuery();
  const registerMutation = useRegisterRepoMutation();
  const unregisterMutation = useUnregisterRepoMutation();
  const hideMutation = useHideRepoMutation();
  const createWorktreeMutation = useCreateWorktreeMutation();
  const deleteBranchMutation = useDeleteBranchMutation();
  const deleteWorktreeMutation = useDeleteWorktreeMutation();

  const repos = realRepos ?? [];

  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [repoListCollapsed, setRepoListCollapsed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [refreshingRepoPath, setRefreshingRepoPath] = useState<string | null>(null);
  const [openDropdownRepo, setOpenDropdownRepo] = useState<string | null>(null);
  const [openDropdownBranch, setOpenDropdownBranch] = useState<string | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [createDialog, setCreateDialog] = useState<CreateWorktreeDialogState | null>(null);
  const [deleteBranchDialog, setDeleteBranchDialog] = useState<DeleteBranchDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteWorktreeDialogState | null>(null);


  const createRepo = createDialog
    ? repos.find((repo) => repo.path === createDialog.repoPath) ?? null
    : null;
  const createAvailableBranches = createRepo ? getAvailableExistingBranches(createRepo) : [];
  const worktreeBranches = new Set(
    repos.flatMap((repo) => repo.worktrees.map((worktree) => worktree.branch))
  );

  const searchTerm = sidebarSearch.trim().toLowerCase();
  const filteredRepos = searchTerm
    ? repos
      .map((repo) => {
        const repoNameMatch = repo.name.toLowerCase().includes(searchTerm);
        const matchingBranches = repo.branches.filter((b) =>
          b.name.toLowerCase().includes(searchTerm)
        );
        if (repoNameMatch || matchingBranches.length > 0) {
          return repo;
        }
        return null;
      })
      .filter((r): r is RepoInfo => r !== null)
    : repos;

  // Close dropdowns on click outside
  useEffect(() => {
    if (!openDropdownRepo && !openDropdownBranch) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (openDropdownRepo && !target.closest("[data-repo-dropdown]")) {
        setOpenDropdownRepo(null);
      }
      if (openDropdownBranch && !target.closest("[data-branch-dropdown]")) {
        setOpenDropdownBranch(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openDropdownRepo, openDropdownBranch]);

  // Auto-expand repos that have matching branches when searching
  useEffect(() => {
    if (!searchTerm) return;
    const toExpand = new Set<string>();
    for (const repo of repos) {
      const repoNameMatch = repo.name.toLowerCase().includes(searchTerm);
      const hasBranchMatch = repo.branches.some((b) =>
        b.name.toLowerCase().includes(searchTerm)
      );
      if (repoNameMatch || hasBranchMatch) {
        toExpand.add(repo.path);
      }
    }
    if (toExpand.size > 0) {
      setExpandedRepos((prev) => {
        const next = new Set(prev);
        for (const p of toExpand) next.add(p);
        return next;
      });
    }
  }, [searchTerm, repos]);

  async function handleAddRepo() {
    setSidebarError(null);
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    registerMutation.mutate(selected, {
      onError: (mutationError) => {
        setSidebarError(getErrorMessage(mutationError));
      },
    });
  }

  async function handleRefreshRepo(repoPath: string) {
    setSidebarError(null);
    setRefreshingRepoPath(repoPath);

    try {
      const result = await refetch();
      if (result.error) {
        setSidebarError(getErrorMessage(result.error));
      }
    } catch (refreshError) {
      setSidebarError(getErrorMessage(refreshError));
    } finally {
      setRefreshingRepoPath(null);
    }
  }

  function handleOpenCreateDialog(repo: RepoInfo) {
    const draft = buildCreateWorktreeDraft(repo);
    setSidebarError(null);
    setCreateDialog({
      repoPath: repo.path,
      mode: draft.mode,
      branchName: draft.branchName,
      targetPath: draft.targetPath,
      pathEdited: false,
      error: null,
    });
  }

  function updateCreateDialog(
    updater: (current: CreateWorktreeDialogState) => CreateWorktreeDialogState
  ) {
    setCreateDialog((current) => (current ? updater(current) : current));
  }

  function handleCreateModeChange(mode: "existing" | "new") {
    updateCreateDialog((current) => {
      if (!createRepo) return current;
      const nextBranchName =
        mode === "existing"
          ? createAvailableBranches[0] ?? ""
          : current.mode === "new"
            ? current.branchName
            : "";
      const nextTargetPath = current.pathEdited
        ? current.targetPath
        : deriveSuggestedWorktreePath(createRepo.path, nextBranchName);

      return {
        ...current,
        mode,
        branchName: nextBranchName,
        targetPath: nextTargetPath,
        error: null,
      };
    });
  }

  function handleCreateBranchNameChange(branchName: string) {
    updateCreateDialog((current) => ({
      ...current,
      branchName,
      targetPath: current.pathEdited
        ? current.targetPath
        : deriveSuggestedWorktreePath(current.repoPath, branchName),
      error: null,
    }));
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createDialog) return;

    setSidebarError(null);
    updateCreateDialog((current) => ({ ...current, error: null }));

    try {
      await createWorktreeMutation.mutateAsync({
        repoPath: createDialog.repoPath,
        options: {
          mode: createDialog.mode,
          branchName: createDialog.branchName,
          targetPath: createDialog.targetPath,
        },
      });
      setCreateDialog(null);
    } catch (mutationError) {
      const message = getErrorMessage(mutationError);
      setSidebarError(message);
      updateCreateDialog((current) => ({ ...current, error: message }));
    }
  }

  function handleOpenDeleteDialog(repoPath: string, worktree: WorktreeInfo) {
    setSidebarError(null);
    setDeleteDialog({
      repoPath,
      worktree,
      error: null,
      forceAvailable: false,
    });
  }

  function handleOpenDeleteBranchDialog(repoPath: string, branchName: string) {
    setSidebarError(null);
    setDeleteBranchDialog({
      repoPath,
      branchName,
      error: null,
    });
  }

  async function handleDeleteBranchSubmit() {
    if (!deleteBranchDialog) return;

    setSidebarError(null);
    setDeleteBranchDialog((current) => (current ? { ...current, error: null } : current));

    try {
      await deleteBranchMutation.mutateAsync({
        repoPath: deleteBranchDialog.repoPath,
        branchName: deleteBranchDialog.branchName,
      });
      onBranchDeleted(deleteBranchDialog.branchName, deleteBranchDialog.repoPath);
      setDeleteBranchDialog(null);
    } catch (mutationError) {
      const message = getErrorMessage(mutationError);
      setSidebarError(message);
      setDeleteBranchDialog((current) =>
        current ? { ...current, error: message } : current
      );
    }
  }

  async function handleDeleteSubmit(force: boolean) {
    if (!deleteDialog) return;

    setSidebarError(null);
    setDeleteDialog((current) => (current ? { ...current, error: null } : current));

    try {
      await deleteWorktreeMutation.mutateAsync({
        repoPath: deleteDialog.repoPath,
        options: {
          worktreePath: deleteDialog.worktree.path,
          branchName: deleteDialog.worktree.branch,
          force,
        },
      });
      onWorktreeDeleted(deleteDialog.worktree.path);
      setDeleteDialog(null);
    } catch (mutationError) {
      const message = getErrorMessage(mutationError);
      setSidebarError(message);
      setDeleteDialog((current) =>
        current
          ? {
            ...current,
            error: message,
            forceAvailable: current.forceAvailable || !force,
          }
          : current
      );
    }
  }

  useEffect(() => {
    setExpandedRepos(new Set(repos.map((repo) => repo.path)));
  }, [repos]);

  function toggleRepo(path: string) {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const createSubmitDisabled =
    createWorktreeMutation.isPending ||
    !createDialog ||
    !createDialog.branchName.trim() ||
    !createDialog.targetPath.trim() ||
    (createDialog.mode === "existing" && createAvailableBranches.length === 0);

  if (collapsed) {
    return (
      <>
        <div className="flex w-[48px] shrink-0 flex-col items-center bg-bg-raised py-3">
          <button
            onClick={() => setCollapsed(false)}
            className="mb-4 flex h-8 w-8 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
          {repos.map((repo) => (
            <button
              key={repo.path}
              className="mb-1 flex h-8 w-8 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
              title={repo.name}
            >
              {repo.name.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
        {createDialog && createRepo && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
            <form
              onSubmit={handleCreateSubmit}
              className="w-full max-w-md rounded-lg border border-border bg-bg-overlay shadow-2xl"
            >
              <div className="flex items-center border-b border-border-subtle px-4 py-3">
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-fg">Create worktree</h3>
                  <p className="mt-1 text-xs text-fg-muted">{createRepo.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateDialog(null)}
                  className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
                  title="Close create worktree dialog"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-4 px-4 py-4">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                    Branch mode
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleCreateModeChange("existing")}
                      disabled={createAvailableBranches.length === 0}
                      className={`rounded border px-3 py-2 text-left text-xs transition-colors ${createDialog.mode === "existing"
                        ? "border-accent bg-accent-bg text-accent-fg"
                        : "border-border bg-bg-raised text-fg-muted hover:border-border-hover hover:text-fg"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      Existing branch
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCreateModeChange("new")}
                      className={`rounded border px-3 py-2 text-left text-xs transition-colors ${createDialog.mode === "new"
                        ? "border-accent bg-accent-bg text-accent-fg"
                        : "border-border bg-bg-raised text-fg-muted hover:border-border-hover hover:text-fg"
                        }`}
                    >
                      New branch
                    </button>
                  </div>
                </div>

                {createDialog.mode === "existing" ? (
                  <label className="block text-xs text-fg-muted">
                    Branch
                    <select
                      value={createDialog.branchName}
                      onChange={(event) => handleCreateBranchNameChange(event.target.value)}
                      className="mt-1 w-full rounded border border-border bg-bg-raised px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent"
                    >
                      {createAvailableBranches.map((branchName) => (
                        <option key={branchName} value={branchName}>
                          {branchName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="block text-xs text-fg-muted">
                    New branch name
                    <input
                      value={createDialog.branchName}
                      onChange={(event) => handleCreateBranchNameChange(event.target.value)}
                      placeholder="feature/my-worktree"
                      className="mt-1 w-full rounded border border-border bg-bg-raised px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent"
                    />
                  </label>
                )}

                <label className="block text-xs text-fg-muted">
                  Target path
                  <input
                    value={createDialog.targetPath}
                    onChange={(event) =>
                      updateCreateDialog((current) => ({
                        ...current,
                        targetPath: event.target.value,
                        pathEdited: true,
                        error: null,
                      }))
                    }
                    className="mt-1 w-full rounded border border-border bg-bg-raised px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent"
                  />
                </label>

                {createDialog.error && (
                  <div className="rounded bg-red-bg px-3 py-2 text-xs text-red">
                    {createDialog.error}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
                <button
                  type="button"
                  onClick={() => setCreateDialog(null)}
                  className="rounded border border-border px-3 py-2 text-xs text-fg-muted transition-colors hover:border-border-hover hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitDisabled}
                  className="rounded bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createWorktreeMutation.isPending ? "Creating..." : "Create worktree"}
                </button>
              </div>
            </form>
          </div>
        )}
        {deleteDialog && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-lg border border-border bg-bg-overlay shadow-2xl">
              <div className="flex items-center border-b border-border-subtle px-4 py-3">
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-fg">Delete worktree</h3>
                  <p className="mt-1 text-xs text-fg-muted">{deleteDialog.worktree.branch}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteDialog(null)}
                  className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
                  title="Close delete worktree dialog"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-3 px-4 py-4">
                <p className="text-sm text-fg-muted">
                  Remove this worktree checkout and delete its branch.
                </p>
                <div className="rounded border border-border bg-bg-raised px-3 py-2 text-xs text-fg-muted">
                  <div>Branch: {deleteDialog.worktree.branch}</div>
                  <div className="mt-1 break-all">Path: {deleteDialog.worktree.path}</div>
                </div>
                {deleteDialog.error && (
                  <div className="rounded bg-red-bg px-3 py-2 text-xs text-red">
                    {deleteDialog.error}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
                <button
                  type="button"
                  onClick={() => setDeleteDialog(null)}
                  className="rounded border border-border px-3 py-2 text-xs text-fg-muted transition-colors hover:border-border-hover hover:text-fg"
                >
                  Cancel
                </button>
                {deleteDialog.forceAvailable && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteSubmit(true)}
                    disabled={deleteWorktreeMutation.isPending}
                    className="rounded border border-red px-3 py-2 text-xs font-medium text-red transition-colors hover:bg-red-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Force delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleDeleteSubmit(false)}
                  disabled={deleteWorktreeMutation.isPending}
                  className="rounded bg-red px-3 py-2 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleteWorktreeMutation.isPending ? "Deleting..." : "Delete worktree"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div
        className="flex flex-1 min-h-0 flex-col bg-bg-raised cursor-col-resize"
        onMouseDown={onResizeStart}
        title="Resize repository sidebar"
      >
        <div className="border-b border-border-subtle p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search"
                className="w-full rounded-lg border border-border bg-bg-overlay py-1.5 pl-8 pr-3 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
              />
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
              title="Collapse sidebar"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
          <button
            onClick={handleAddRepo}
            className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <Plus size={14} />
            New workspace
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          <button
            onClick={() => setRepoListCollapsed(!repoListCollapsed)}
            className="mb-1 flex w-full items-center gap-2 px-4 text-left"
          >
            {repoListCollapsed ? (
              <ChevronRight size={10} className="text-fg-subtle" />
            ) : (
              <ChevronDown size={10} className="text-fg-subtle" />
            )}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Active
            </span>
            {isLoading && <Loader2 size={10} className="animate-spin text-fg-subtle" />}
          </button>

          {error && !repoListCollapsed && (
            <div className="px-4 py-2 text-[11px] text-red">Failed to load repos</div>
          )}

          {sidebarError && !repoListCollapsed && (
            <div className="mx-4 mb-2 rounded bg-red-bg px-2 py-1.5 text-[11px] text-red">
              {sidebarError}
              <button
                onClick={() => setSidebarError(null)}
                className="ml-1 text-fg-subtle hover:text-fg"
              >
                <X size={10} className="inline" />
              </button>
            </div>
          )}

          {!repoListCollapsed &&
            filteredRepos.map((repo) => {
              const repoRefreshing = isRepoRefreshing(refreshingRepoPath, repo.path);

              return (
                <div key={repo.path}>
                  <div className="group flex items-center transition-colors hover:bg-bg-hover">
                    <button
                      onClick={() => toggleRepo(repo.path)}
                      className="flex flex-1 items-center gap-2.5 px-4 py-[7px] text-[13px] text-fg-muted transition-colors group-hover:text-fg"
                    >
                      {expandedRepos.has(repo.path) ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span className="truncate" style={{ maxWidth: 300 }}>{repo.name}</span>
                    </button>
                    <div className="relative" data-repo-dropdown>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenDropdownRepo(openDropdownRepo === repo.path ? null : repo.path);
                        }}
                        className="mr-2 flex h-5 w-5 items-center justify-center rounded transition-opacity hover:bg-bg-hover opacity-0 group-hover:opacity-100"
                        title="Repo actions"
                      >
                        <MoreHorizontal size={12} className="text-fg-subtle" />
                      </button>
                      {openDropdownRepo === repo.path && (
                        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-border bg-bg-raised py-1 shadow-lg">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownRepo(null);
                              handleOpenCreateDialog(repo);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg"
                          >
                            <Plus size={12} />
                            Create worktree
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownRepo(null);
                              setCreateDialog({
                                repoPath: repo.path,
                                mode: "new",
                                branchName: "",
                                targetPath: deriveSuggestedWorktreePath(repo.path, ""),
                                pathEdited: false,
                                error: null,
                              });
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg"
                          >
                            <GitBranch size={12} />
                            Create branch
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownRepo(null);
                              void handleRefreshRepo(repo.path);
                            }}
                            disabled={repoRefreshing}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg disabled:cursor-wait disabled:opacity-50"
                          >
                            {repoRefreshing ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            Refresh
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownRepo(null);
                              if (repo.registered) {
                                unregisterMutation.mutate(repo.path);
                              } else {
                                hideMutation.mutate(repo.path);
                              }
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red hover:bg-bg-hover"
                          >
                            <Trash2 size={12} />
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {expandedRepos.has(repo.path) && (
                    <div className="pl-8">
                      {repo.branches.map((branch) => {
                        const worktree = repo.worktrees.find(
                          (candidate) => candidate.branch === branch.name
                        );
                        const isWorktree = worktreeBranches.has(branch.name);
                        const isActive =
                          activeTab.branch === branch.name &&
                          activeTab.repoPath === (worktree?.path ?? repo.path);
                        const canDeleteWorktree =
                          !!worktree &&
                          !worktree.is_main &&
                          activeTab.repoPath !== worktree.path;
                        const canDeleteBranch = !isWorktree && canDeletePlainBranch({
                          branchName: branch.name,
                          branchIsHead: branch.is_head,
                          hasWorktree: false,
                          activeTabBranch: activeTab.branch,
                          activeTabRepoPath: activeTab.repoPath,
                          repoPath: repo.path,
                        });
                        const deleteBranchTitle = branch.is_head
                          ? "Cannot delete the current repo HEAD branch"
                          : activeTab.branch === branch.name && activeTab.repoPath === repo.path
                            ? "Switch away from this branch before deleting it"
                            : "Delete branch";

                        const isBranchBusy = tabs.some(
                          (t) =>
                            busyTabIds.has(t.id) &&
                            t.branch === branch.name &&
                            t.repoPath === (worktree?.path ?? repo.path)
                        );

                        return (
                          <div key={branch.name} className={`group flex items-center transition-colors ${isActive
                                ? "bg-accent-bg"
                                : "hover:bg-bg-hover"
                                }`}>
                            <button
                              onClick={() => {
                                if (worktree) {
                                  onWorktreeSelect(worktree);
                                } else {
                                  onBranchSelect(branch, repo.path);
                                }
                              }}
                              className={`flex flex-1 items-center gap-2 px-2 py-[7px] text-[13px] transition-colors ${isActive
                                ? "text-accent-fg"
                                : "text-fg-muted group-hover:text-fg"
                                }`}
                            >
                              <GitBranch size={12} />
                              <span className="truncate" style={{ maxWidth: 300 }}>{branch.name}</span>
                              <span className="ml-auto flex items-center gap-1.5">
                                {isBranchBusy && (
                                  <span
                                    className="h-[6px] w-[6px] rounded-full bg-orange-400"
                                    style={{ animation: "pulse 1.5s ease-in-out infinite" }}
                                    title="Agent is working"
                                  />
                                )}
                                {isWorktree && (
                                  <span className="rounded bg-green-bg px-1.5 py-0.5 text-[9px] font-medium text-green">
                                    Ready
                                  </span>
                                )}
                              </span>
                            </button>
                            <div className="relative" data-branch-dropdown>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const key = `${repo.path}:${branch.name}`;
                                  setOpenDropdownBranch(openDropdownBranch === key ? null : key);
                                }}
                                className="mr-2 flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-bg-hover group-hover:opacity-100"
                                title="Branch actions"
                              >
                                <MoreHorizontal size={12} className="text-fg-subtle" />
                              </button>
                              {openDropdownBranch === `${repo.path}:${branch.name}` && (
                                <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-border bg-bg-raised py-1 shadow-lg">
                                  {worktree && !worktree.is_main && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenDropdownBranch(null);
                                        if (canDeleteWorktree) {
                                          handleOpenDeleteDialog(repo.path, worktree);
                                        }
                                      }}
                                      disabled={!canDeleteWorktree}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <Trash2 size={12} />
                                      {canDeleteWorktree
                                        ? "Delete worktree"
                                        : "Switch away first"}
                                    </button>
                                  )}
                                  {!worktree && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenDropdownBranch(null);
                                        if (canDeleteBranch) {
                                          handleOpenDeleteBranchDialog(repo.path, branch.name);
                                        }
                                      }}
                                      disabled={!canDeleteBranch}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                                      title={deleteBranchTitle}
                                    >
                                      <Trash2 size={12} />
                                      {canDeleteBranch
                                        ? "Delete branch"
                                        : branch.is_head
                                          ? "Cannot delete HEAD"
                                          : "Switch away first"}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

          {!repoListCollapsed && filteredRepos.length === 0 && !isLoading && !error && (
            <div className="px-4 py-6 text-center text-[11px] text-fg-subtle">
              {searchTerm ? "No matching repositories" : "No repositories discovered"}
            </div>
          )}

        </div>
      </div>
      <div
        onMouseDown={onResizeStart}
        className="shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent"
        title="Resize repository sidebar"
      />
      {createDialog && createRepo && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleCreateSubmit}
            className="w-full max-w-md rounded-lg border border-border bg-bg-overlay shadow-2xl"
          >
            <div className="flex items-center border-b border-border-subtle px-4 py-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-fg">Create worktree</h3>
                <p className="mt-1 text-xs text-fg-muted">{createRepo.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setCreateDialog(null)}
                className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
                title="Close create worktree dialog"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-4 px-4 py-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                  Branch mode
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleCreateModeChange("existing")}
                    disabled={createAvailableBranches.length === 0}
                    className={`rounded border px-3 py-2 text-left text-xs transition-colors ${createDialog.mode === "existing"
                      ? "border-accent bg-accent-bg text-accent-fg"
                      : "border-border bg-bg-raised text-fg-muted hover:border-border-hover hover:text-fg"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    Existing branch
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreateModeChange("new")}
                    className={`rounded border px-3 py-2 text-left text-xs transition-colors ${createDialog.mode === "new"
                      ? "border-accent bg-accent-bg text-accent-fg"
                      : "border-border bg-bg-raised text-fg-muted hover:border-border-hover hover:text-fg"
                      }`}
                  >
                    New branch
                  </button>
                </div>
              </div>

              {createDialog.mode === "existing" ? (
                <label className="block text-xs text-fg-muted">
                  Branch
                  <select
                    value={createDialog.branchName}
                    onChange={(event) => handleCreateBranchNameChange(event.target.value)}
                    className="mt-1 w-full rounded border border-border bg-bg-raised px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent"
                  >
                    {createAvailableBranches.map((branchName) => (
                      <option key={branchName} value={branchName}>
                        {branchName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block text-xs text-fg-muted">
                  New branch name
                  <input
                    value={createDialog.branchName}
                    onChange={(event) => handleCreateBranchNameChange(event.target.value)}
                    placeholder="feature/my-worktree"
                    className="mt-1 w-full rounded border border-border bg-bg-raised px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent"
                  />
                </label>
              )}

              <label className="block text-xs text-fg-muted">
                Target path
                <input
                  value={createDialog.targetPath}
                  onChange={(event) =>
                    updateCreateDialog((current) => ({
                      ...current,
                      targetPath: event.target.value,
                      pathEdited: true,
                      error: null,
                    }))
                  }
                  className="mt-1 w-full rounded border border-border bg-bg-raised px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent"
                />
              </label>

              {createDialog.error && (
                <div className="rounded bg-red-bg px-3 py-2 text-xs text-red">
                  {createDialog.error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
              <button
                type="button"
                onClick={() => setCreateDialog(null)}
                className="rounded border border-border px-3 py-2 text-xs text-fg-muted transition-colors hover:border-border-hover hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createSubmitDisabled}
                className="rounded bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createWorktreeMutation.isPending ? "Creating..." : "Create worktree"}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteBranchDialog && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-overlay shadow-2xl">
            <div className="flex items-center border-b border-border-subtle px-4 py-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-fg">Delete branch</h3>
                <p className="mt-1 text-xs text-fg-muted">{deleteBranchDialog.branchName}</p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteBranchDialog(null)}
                className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
                title="Close delete branch dialog"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <p className="text-sm text-fg-muted">
                Delete this branch from the main repository checkout.
              </p>
              <div className="rounded border border-border bg-bg-raised px-3 py-2 text-xs text-fg-muted">
                <div>Branch: {deleteBranchDialog.branchName}</div>
                <div className="mt-1 break-all">Repo: {deleteBranchDialog.repoPath}</div>
              </div>
              {deleteBranchDialog.error && (
                <div className="rounded bg-red-bg px-3 py-2 text-xs text-red">
                  {deleteBranchDialog.error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
              <button
                type="button"
                onClick={() => setDeleteBranchDialog(null)}
                className="rounded border border-border px-3 py-2 text-xs text-fg-muted transition-colors hover:border-border-hover hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteBranchSubmit()}
                disabled={deleteBranchMutation.isPending}
                className="rounded bg-red px-3 py-2 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteBranchMutation.isPending ? "Deleting..." : "Delete branch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-overlay shadow-2xl">
            <div className="flex items-center border-b border-border-subtle px-4 py-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-fg">Delete worktree</h3>
                <p className="mt-1 text-xs text-fg-muted">{deleteDialog.worktree.branch}</p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
                title="Close delete worktree dialog"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <p className="text-sm text-fg-muted">
                Remove this worktree checkout and delete its branch.
              </p>
              <div className="rounded border border-border bg-bg-raised px-3 py-2 text-xs text-fg-muted">
                <div>Branch: {deleteDialog.worktree.branch}</div>
                <div className="mt-1 break-all">Path: {deleteDialog.worktree.path}</div>
              </div>
              {deleteDialog.error && (
                <div className="rounded bg-red-bg px-3 py-2 text-xs text-red">
                  {deleteDialog.error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="rounded border border-border px-3 py-2 text-xs text-fg-muted transition-colors hover:border-border-hover hover:text-fg"
              >
                Cancel
              </button>
              {deleteDialog.forceAvailable && (
                <button
                  type="button"
                  onClick={() => void handleDeleteSubmit(true)}
                  disabled={deleteWorktreeMutation.isPending}
                  className="rounded border border-red px-3 py-2 text-xs font-medium text-red transition-colors hover:bg-red-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Force delete
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleDeleteSubmit(false)}
                disabled={deleteWorktreeMutation.isPending}
                className="rounded bg-red px-3 py-2 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteWorktreeMutation.isPending ? "Deleting..." : "Delete worktree"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
