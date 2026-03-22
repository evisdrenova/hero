import { invoke } from "@tauri-apps/api/core";

// Git types
export interface RepoInfo {
  path: string;
  name: string;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  registered: boolean;
}

export interface BranchInfo {
  name: string;
  is_head: boolean;
  checkpoint_count: number;
  additions: number;
  deletions: number;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  is_main: boolean;
}

export interface CreateWorktreeOptions {
  mode: "existing" | "new";
  branchName: string;
  targetPath: string;
}

export interface DeleteWorktreeOptions {
  worktreePath: string;
  branchName: string;
  force: boolean;
}

// Checkpoint types
export interface CheckpointSummary {
  checkpoint_id: string;
  branch: string;
  commit_sha: string;
  commit_message: string;
  files_touched: string[];
  sessions: SessionSummary[];
  token_usage: TokenUsage | null;
  created_at: string;
  additions: number;
  deletions: number;
}

export interface SessionSummary {
  session_id: string;
  agent: string;
  model: string | null;
  step_count: number;
  summary: SessionSummaryInfo | null;
  token_usage: TokenUsage | null;
  initial_attribution: Attribution | null;
  prompt: string | null;
}

export interface SessionSummaryInfo {
  intent: string;
  outcome: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface Attribution {
  agent_lines: number;
  human_added: number;
  human_modified: number;
  total_committed: number;
  agent_percentage: number;
}

// Session/transcript types
export interface TranscriptMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  timestamp: string | null;
}

// Diff types
export interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted";
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: "add" | "delete" | "context";
  content: string;
  old_lineno: number | null;
  new_lineno: number | null;
}

export interface SemanticReviewAnnotation {
  file_path: string;
  line_key: string;
  line_kind: "add" | "delete" | "context";
  line_number: number;
  line_content: string;
  summary: string;
  rationale: string | null;
  importance: string | null;
}

export interface RunCheckpointSemanticReviewResponse {
  review_run_id: string;
  annotations: SemanticReviewAnnotation[];
}

// Session state (matches Rust SessionState)
export interface SessionState {
  session_id: string | null;
  base_commit: string | null;
  phase: string | null;
  agent_type: string | null;
  model_name: string | null;
  step_count: number | null;
  files_touched: string[] | null;
}

// Debug types
export interface EntireSettings {
  enabled: boolean | null;
  local_dev: boolean | null;
  log_level: string | null;
  telemetry: boolean | null;
}

export interface EntireLogResult {
  lines: string[];
  total_lines: number;
  file_size_bytes: number;
}

// Ghostty surface types
export interface GhosttySurface {
  id: string;
  agent: string;
  workingDir: string;
}

// IPC wrappers
export async function listRepos(): Promise<RepoInfo[]> {
  return invoke("list_repos");
}

export async function createWorktree(
  repoPath: string,
  options: CreateWorktreeOptions
): Promise<void> {
  return invoke("create_worktree", {
    repoPath,
    mode: options.mode,
    branchName: options.branchName,
    targetPath: options.targetPath,
  });
}

export async function deleteWorktree(
  repoPath: string,
  options: DeleteWorktreeOptions
): Promise<void> {
  return invoke("delete_worktree", {
    repoPath,
    worktreePath: options.worktreePath,
    branchName: options.branchName,
    force: options.force,
  });
}

export async function deleteBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  return invoke("delete_branch", {
    repoPath,
    branchName,
  });
}

export async function listCheckpoints(
  repoPath: string,
  branch: string
): Promise<CheckpointSummary[]> {
  return invoke("list_checkpoints", { repoPath, branch });
}

export async function getTranscript(
  repoPath: string,
  checkpointId: string,
  sessionIndex: number
): Promise<TranscriptMessage[]> {
  return invoke("get_transcript", { repoPath, checkpointId, sessionIndex });
}

export async function getBranchDiff(
  repoPath: string,
  branch: string
): Promise<FileDiff[]> {
  return invoke("get_branch_diff", { repoPath, branch });
}

export async function getCheckpointDiff(
  repoPath: string,
  commitSha: string
): Promise<FileDiff[]> {
  return invoke("get_checkpoint_diff", { repoPath, commitSha });
}

export async function runCheckpointSemanticReview(
  repoPath: string,
  checkpointId: string,
  commitSha: string
): Promise<RunCheckpointSemanticReviewResponse> {
  return invoke("run_checkpoint_semantic_review", {
    repoPath,
    checkpointId,
    commitSha,
  });
}

export async function listSessions(
  repoPath: string
): Promise<SessionState[]> {
  return invoke("list_sessions", { repoPath });
}

export async function getEntireSettings(
  repoPath: string
): Promise<EntireSettings> {
  return invoke("get_entire_settings", { repoPath });
}

export async function getEntireLogs(
  repoPath: string,
  tailLines: number
): Promise<EntireLogResult> {
  return invoke("get_entire_logs", { repoPath, tailLines });
}

export async function getRawCheckpointMetadata(
  repoPath: string,
  checkpointId: string
): Promise<string> {
  return invoke("get_raw_checkpoint_metadata", { repoPath, checkpointId });
}

export async function getRawSessionFile(
  repoPath: string,
  sessionId: string
): Promise<string> {
  return invoke("get_raw_session_file", { repoPath, sessionId });
}

export async function getCheckpointLogs(
  repoPath: string,
  checkpointId: string,
  sessionIds: string[]
): Promise<EntireLogResult> {
  return invoke("get_checkpoint_logs", { repoPath, checkpointId, sessionIds });
}

// Ghostty surface IPC wrappers
export async function ghosttyCreateSurface(
  workingDir: string,
  command?: string
): Promise<string> {
  return invoke("ghostty_create_surface", { workingDir, command });
}

export async function ghosttyDestroySurface(surfaceId: string): Promise<void> {
  return invoke("ghostty_destroy_surface", { surfaceId });
}

export async function ghosttyUpdateOverlay(
  surfaceId: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  return invoke("ghostty_update_overlay", { surfaceId, x, y, width, height });
}

export async function ghosttyShowOverlay(
  surfaceId: string,
  visible: boolean
): Promise<void> {
  return invoke("ghostty_show_overlay", { surfaceId, visible });
}

export async function ghosttyFocusOverlay(surfaceId: string): Promise<void> {
  return invoke("ghostty_focus_overlay", { surfaceId });
}

export async function registerRepo(path: string): Promise<void> {
  return invoke("register_repo", { path });
}

export async function unregisterRepo(path: string): Promise<void> {
  return invoke("unregister_repo", { path });
}

export async function ghosttySendText(
  surfaceId: string,
  text: string
): Promise<void> {
  return invoke("ghostty_send_text", { surfaceId, text });
}
