# Delta Workflow System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Delta workflow system that orchestrates multiple AI agents working in parallel across isolated git worktrees, coordinated through a shared file-based workspace with a strict task DAG and verification gates.

**Architecture:** File-based shared workspace (`~/.entire/deltas/{id}/`) with append-only events. Rust orchestrator manages DAG evaluation, agent spawning, and gate execution. Frontend split view shows event feed + live plan. Agents communicate by writing JSON event files — no special SDK needed.

**Tech Stack:** Rust (Tauri 2, portable-pty, notify, git2, serde), React 19, TypeScript, TailwindCSS, React Query, xterm.js, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-22-delta-workflow-design.md`

---

## File Map

### New Rust files
| File | Purpose |
|------|---------|
| `src-tauri/src/delta/mod.rs` | Delta types, CRUD commands, state management |
| `src-tauri/src/delta/orchestrator.rs` | DAG evaluation, agent spawning, task lifecycle |
| `src-tauri/src/delta/events.rs` | Event parsing, file watcher, routing |
| `src-tauri/src/delta/gates.rs` | Gate execution with timeouts |
| `src-tauri/src/delta/planner.rs` | Planning phase setup, plan-to-DAG parsing |

### Modified Rust files
| File | Change |
|------|--------|
| `src-tauri/src/pty/mod.rs` | Add `env_vars` param to `pty_create` |
| `src-tauri/src/lib.rs` | Register delta module + commands |

### New TypeScript files
| File | Purpose |
|------|---------|
| `src/features/delta/DeltaSidebar.tsx` | Delta list sidebar |
| `src/features/delta/DeltaCreationModal.tsx` | New Delta form |
| `src/features/delta/DeltaSplitView.tsx` | Left/right split container |
| `src/features/delta/EventFeed.tsx` | Chronological event stream |
| `src/features/delta/PlanPane.tsx` | Plan document viewer/editor |
| `src/features/delta/TaskDAG.tsx` | Visual DAG diagram |
| `src/features/delta/QuestionCard.tsx` | Blocking question inline UI |
| `src/features/delta/ReviewSummary.tsx` | Review findings display |
| `src/features/delta/GateResult.tsx` | Gate pass/fail display |
| `src/features/delta/types.ts` | Delta TypeScript types |
| `src/hooks/use-delta-query.ts` | React Query hooks for delta commands |

### Modified TypeScript files
| File | Change |
|------|--------|
| `src/App.tsx` | Extend Tab interface, add delta state, sidebar toggle |
| `src/lib/ipc.ts` | Add delta IPC types |

### Test files
| File | Purpose |
|------|---------|
| `test/delta/delta-types.test.ts` | Type validation and helpers |
| `test/delta/dag-evaluation.test.ts` | DAG topological sort and state transitions |
| `test/delta/event-parsing.test.ts` | Event file parsing |

---

## Phase 1: Backend Foundation — Delta Types & CRUD

### Task 1: Delta Rust types and workspace creation

**Files:**
- Create: `src-tauri/src/delta/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create the delta module with core types**

```rust
// src-tauri/src/delta/mod.rs
pub mod events;
pub mod gates;
pub mod orchestrator;
pub mod planner;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Where all delta workspaces live
fn deltas_root() -> PathBuf {
    dirs::home_dir()
        .expect("no home dir")
        .join(".entire")
        .join("deltas")
}

// ── Delta metadata ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaMetadata {
    pub id: String,
    pub name: String,
    pub status: DeltaStatus,
    pub repos: Vec<DeltaRepo>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DeltaStatus {
    Planning,
    Ready,
    Executing,
    Reviewing,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaRepo {
    pub path: String,
    pub role: String,
}

// ── Task DAG ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDAG {
    pub tasks: Vec<TaskDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDef {
    pub id: String,
    pub title: String,
    pub description: String,
    pub repo: String,
    pub depends_on: Vec<String>,
    pub agent: String,
    pub gates: Vec<GateDef>,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_timeout() -> u64 {
    1800
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GateDef {
    Command { run: String, expect: String },
    FileExists { path: String },
    AgentReview { prompt: String },
}

// ── Task state ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskState {
    pub id: String,
    pub status: TaskStatus,
    pub agent: String,
    pub pty_session_id: Option<String>,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub base_branch: Option<String>,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub gate_results: Vec<GateResultEntry>,
    pub summary: Option<String>,
    pub retry_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Blocked,
    Ready,
    Running,
    BlockedOnQuestion,
    Verifying,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateResultEntry {
    pub gate_index: usize,
    pub gate_type: String,
    pub passed: bool,
    pub output: String,
}

// ── Events ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DeltaEvent {
    Progress {
        task_id: String,
        agent: String,
        message: String,
        timestamp: u64,
    },
    Question {
        id: String,
        task_id: String,
        agent: String,
        blocking: bool,
        question: String,
        #[serde(default)]
        options: Vec<String>,
        timestamp: u64,
    },
    TaskComplete {
        task_id: String,
        agent: String,
        summary: String,
        timestamp: u64,
    },
    PlanUpdate {
        task_id: String,
        agent: String,
        section: String,
        content: String,
        timestamp: u64,
    },
    TaskState {
        task_id: String,
        from: String,
        to: String,
        reason: String,
        timestamp: u64,
    },
    GateResult {
        task_id: String,
        gate_index: usize,
        gate_type: String,
        passed: bool,
        output: String,
        timestamp: u64,
    },
    QuestionAnswered {
        question_id: String,
        answer: String,
        answered_by: String,
        timestamp: u64,
    },
    ReviewFinding {
        task_id: String,
        agent: String,
        severity: String,
        file: String,
        #[serde(default)]
        line: Option<u32>,
        message: String,
        suggestion: String,
        timestamp: u64,
    },
}

// ── CRUD helpers ────────────────────────────────────────────

fn delta_dir(delta_id: &str) -> PathBuf {
    deltas_root().join(delta_id)
}

pub fn create_delta_workspace(
    id: &str,
    name: &str,
    repos: Vec<DeltaRepo>,
) -> Result<DeltaMetadata, String> {
    let dir = delta_dir(id);
    fs::create_dir_all(dir.join("tasks")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("events")).map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let meta = DeltaMetadata {
        id: id.to_string(),
        name: name.to_string(),
        status: DeltaStatus::Planning,
        repos,
        created_at: now,
        updated_at: now,
    };

    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(dir.join("delta.json"), meta_json).map_err(|e| e.to_string())?;
    fs::write(dir.join("plan.md"), "").map_err(|e| e.to_string())?;

    Ok(meta)
}

pub fn list_deltas() -> Result<Vec<DeltaMetadata>, String> {
    let root = deltas_root();
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut deltas = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let meta_path = entry.path().join("delta.json");
        if meta_path.exists() {
            let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
            if let Ok(meta) = serde_json::from_str::<DeltaMetadata>(&content) {
                deltas.push(meta);
            }
        }
    }
    deltas.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(deltas)
}

pub fn get_delta(delta_id: &str) -> Result<DeltaMetadata, String> {
    let path = delta_dir(delta_id).join("delta.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Delta not found: {e}"))?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn get_delta_plan(delta_id: &str) -> Result<String, String> {
    let path = delta_dir(delta_id).join("plan.md");
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub fn update_delta_plan(delta_id: &str, content: &str) -> Result<(), String> {
    let path = delta_dir(delta_id).join("plan.md");
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn update_delta_status(delta_id: &str, status: DeltaStatus) -> Result<(), String> {
    let mut meta = get_delta(delta_id)?;
    meta.status = status;
    meta.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(delta_dir(delta_id).join("delta.json"), json).map_err(|e| e.to_string())
}

pub fn get_delta_dag(delta_id: &str) -> Result<Option<TaskDAG>, String> {
    let path = delta_dir(delta_id).join("dag.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let dag = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(dag))
}

pub fn get_task_states(delta_id: &str) -> Result<Vec<TaskState>, String> {
    let dir = delta_dir(delta_id).join("tasks");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut states = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if entry.path().extension().and_then(|e| e.to_str()) == Some("json") {
            let content = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
            if let Ok(state) = serde_json::from_str::<TaskState>(&content) {
                states.push(state);
            }
        }
    }
    Ok(states)
}

pub fn get_delta_events(delta_id: &str) -> Result<Vec<DeltaEvent>, String> {
    let dir = delta_dir(delta_id).join("events");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut events = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if entry.path().extension().and_then(|e| e.to_str()) == Some("json") {
            let content = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
            if let Ok(event) = serde_json::from_str::<DeltaEvent>(&content) {
                events.push(event);
            }
        }
    }
    Ok(events)
}

pub fn delete_delta(delta_id: &str) -> Result<(), String> {
    let dir = delta_dir(delta_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 2: Create placeholder submodules**

```rust
// src-tauri/src/delta/events.rs
// Event watcher — implemented in Task 4
```

```rust
// src-tauri/src/delta/gates.rs
// Gate execution — implemented in Phase 2
```

```rust
// src-tauri/src/delta/orchestrator.rs
// Orchestrator — implemented in Phase 2
```

```rust
// src-tauri/src/delta/planner.rs
// Planning phase — implemented in Phase 3
```

- [ ] **Step 3: Register delta module and commands in lib.rs**

Add to top of `src-tauri/src/lib.rs`:
```rust
mod delta;
```

Add Tauri commands (below existing commands):
```rust
#[tauri::command]
fn delta_create(name: String, repos: Vec<delta::DeltaRepo>) -> Result<delta::DeltaMetadata, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let id = format!("delta-{}", ts);
    delta::create_delta_workspace(&id, &name, repos)
}

#[tauri::command]
fn delta_list() -> Result<Vec<delta::DeltaMetadata>, String> {
    delta::list_deltas()
}

#[tauri::command]
fn delta_get(delta_id: String) -> Result<delta::DeltaMetadata, String> {
    delta::get_delta(&delta_id)
}

#[tauri::command]
fn delta_get_plan(delta_id: String) -> Result<String, String> {
    delta::get_delta_plan(&delta_id)
}

#[tauri::command]
fn delta_update_plan(delta_id: String, content: String) -> Result<(), String> {
    delta::update_delta_plan(&delta_id, &content)
}

#[tauri::command]
fn delta_get_dag(delta_id: String) -> Result<Option<delta::TaskDAG>, String> {
    delta::get_delta_dag(&delta_id)
}

#[tauri::command]
fn delta_get_tasks(delta_id: String) -> Result<Vec<delta::TaskState>, String> {
    delta::get_task_states(&delta_id)
}

#[tauri::command]
fn delta_get_events(delta_id: String) -> Result<Vec<delta::DeltaEvent>, String> {
    delta::get_delta_events(&delta_id)
}

#[tauri::command]
fn delta_delete(delta_id: String) -> Result<(), String> {
    delta::delete_delta(&delta_id)
}
```

Register in `tauri::generate_handler![]`:
```
delta_create, delta_list, delta_get, delta_get_plan, delta_update_plan,
delta_get_dag, delta_get_tasks, delta_get_events, delta_delete,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors (warnings from empty submodules are fine)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/delta/ src-tauri/src/lib.rs
git commit -m "feat(delta): add Delta types, CRUD commands, and workspace management"
```

---

### Task 2: Add env_vars support to pty_create

**Files:**
- Modify: `src-tauri/src/pty/mod.rs`

- [ ] **Step 1: Add env_vars parameter to pty_create**

In `src-tauri/src/pty/mod.rs`, update the `pty_create` function signature to accept an optional `env_vars` parameter and apply them to the `CommandBuilder`:

```rust
#[tauri::command]
pub fn pty_create(
    app: AppHandle,
    working_dir: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    initial_input: Option<String>,
    env_vars: Option<std::collections::HashMap<String, String>>,  // NEW
    state: State<'_, Mutex<PtyState>>,
) -> Result<String, String> {
```

After `cmd.env_remove("CLAUDECODE");` and before `pair.slave.spawn_command(cmd)`, add:
```rust
    // Inject custom environment variables (e.g., DELTA_WORKSPACE)
    if let Some(vars) = env_vars {
        for (key, value) in vars {
            cmd.env(key, value);
        }
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly. Existing callers pass `None` for env_vars via Tauri's optional deserialization.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pty/mod.rs
git commit -m "feat(pty): add env_vars parameter to pty_create for Delta workspace injection"
```

---

### Task 3: Delta TypeScript types and React Query hooks

**Files:**
- Create: `src/features/delta/types.ts`
- Create: `src/hooks/use-delta-query.ts`
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Create Delta TypeScript types**

```typescript
// src/features/delta/types.ts

export interface DeltaMetadata {
  id: string;
  name: string;
  status: DeltaStatus;
  repos: DeltaRepo[];
  created_at: number;
  updated_at: number;
}

export type DeltaStatus =
  | "planning"
  | "ready"
  | "executing"
  | "reviewing"
  | "completed"
  | "cancelled";

export interface DeltaRepo {
  path: string;
  role: string;
}

export interface TaskDAG {
  tasks: TaskDef[];
}

export interface TaskDef {
  id: string;
  title: string;
  description: string;
  repo: string;
  depends_on: string[];
  agent: string;
  gates: GateDef[];
  timeout_secs?: number;
}

export type GateDef =
  | { type: "command"; run: string; expect: string }
  | { type: "file_exists"; path: string }
  | { type: "agent_review"; prompt: string };

export interface TaskState {
  id: string;
  status: TaskStatus;
  agent: string;
  pty_session_id: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  base_branch: string | null;
  started_at: number | null;
  completed_at: number | null;
  gate_results: GateResultEntry[];
  summary: string | null;
  retry_count: number;
}

export type TaskStatus =
  | "blocked"
  | "ready"
  | "running"
  | "blocked_on_question"
  | "verifying"
  | "done";

export interface GateResultEntry {
  gate_index: number;
  gate_type: string;
  passed: boolean;
  output: string;
}

export type DeltaEvent =
  | { type: "progress"; task_id: string; agent: string; message: string; timestamp: number }
  | { type: "question"; id: string; task_id: string; agent: string; blocking: boolean; question: string; options: string[]; timestamp: number }
  | { type: "task_complete"; task_id: string; agent: string; summary: string; timestamp: number }
  | { type: "plan_update"; task_id: string; agent: string; section: string; content: string; timestamp: number }
  | { type: "task_state"; task_id: string; from: string; to: string; reason: string; timestamp: number }
  | { type: "gate_result"; task_id: string; gate_index: number; gate_type: string; passed: boolean; output: string; timestamp: number }
  | { type: "question_answered"; question_id: string; answer: string; answered_by: string; timestamp: number }
  | { type: "review_finding"; task_id: string; agent: string; severity: string; file: string; line?: number; message: string; suggestion: string; timestamp: number };
```

- [ ] **Step 2: Create React Query hooks for Delta commands**

```typescript
// src/hooks/use-delta-query.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  DeltaMetadata,
  DeltaRepo,
  TaskDAG,
  TaskState,
  DeltaEvent,
} from "../features/delta/types";

export function useDeltaListQuery() {
  return useQuery<DeltaMetadata[]>({
    queryKey: ["deltas"],
    queryFn: () => invoke("delta_list"),
    retry: false,
  });
}

export function useDeltaQuery(deltaId: string | null) {
  return useQuery<DeltaMetadata>({
    queryKey: ["delta", deltaId],
    queryFn: () => invoke("delta_get", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useDeltaPlanQuery(deltaId: string | null) {
  return useQuery<string>({
    queryKey: ["delta-plan", deltaId],
    queryFn: () => invoke("delta_get_plan", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useDeltaDAGQuery(deltaId: string | null) {
  return useQuery<TaskDAG | null>({
    queryKey: ["delta-dag", deltaId],
    queryFn: () => invoke("delta_get_dag", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useDeltaTasksQuery(deltaId: string | null) {
  return useQuery<TaskState[]>({
    queryKey: ["delta-tasks", deltaId],
    queryFn: () => invoke("delta_get_tasks", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useDeltaEventsQuery(deltaId: string | null) {
  return useQuery<DeltaEvent[]>({
    queryKey: ["delta-events", deltaId],
    queryFn: () => invoke("delta_get_events", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useCreateDeltaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, repos }: { name: string; repos: DeltaRepo[] }) =>
      invoke<DeltaMetadata>("delta_create", { name, repos }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deltas"] });
    },
  });
}

export function useUpdateDeltaPlanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deltaId, content }: { deltaId: string; content: string }) =>
      invoke("delta_update_plan", { deltaId, content }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["delta-plan", variables.deltaId] });
    },
  });
}

export function useDeleteDeltaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deltaId: string) => invoke("delta_delete", { deltaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deltas"] });
    },
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/features/delta/types.ts src/hooks/use-delta-query.ts
git commit -m "feat(delta): add TypeScript types and React Query hooks"
```

---

### Task 4: Delta event file watcher

**Files:**
- Create: `src-tauri/src/delta/events.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement the delta event watcher**

```rust
// src-tauri/src/delta/events.rs
use notify::{RecursiveMode, Watcher};
use notify_debouncer_mini::new_debouncer;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;

use super::DeltaEvent;

/// Payload emitted to the frontend for each delta event
#[derive(Debug, Clone, serde::Serialize)]
pub struct DeltaEventPayload {
    pub delta_id: String,
    pub event: DeltaEvent,
}

/// Start watching all delta workspaces for new event files.
/// Emits `delta-event` Tauri events to the frontend.
pub fn start_delta_watcher(app: AppHandle) -> Result<(), String> {
    let deltas_root = super::deltas_root();
    if !deltas_root.exists() {
        std::fs::create_dir_all(&deltas_root).map_err(|e| e.to_string())?;
    }

    let (tx, rx) = mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(300), tx)
        .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&deltas_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        // Keep debouncer alive
        let _debouncer = debouncer;

        while let Ok(Ok(events)) = rx.recv() {
            for event in events {
                let path = &event.path;
                // Only care about new JSON files in events/ directories
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if !path_is_in_events_dir(path) {
                    continue;
                }
                // Extract delta_id from path: ~/.entire/deltas/{delta_id}/events/{file}.json
                if let Some(delta_id) = extract_delta_id(path) {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        if let Ok(delta_event) = serde_json::from_str::<DeltaEvent>(&content) {
                            let _ = app_handle.emit(
                                "delta-event",
                                DeltaEventPayload {
                                    delta_id,
                                    event: delta_event,
                                },
                            );
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

fn path_is_in_events_dir(path: &std::path::Path) -> bool {
    path.parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        == Some("events")
}

fn extract_delta_id(path: &std::path::Path) -> Option<String> {
    // Path: ~/.entire/deltas/{delta_id}/events/{file}.json
    // parent = events/, parent.parent = {delta_id}/
    path.parent()? // events/
        .parent()? // {delta_id}/
        .file_name()?
        .to_str()
        .map(|s| s.to_string())
}
```

- [ ] **Step 2: Start the watcher in lib.rs setup**

In `src-tauri/src/lib.rs`, inside the `run()` function's `setup` closure (or after builder setup), add:

```rust
// In the .setup(|app| { ... }) closure:
delta::events::start_delta_watcher(app.handle().clone())
    .unwrap_or_else(|e| eprintln!("[delta] watcher failed to start: {e}"));
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/delta/events.rs src-tauri/src/lib.rs
git commit -m "feat(delta): add file watcher for delta event directory"
```

---

## Phase 2: Orchestrator — DAG, Gates, Agent Lifecycle

### Task 5: DAG evaluation and topological sort

**Files:**
- Modify: `src-tauri/src/delta/orchestrator.rs`

- [ ] **Step 1: Write DAG evaluation test**

Create `test/delta/dag-evaluation.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

// Pure TS port of DAG logic for testing (mirrors Rust implementation)
interface Task { id: string; depends_on: string[]; status: string }

function findReadyTasks(tasks: Task[]): string[] {
  const doneIds = new Set(tasks.filter(t => t.status === "done").map(t => t.id));
  return tasks
    .filter(t => t.status === "blocked" && t.depends_on.every(dep => doneIds.has(dep)))
    .map(t => t.id);
}

function topologicalSort(tasks: Task[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const task = taskMap.get(id);
    if (!task) return;
    for (const dep of task.depends_on) visit(dep);
    result.push(id);
  }
  for (const t of tasks) visit(t.id);
  return result;
}

function hasCycle(tasks: Task[]): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = taskMap.get(id);
    if (task) {
      for (const dep of task.depends_on) {
        if (dfs(dep)) return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return tasks.some(t => dfs(t.id));
}

test("findReadyTasks: tasks with no deps are ready when blocked", () => {
  const tasks: Task[] = [
    { id: "t1", depends_on: [], status: "blocked" },
    { id: "t2", depends_on: ["t1"], status: "blocked" },
  ];
  assert.deepEqual(findReadyTasks(tasks), ["t1"]);
});

test("findReadyTasks: dependent task becomes ready when dep is done", () => {
  const tasks: Task[] = [
    { id: "t1", depends_on: [], status: "done" },
    { id: "t2", depends_on: ["t1"], status: "blocked" },
    { id: "t3", depends_on: ["t1", "t2"], status: "blocked" },
  ];
  assert.deepEqual(findReadyTasks(tasks), ["t2"]);
});

test("findReadyTasks: multiple independent tasks ready at once", () => {
  const tasks: Task[] = [
    { id: "t1", depends_on: [], status: "blocked" },
    { id: "t2", depends_on: [], status: "blocked" },
    { id: "t3", depends_on: ["t1", "t2"], status: "blocked" },
  ];
  assert.deepEqual(findReadyTasks(tasks), ["t1", "t2"]);
});

test("topologicalSort: linear chain", () => {
  const tasks: Task[] = [
    { id: "t3", depends_on: ["t2"], status: "blocked" },
    { id: "t1", depends_on: [], status: "blocked" },
    { id: "t2", depends_on: ["t1"], status: "blocked" },
  ];
  assert.deepEqual(topologicalSort(tasks), ["t1", "t2", "t3"]);
});

test("hasCycle: no cycle", () => {
  const tasks: Task[] = [
    { id: "t1", depends_on: [], status: "blocked" },
    { id: "t2", depends_on: ["t1"], status: "blocked" },
  ];
  assert.equal(hasCycle(tasks), false);
});

test("hasCycle: detects cycle", () => {
  const tasks: Task[] = [
    { id: "t1", depends_on: ["t2"], status: "blocked" },
    { id: "t2", depends_on: ["t1"], status: "blocked" },
  ];
  assert.equal(hasCycle(tasks), true);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test test/delta/dag-evaluation.test.ts`
Expected: all 6 tests pass

- [ ] **Step 3: Implement the Rust orchestrator with DAG evaluation**

```rust
// src-tauri/src/delta/orchestrator.rs
use super::{
    delta_dir, get_delta, get_delta_dag, get_task_states, update_delta_status,
    DeltaEvent, DeltaStatus, TaskDAG, TaskState, TaskStatus,
};
use std::collections::HashMap;
use std::fs;

/// Evaluate the DAG: find tasks whose dependencies are all done,
/// transition them from Blocked → Ready.
/// Returns the list of task IDs that became ready.
pub fn evaluate_dag(delta_id: &str) -> Result<Vec<String>, String> {
    let dag = get_delta_dag(delta_id)?
        .ok_or_else(|| "No DAG found".to_string())?;
    let states = get_task_states(delta_id)?;
    let state_map: HashMap<String, TaskStatus> = states
        .iter()
        .map(|s| (s.id.clone(), s.status.clone()))
        .collect();

    let done_ids: std::collections::HashSet<String> = states
        .iter()
        .filter(|s| s.status == TaskStatus::Done)
        .map(|s| s.id.clone())
        .collect();

    let mut newly_ready = Vec::new();

    for task_def in &dag.tasks {
        let current_status = state_map
            .get(&task_def.id)
            .cloned()
            .unwrap_or(TaskStatus::Blocked);
        if current_status != TaskStatus::Blocked {
            continue;
        }
        if task_def.depends_on.iter().all(|dep| done_ids.contains(dep)) {
            // Transition to Ready
            update_task_status(delta_id, &task_def.id, TaskStatus::Ready)?;
            newly_ready.push(task_def.id.clone());
        }
    }

    Ok(newly_ready)
}

/// Initialize task state files for all tasks in the DAG.
/// Tasks with no dependencies start as Ready, others as Blocked.
pub fn initialize_tasks(delta_id: &str) -> Result<(), String> {
    let dag = get_delta_dag(delta_id)?
        .ok_or_else(|| "No DAG found".to_string())?;

    for task_def in &dag.tasks {
        let initial_status = if task_def.depends_on.is_empty() {
            TaskStatus::Ready
        } else {
            TaskStatus::Blocked
        };

        let state = TaskState {
            id: task_def.id.clone(),
            status: initial_status,
            agent: task_def.agent.clone(),
            pty_session_id: None,
            worktree_path: None,
            worktree_branch: None,
            base_branch: None,
            started_at: None,
            completed_at: None,
            gate_results: Vec::new(),
            summary: None,
            retry_count: 0,
        };

        write_task_state(delta_id, &state)?;
    }

    Ok(())
}

/// Check if all tasks in the DAG are done.
pub fn all_tasks_done(delta_id: &str) -> Result<bool, String> {
    let states = get_task_states(delta_id)?;
    let dag = get_delta_dag(delta_id)?
        .ok_or_else(|| "No DAG found".to_string())?;
    Ok(dag.tasks.len() == states.iter().filter(|s| s.status == TaskStatus::Done).count())
}

/// Topological sort of tasks (for merge ordering).
pub fn topological_order(dag: &TaskDAG) -> Result<Vec<String>, String> {
    let mut visited = std::collections::HashSet::new();
    let mut result = Vec::new();
    let task_map: HashMap<&str, &super::TaskDef> = dag
        .tasks
        .iter()
        .map(|t| (t.id.as_str(), t))
        .collect();

    fn visit<'a>(
        id: &'a str,
        task_map: &HashMap<&str, &super::TaskDef>,
        visited: &mut std::collections::HashSet<String>,
        result: &mut Vec<String>,
    ) {
        if visited.contains(id) {
            return;
        }
        visited.insert(id.to_string());
        if let Some(task) = task_map.get(id) {
            for dep in &task.depends_on {
                visit(dep, task_map, visited, result);
            }
        }
        result.push(id.to_string());
    }

    for task in &dag.tasks {
        visit(&task.id, &task_map, &mut visited, &mut result);
    }
    Ok(result)
}

// ── Helpers ─────────────────────────────────────────────────

pub fn update_task_status(delta_id: &str, task_id: &str, status: TaskStatus) -> Result<(), String> {
    let path = delta_dir(delta_id).join("tasks").join(format!("{}.json", task_id));
    let mut state: TaskState = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err(format!("Task state not found: {}", task_id));
    };

    state.status = status;
    write_task_state(delta_id, &state)
}

pub fn write_task_state(delta_id: &str, state: &TaskState) -> Result<(), String> {
    let path = delta_dir(delta_id)
        .join("tasks")
        .join(format!("{}.json", state.id));
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn write_system_event(delta_id: &str, event: &DeltaEvent) -> Result<(), String> {
    let dir = delta_dir(delta_id).join("events");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let event_type = match event {
        DeltaEvent::TaskState { .. } => "task_state",
        DeltaEvent::GateResult { .. } => "gate_result",
        DeltaEvent::QuestionAnswered { .. } => "question_answered",
        _ => "system",
    };
    let filename = format!("{}-system-{}.json", ts, event_type);
    let json = serde_json::to_string_pretty(event).map_err(|e| e.to_string())?;
    fs::write(dir.join(filename), json).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/delta/orchestrator.rs test/delta/dag-evaluation.test.ts
git commit -m "feat(delta): implement DAG evaluation, topological sort, task state management"
```

---

### Task 6: Gate execution

**Files:**
- Modify: `src-tauri/src/delta/gates.rs`

- [ ] **Step 1: Implement gate execution**

```rust
// src-tauri/src/delta/gates.rs
use super::{GateDef, GateResultEntry};
use std::process::Command;
use std::time::Duration;

const GATE_TIMEOUT_SECS: u64 = 120;

/// Run a single gate in the given working directory.
pub fn run_gate(gate: &GateDef, gate_index: usize, worktree_path: &str) -> GateResultEntry {
    match gate {
        GateDef::Command { run, expect } => run_command_gate(gate_index, run, expect, worktree_path),
        GateDef::FileExists { path } => run_file_exists_gate(gate_index, path, worktree_path),
        GateDef::AgentReview { prompt: _ } => {
            // Agent review gates are handled separately by the orchestrator
            // (spawns a short-lived review agent). For now, auto-pass.
            GateResultEntry {
                gate_index,
                gate_type: "agent_review".to_string(),
                passed: true,
                output: "Agent review not yet implemented — auto-passing".to_string(),
            }
        }
    }
}

/// Run all gates for a task sequentially. Returns on first failure or all pass.
pub fn run_all_gates(
    gates: &[GateDef],
    worktree_path: &str,
) -> Vec<GateResultEntry> {
    let mut results = Vec::new();
    for (idx, gate) in gates.iter().enumerate() {
        let result = run_gate(gate, idx, worktree_path);
        let passed = result.passed;
        results.push(result);
        if !passed {
            break; // Stop on first failure
        }
    }
    results
}

fn run_command_gate(
    gate_index: usize,
    run_cmd: &str,
    expect: &str,
    worktree_path: &str,
) -> GateResultEntry {
    let result = Command::new("sh")
        .arg("-c")
        .arg(run_cmd)
        .current_dir(worktree_path)
        .output();

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}{}", stdout, stderr);

            let passed = match expect {
                "exit_0" => output.status.success(),
                other => combined.contains(other),
            };

            GateResultEntry {
                gate_index,
                gate_type: "command".to_string(),
                passed,
                output: if combined.len() > 2000 {
                    format!("{}...(truncated)", &combined[..2000])
                } else {
                    combined.to_string()
                },
            }
        }
        Err(e) => GateResultEntry {
            gate_index,
            gate_type: "command".to_string(),
            passed: false,
            output: format!("Failed to execute: {e}"),
        },
    }
}

fn run_file_exists_gate(
    gate_index: usize,
    path: &str,
    worktree_path: &str,
) -> GateResultEntry {
    let full_path = std::path::Path::new(worktree_path).join(path);
    let exists = full_path.exists();
    GateResultEntry {
        gate_index,
        gate_type: "file_exists".to_string(),
        passed: exists,
        output: if exists {
            format!("{} exists", path)
        } else {
            format!("{} not found", path)
        },
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/delta/gates.rs
git commit -m "feat(delta): implement gate execution (command, file_exists, agent_review stub)"
```

---

### Task 7: Plan-to-DAG parsing

**Files:**
- Modify: `src-tauri/src/delta/planner.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement plan-to-DAG extraction**

```rust
// src-tauri/src/delta/planner.rs
use super::{
    delta_dir, get_delta_plan, update_delta_status,
    DeltaStatus, TaskDAG,
};
use std::collections::{HashMap, HashSet};
use std::fs;

/// Extract DAG JSON from plan.md by finding the last ```dag fenced block.
/// Falls back to ```json blocks if no ```dag block found.
pub fn extract_dag_from_plan(plan_content: &str) -> Result<TaskDAG, String> {
    // Look for ```dag blocks first, then ```json
    let dag_json = find_last_fenced_block(plan_content, "dag")
        .or_else(|| find_last_fenced_block(plan_content, "json"))
        .ok_or_else(|| {
            "No ```dag or ```json block found in plan. Ask the planning agent to output the task DAG as a fenced code block.".to_string()
        })?;

    let dag: TaskDAG = serde_json::from_str(&dag_json)
        .map_err(|e| format!("Failed to parse DAG JSON: {e}"))?;

    validate_dag(&dag)?;
    Ok(dag)
}

/// Approve the plan: extract DAG, write dag.json, transition to executing.
pub fn approve_plan(delta_id: &str) -> Result<TaskDAG, String> {
    let plan = get_delta_plan(delta_id)?;
    let dag = extract_dag_from_plan(&plan)?;

    let dag_json = serde_json::to_string_pretty(&dag).map_err(|e| e.to_string())?;
    fs::write(delta_dir(delta_id).join("dag.json"), dag_json).map_err(|e| e.to_string())?;

    update_delta_status(delta_id, DeltaStatus::Executing)?;
    Ok(dag)
}

/// Validate the DAG: check for missing deps, cycles, empty tasks.
fn validate_dag(dag: &TaskDAG) -> Result<(), String> {
    if dag.tasks.is_empty() {
        return Err("DAG has no tasks".to_string());
    }

    let task_ids: HashSet<&str> = dag.tasks.iter().map(|t| t.id.as_str()).collect();

    // Check all depends_on references exist
    for task in &dag.tasks {
        for dep in &task.depends_on {
            if !task_ids.contains(dep.as_str()) {
                return Err(format!(
                    "Task '{}' depends on '{}' which doesn't exist",
                    task.id, dep
                ));
            }
        }
    }

    // Check for cycles using DFS
    if has_cycle(dag) {
        return Err("DAG contains a cycle".to_string());
    }

    Ok(())
}

fn has_cycle(dag: &TaskDAG) -> bool {
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    let task_map: HashMap<&str, &super::TaskDef> =
        dag.tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    fn dfs<'a>(
        id: &'a str,
        task_map: &HashMap<&str, &super::TaskDef>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> bool {
        if visiting.contains(id) {
            return true;
        }
        if visited.contains(id) {
            return false;
        }
        visiting.insert(id.to_string());
        if let Some(task) = task_map.get(id) {
            for dep in &task.depends_on {
                if dfs(dep, task_map, visiting, visited) {
                    return true;
                }
            }
        }
        visiting.remove(id);
        visited.insert(id.to_string());
        false
    }

    dag.tasks.iter().any(|t| dfs(&t.id, &task_map, &mut visiting, &mut visited))
}

fn find_last_fenced_block(content: &str, tag: &str) -> Option<String> {
    let open = format!("```{}", tag);
    let close = "```";
    let mut last_block = None;

    let mut search_from = 0;
    while let Some(start) = content[search_from..].find(&open) {
        let abs_start = search_from + start + open.len();
        // Skip to next line
        let block_start = content[abs_start..]
            .find('\n')
            .map(|i| abs_start + i + 1)
            .unwrap_or(abs_start);
        if let Some(end) = content[block_start..].find(close) {
            let block = content[block_start..block_start + end].trim().to_string();
            last_block = Some(block);
            search_from = block_start + end + close.len();
        } else {
            break;
        }
    }

    last_block
}
```

- [ ] **Step 2: Add the delta_approve_plan command to lib.rs**

```rust
#[tauri::command]
fn delta_approve_plan(delta_id: String) -> Result<delta::TaskDAG, String> {
    let dag = delta::planner::approve_plan(&delta_id)?;
    delta::orchestrator::initialize_tasks(&delta_id)?;
    Ok(dag)
}
```

Register `delta_approve_plan` in `tauri::generate_handler![]`.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles

- [ ] **Step 4: Write a test for plan parsing**

Create `test/delta/plan-parsing.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

// Mirror the Rust fenced-block extraction logic
function findLastFencedBlock(content: string, tag: string): string | null {
  const open = "```" + tag;
  const close = "```";
  let lastBlock: string | null = null;
  let searchFrom = 0;

  while (true) {
    const start = content.indexOf(open, searchFrom);
    if (start === -1) break;
    const afterTag = start + open.length;
    const lineEnd = content.indexOf("\n", afterTag);
    const blockStart = lineEnd === -1 ? afterTag : lineEnd + 1;
    const end = content.indexOf(close, blockStart);
    if (end === -1) break;
    lastBlock = content.slice(blockStart, end).trim();
    searchFrom = end + close.length;
  }

  return lastBlock;
}

test("extracts dag block from plan", () => {
  const plan = `# Plan\n\n\`\`\`dag\n{"tasks":[{"id":"t1"}]}\n\`\`\`\n`;
  const result = findLastFencedBlock(plan, "dag");
  assert.equal(result, '{"tasks":[{"id":"t1"}]}');
});

test("uses last dag block when multiple exist", () => {
  const plan = `\`\`\`dag\n{"old":true}\n\`\`\`\n\nUpdated:\n\`\`\`dag\n{"new":true}\n\`\`\`\n`;
  const result = findLastFencedBlock(plan, "dag");
  assert.equal(result, '{"new":true}');
});

test("returns null when no block found", () => {
  const result = findLastFencedBlock("no code blocks here", "dag");
  assert.equal(result, null);
});
```

- [ ] **Step 5: Run tests**

Run: `node --test test/delta/plan-parsing.test.ts`
Expected: all 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/delta/planner.rs src-tauri/src/lib.rs test/delta/plan-parsing.test.ts
git commit -m "feat(delta): implement plan-to-DAG parsing and approval command"
```

---

### Task 8: Orchestrator Tauri commands for questions and execution control

**Files:**
- Modify: `src-tauri/src/delta/orchestrator.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add question answering and execution control to orchestrator**

Add to `src-tauri/src/delta/orchestrator.rs`:

```rust
/// Answer a blocking question: write the answer event, inject into agent PTY, resume task.
pub fn answer_question(
    delta_id: &str,
    question_id: &str,
    answer: &str,
    task_id: &str,
    pty_session_id: Option<&str>,
    pty_state: &std::sync::Mutex<crate::pty::PtyState>,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    // Write the answer event
    let event = DeltaEvent::QuestionAnswered {
        question_id: question_id.to_string(),
        answer: answer.to_string(),
        answered_by: "user".to_string(),
        timestamp: now as u64,
    };
    write_system_event(delta_id, &event)?;

    // Inject answer into the agent's PTY
    if let Some(sid) = pty_session_id {
        let message = format!(
            "\n--- ORCHESTRATOR MESSAGE ---\n[Question Answered] {}\nAnswer: {}\n--- END MESSAGE ---\n",
            question_id, answer
        );
        let state = pty_state.lock().map_err(|e| e.to_string())?;
        if let Some(session) = state.sessions.get(sid) {
            let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
            writer
                .write_all(message.as_bytes())
                .map_err(|e| e.to_string())?;
        }
    }

    // Resume the task
    update_task_status(delta_id, task_id, TaskStatus::Running)?;
    Ok(())
}

/// Cancel a running delta: destroy all PTY sessions, mark tasks terminal.
pub fn cancel_delta(
    delta_id: &str,
    pty_state: &std::sync::Mutex<crate::pty::PtyState>,
) -> Result<(), String> {
    let states = get_task_states(delta_id)?;
    for state in &states {
        if state.status != TaskStatus::Done {
            update_task_status(delta_id, &state.id, TaskStatus::Done)?;
        }
        // Destroy PTY if active
        if let Some(ref sid) = state.pty_session_id {
            if let Ok(mut pty) = pty_state.lock() {
                if let Some(session) = pty.sessions.remove(sid) {
                    let _ = session.child.lock().map(|mut c| c.kill());
                }
            }
        }
    }
    update_delta_status(delta_id, DeltaStatus::Cancelled)?;
    Ok(())
}
```

- [ ] **Step 2: Add Tauri commands in lib.rs**

```rust
#[tauri::command]
fn delta_answer_question(
    delta_id: String,
    question_id: String,
    answer: String,
    task_id: String,
    state: State<'_, Mutex<pty::PtyState>>,
) -> Result<(), String> {
    // Find the task's PTY session
    let task_states = delta::get_task_states(&delta_id)?;
    let pty_session_id = task_states
        .iter()
        .find(|t| t.id == task_id)
        .and_then(|t| t.pty_session_id.as_deref());

    delta::orchestrator::answer_question(
        &delta_id,
        &question_id,
        &answer,
        &task_id,
        pty_session_id,
        &state,
    )
}

#[tauri::command]
fn delta_cancel(
    delta_id: String,
    state: State<'_, Mutex<pty::PtyState>>,
) -> Result<(), String> {
    delta::orchestrator::cancel_delta(&delta_id, &state)
}
```

Register both in `tauri::generate_handler![]`.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: may need to make `PtyState.sessions` and session fields `pub`. If the PTY module uses private fields, add `pub` to `PtyState`, `PtySession`, `writer`, and `child` fields. This is the minimal change — the orchestrator needs to write to agent PTYs and kill processes.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/delta/orchestrator.rs src-tauri/src/lib.rs src-tauri/src/pty/mod.rs
git commit -m "feat(delta): add question answering, cancellation, and PTY injection commands"
```

---

## Phase 3: Frontend — Delta Sidebar & Creation

### Task 9: DeltaSidebar component

**Files:**
- Create: `src/features/delta/DeltaSidebar.tsx`

- [ ] **Step 1: Build the DeltaSidebar**

```tsx
// src/features/delta/DeltaSidebar.tsx
import { useState } from "react";
import { Plus, ChevronDown, ChevronRight, Loader2, Circle, CheckCircle, XCircle, Pencil, Play } from "lucide-react";
import { useDeltaListQuery, useDeltaTasksQuery } from "../../hooks/use-delta-query";
import type { DeltaMetadata, DeltaStatus } from "./types";

interface DeltaSidebarProps {
  activeDeltaId: string | null;
  onSelectDelta: (deltaId: string) => void;
  onNewDelta: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent<HTMLDivElement>) => void;
}

function statusIcon(status: DeltaStatus) {
  switch (status) {
    case "planning": return <Pencil size={12} className="text-fg-subtle" />;
    case "ready":
    case "executing": return <Play size={12} className="text-orange-400" />;
    case "reviewing": return <Loader2 size={12} className="text-yellow animate-spin" />;
    case "completed": return <CheckCircle size={12} className="text-green" />;
    case "cancelled": return <XCircle size={12} className="text-red" />;
    default: return <Circle size={12} className="text-fg-subtle" />;
  }
}

function statusLabel(status: DeltaStatus): string {
  switch (status) {
    case "planning": return "Planning";
    case "ready": return "Ready";
    case "executing": return "Running";
    case "reviewing": return "Reviewing";
    case "completed": return "Done";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function DeltaProgress({ deltaId }: { deltaId: string }) {
  const { data: tasks } = useDeltaTasksQuery(deltaId);
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter(t => t.status === "done").length;
  return (
    <span className="text-[10px] text-fg-subtle">
      {done}/{tasks.length}
    </span>
  );
}

export function DeltaSidebar({
  activeDeltaId,
  onSelectDelta,
  onNewDelta,
  width,
  onResizeStart,
}: DeltaSidebarProps) {
  const { data: deltas, isLoading } = useDeltaListQuery();
  const [historyOpen, setHistoryOpen] = useState(false);

  const activeDeltas = (deltas ?? []).filter(
    d => d.status !== "completed" && d.status !== "cancelled"
  );
  const completedDeltas = (deltas ?? []).filter(
    d => d.status === "completed" || d.status === "cancelled"
  );

  return (
    <div
      className="flex h-full shrink-0 flex-col border-r border-border bg-bg-raised"
      style={{ width }}
    >
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-xs font-semibold text-fg-muted">Deltas</span>
        <button
          onClick={onNewDelta}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
          title="New Delta"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Delta list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-fg-subtle" />
          </div>
        )}

        {activeDeltas.map((delta) => (
          <button
            key={delta.id}
            onClick={() => onSelectDelta(delta.id)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
              activeDeltaId === delta.id
                ? "bg-accent-bg text-accent-fg"
                : "text-fg-muted hover:bg-bg-hover hover:text-fg"
            }`}
          >
            {statusIcon(delta.status)}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px]">{delta.name}</span>
              <span className="text-[10px] text-fg-subtle">
                {statusLabel(delta.status)}
              </span>
            </div>
            <DeltaProgress deltaId={delta.id} />
          </button>
        ))}

        {activeDeltas.length === 0 && !isLoading && (
          <div className="px-3 py-6 text-center text-xs text-fg-subtle">
            No active Deltas.
            <br />
            <button
              onClick={onNewDelta}
              className="mt-1 text-accent-fg hover:underline"
            >
              Create one
            </button>
          </div>
        )}

        {/* History section */}
        {completedDeltas.length > 0 && (
          <div className="mt-2 border-t border-border-subtle pt-1">
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle"
            >
              {historyOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              History
            </button>
            {historyOpen &&
              completedDeltas.map((delta) => (
                <button
                  key={delta.id}
                  onClick={() => onSelectDelta(delta.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    activeDeltaId === delta.id
                      ? "bg-accent-bg text-accent-fg"
                      : "text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
                  }`}
                >
                  {statusIcon(delta.status)}
                  <span className="truncate text-[12px]">{delta.name}</span>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="h-full w-1 cursor-col-resize absolute right-0 top-0 hover:bg-accent/30 transition-colors"
        onMouseDown={onResizeStart}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/delta/DeltaSidebar.tsx
git commit -m "feat(delta): add DeltaSidebar component with status indicators and history"
```

---

### Task 10: DeltaCreationModal component

**Files:**
- Create: `src/features/delta/DeltaCreationModal.tsx`

- [ ] **Step 1: Build the creation modal**

```tsx
// src/features/delta/DeltaCreationModal.tsx
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Close on click outside
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
      });
      // Reset form
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
                        ? "bg-accent-bg text-accent-fg"
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/delta/DeltaCreationModal.tsx
git commit -m "feat(delta): add DeltaCreationModal with repo selection"
```

---

## Phase 4: Frontend — Split View & Event Feed

### Task 11: DeltaSplitView, EventFeed, and PlanPane

**Files:**
- Create: `src/features/delta/DeltaSplitView.tsx`
- Create: `src/features/delta/EventFeed.tsx`
- Create: `src/features/delta/PlanPane.tsx`
- Create: `src/features/delta/QuestionCard.tsx`
- Create: `src/features/delta/GateResult.tsx`

- [ ] **Step 1: Create DeltaSplitView container**

```tsx
// src/features/delta/DeltaSplitView.tsx
import { useState } from "react";
import { EventFeed } from "./EventFeed";
import { PlanPane } from "./PlanPane";
import type { DeltaMetadata, DeltaEvent, TaskState, TaskDAG } from "./types";

interface DeltaSplitViewProps {
  delta: DeltaMetadata;
  events: DeltaEvent[];
  tasks: TaskState[];
  dag: TaskDAG | null;
  plan: string;
  onAnswerQuestion: (questionId: string, answer: string, taskId: string) => void;
  onApprovePlan: () => void;
  onUpdatePlan: (content: string) => void;
  onSendMessage: (message: string) => void;
}

export function DeltaSplitView({
  delta,
  events,
  tasks,
  dag,
  plan,
  onAnswerQuestion,
  onApprovePlan,
  onUpdatePlan,
  onSendMessage,
}: DeltaSplitViewProps) {
  const isPlanning = delta.status === "planning";

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left pane: Event Feed / Conversation */}
      <div className="flex w-1/2 flex-col border-r border-border-subtle">
        <EventFeed
          events={events}
          tasks={tasks}
          isPlanning={isPlanning}
          onAnswerQuestion={onAnswerQuestion}
          onSendMessage={onSendMessage}
        />
      </div>

      {/* Right pane: Plan Document */}
      <div className="flex w-1/2 flex-col">
        <PlanPane
          plan={plan}
          dag={dag}
          tasks={tasks}
          isPlanning={isPlanning}
          deltaStatus={delta.status}
          onUpdatePlan={onUpdatePlan}
          onApprovePlan={onApprovePlan}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create EventFeed component**

```tsx
// src/features/delta/EventFeed.tsx
import { useState, useRef, useEffect } from "react";
import { QuestionCard } from "./QuestionCard";
import type { DeltaEvent, TaskState } from "./types";

interface EventFeedProps {
  events: DeltaEvent[];
  tasks: TaskState[];
  isPlanning: boolean;
  onAnswerQuestion: (questionId: string, answer: string, taskId: string) => void;
  onSendMessage: (message: string) => void;
}

type FilterType = "all" | "questions" | "decisions" | "progress";

export function EventFeed({
  events,
  tasks,
  isPlanning,
  onAnswerQuestion,
  onSendMessage,
}: EventFeedProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [message, setMessage] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events.length]);

  const filteredEvents = events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "questions") return e.type === "question" || e.type === "question_answered";
    if (filter === "decisions") return e.type === "plan_update";
    if (filter === "progress") return e.type === "progress" || e.type === "task_state" || e.type === "task_complete";
    return true;
  });

  // Find unanswered blocking questions
  const answeredIds = new Set(
    events
      .filter((e): e is Extract<DeltaEvent, { type: "question_answered" }> => e.type === "question_answered")
      .map((e) => e.question_id)
  );

  const handleSend = () => {
    if (!message.trim()) return;
    onSendMessage(message.trim());
    setMessage("");
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="flex gap-1 border-b border-border-subtle px-3 py-1.5">
        {(["all", "questions", "decisions", "progress"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
              filter === f
                ? "bg-accent-bg text-accent-fg"
                : "text-fg-subtle hover:text-fg-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Events */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {filteredEvents.length === 0 && (
          <p className="py-8 text-center text-xs text-fg-subtle">
            {isPlanning ? "Start planning by describing your feature below." : "Waiting for agent activity..."}
          </p>
        )}

        {filteredEvents.map((event, idx) => (
          <EventItem
            key={idx}
            event={event}
            isAnswered={event.type === "question" && answeredIds.has(event.id)}
            onAnswerQuestion={onAnswerQuestion}
          />
        ))}
      </div>

      {/* Message input */}
      <div className="border-t border-border-subtle px-3 py-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={isPlanning ? "Describe your feature..." : "Send a message to agents..."}
            className="flex-1 rounded border border-border bg-bg px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim()}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function EventItem({
  event,
  isAnswered,
  onAnswerQuestion,
}: {
  event: DeltaEvent;
  isAnswered: boolean;
  onAnswerQuestion: (questionId: string, answer: string, taskId: string) => void;
}) {
  switch (event.type) {
    case "progress":
      return (
        <div className="flex gap-2 text-xs">
          <span className="shrink-0 text-fg-subtle">{event.agent}</span>
          <span className="text-fg-muted">{event.message}</span>
        </div>
      );
    case "question":
      return (
        <QuestionCard
          event={event}
          isAnswered={isAnswered}
          onAnswer={(answer) => onAnswerQuestion(event.id, answer, event.task_id)}
        />
      );
    case "task_complete":
      return (
        <div className="flex items-center gap-2 rounded bg-green-bg px-2 py-1.5 text-xs">
          <span className="text-green">✓</span>
          <span className="font-medium text-green">Task complete:</span>
          <span className="text-fg-muted">{event.summary}</span>
        </div>
      );
    case "task_state":
      return (
        <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <span>→</span>
          <span>{event.task_id}: {event.from} → {event.to}</span>
          {event.reason && <span className="text-fg-faint">({event.reason})</span>}
        </div>
      );
    case "gate_result":
      return (
        <div className={`flex items-center gap-2 text-xs ${event.passed ? "text-green" : "text-red"}`}>
          <span>{event.passed ? "✓" : "✗"}</span>
          <span>Gate {event.gate_index}: {event.gate_type}</span>
        </div>
      );
    case "plan_update":
      return (
        <div className="flex gap-2 text-xs">
          <span className="shrink-0 text-accent-fg">decision</span>
          <span className="text-fg-muted">{event.content}</span>
        </div>
      );
    case "review_finding":
      return (
        <div className={`rounded border px-2 py-1.5 text-xs ${
          event.severity === "error"
            ? "border-red/30 bg-red-bg text-red"
            : "border-yellow/30 bg-yellow-bg text-yellow"
        }`}>
          <div className="font-medium">{event.severity}: {event.file}{event.line ? `:${event.line}` : ""}</div>
          <div className="text-fg-muted">{event.message}</div>
        </div>
      );
    case "question_answered":
      return (
        <div className="flex gap-2 text-xs text-fg-subtle">
          <span>↳</span>
          <span>Answered: {event.answer} (by {event.answered_by})</span>
        </div>
      );
    default:
      return null;
  }
}
```

- [ ] **Step 3: Create QuestionCard component**

```tsx
// src/features/delta/QuestionCard.tsx
import { useState } from "react";
import type { DeltaEvent } from "./types";

type QuestionEvent = Extract<DeltaEvent, { type: "question" }>;

interface QuestionCardProps {
  event: QuestionEvent;
  isAnswered: boolean;
  onAnswer: (answer: string) => void;
}

export function QuestionCard({ event, isAnswered, onAnswer }: QuestionCardProps) {
  const [customAnswer, setCustomAnswer] = useState("");

  if (isAnswered) {
    return (
      <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-xs opacity-60">
        <div className="font-medium text-fg-muted">{event.agent} asked:</div>
        <div className="text-fg-subtle">{event.question}</div>
        <div className="mt-1 text-[10px] text-fg-faint">Answered</div>
      </div>
    );
  }

  return (
    <div className={`rounded border px-3 py-2 text-xs ${
      event.blocking
        ? "border-orange-400/40 bg-yellow-bg"
        : "border-border-subtle bg-bg-overlay"
    }`}>
      <div className="flex items-center gap-1.5">
        {event.blocking && (
          <span className="rounded bg-orange-400/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-orange-400">
            Blocking
          </span>
        )}
        <span className="font-medium text-fg-muted">{event.agent}:</span>
      </div>
      <div className="mt-1 text-fg">{event.question}</div>

      {/* Options */}
      {event.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {event.options.map((opt) => (
            <button
              key={opt}
              onClick={() => onAnswer(opt)}
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-fg"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Custom answer */}
      <div className="mt-2 flex gap-1.5">
        <input
          type="text"
          value={customAnswer}
          onChange={(e) => setCustomAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customAnswer.trim()) {
              onAnswer(customAnswer.trim());
              setCustomAnswer("");
            }
          }}
          placeholder="Type an answer..."
          className="flex-1 rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => {
            if (customAnswer.trim()) {
              onAnswer(customAnswer.trim());
              setCustomAnswer("");
            }
          }}
          disabled={!customAnswer.trim()}
          className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Answer
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create GateResult component**

```tsx
// src/features/delta/GateResult.tsx
import type { GateResultEntry } from "./types";

interface GateResultProps {
  result: GateResultEntry;
}

export function GateResult({ result }: GateResultProps) {
  return (
    <div className={`flex items-start gap-1.5 text-[11px] ${result.passed ? "text-green" : "text-red"}`}>
      <span className="mt-0.5 shrink-0">{result.passed ? "✓" : "✗"}</span>
      <div>
        <span className="font-medium">{result.gate_type}</span>
        {result.output && (
          <pre className="mt-0.5 max-h-[60px] overflow-auto whitespace-pre-wrap text-[10px] text-fg-subtle">
            {result.output}
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create PlanPane component**

```tsx
// src/features/delta/PlanPane.tsx
import { GateResult } from "./GateResult";
import type { TaskDAG, TaskState, DeltaStatus } from "./types";

interface PlanPaneProps {
  plan: string;
  dag: TaskDAG | null;
  tasks: TaskState[];
  isPlanning: boolean;
  deltaStatus: DeltaStatus;
  onUpdatePlan: (content: string) => void;
  onApprovePlan: () => void;
}

function taskStatusBadge(status: string) {
  switch (status) {
    case "blocked": return <span className="rounded bg-fg-faint/20 px-1 py-0.5 text-[9px] text-fg-subtle">blocked</span>;
    case "ready": return <span className="rounded bg-blue-bg px-1 py-0.5 text-[9px] text-blue">ready</span>;
    case "running": return <span className="rounded bg-accent-bg px-1 py-0.5 text-[9px] text-accent-fg" style={{ animation: "pulse 1.5s ease-in-out infinite" }}>running</span>;
    case "blocked_on_question": return <span className="rounded bg-yellow-bg px-1 py-0.5 text-[9px] text-yellow">waiting</span>;
    case "verifying": return <span className="rounded bg-yellow-bg px-1 py-0.5 text-[9px] text-yellow">verifying</span>;
    case "done": return <span className="rounded bg-green-bg px-1 py-0.5 text-[9px] text-green">done</span>;
    default: return null;
  }
}

export function PlanPane({
  plan,
  dag,
  tasks,
  isPlanning,
  deltaStatus,
  onUpdatePlan,
  onApprovePlan,
}: PlanPaneProps) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
        <span className="text-xs font-semibold text-fg-muted">Plan</span>
        {isPlanning && (
          <button
            onClick={onApprovePlan}
            disabled={!plan.trim()}
            className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Approve Plan & Launch
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Plan text */}
        {isPlanning ? (
          <textarea
            value={plan}
            onChange={(e) => onUpdatePlan(e.target.value)}
            placeholder="The plan will appear here as you discuss with the planning agent..."
            className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs text-fg placeholder:text-fg-faint focus:outline-none"
          />
        ) : (
          <div className="p-3">
            <pre className="whitespace-pre-wrap font-mono text-xs text-fg-muted">{plan}</pre>
          </div>
        )}

        {/* Task status section (during execution) */}
        {dag && !isPlanning && (
          <div className="border-t border-border-subtle px-3 py-2">
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Tasks
            </h4>
            <div className="space-y-2">
              {dag.tasks.map((taskDef) => {
                const state = taskMap.get(taskDef.id);
                return (
                  <div key={taskDef.id} className="rounded border border-border-subtle p-2">
                    <div className="flex items-center gap-2">
                      {state && taskStatusBadge(state.status)}
                      <span className="text-xs font-medium text-fg">{taskDef.title}</span>
                      <span className="ml-auto text-[10px] text-fg-subtle">{taskDef.agent}</span>
                    </div>
                    {/* Gate results */}
                    {state && state.gate_results.length > 0 && (
                      <div className="mt-1.5 space-y-0.5 pl-2">
                        {state.gate_results.map((gr, i) => (
                          <GateResult key={i} result={gr} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/features/delta/DeltaSplitView.tsx src/features/delta/EventFeed.tsx src/features/delta/PlanPane.tsx src/features/delta/QuestionCard.tsx src/features/delta/GateResult.tsx
git commit -m "feat(delta): add split view with event feed, plan pane, and question/gate components"
```

---

## Phase 5: Wire Into App.tsx

### Task 12: Integrate Delta system into App.tsx

**Files:**
- Modify: `src/App.tsx`

This is the integration task. The sidebar gets a toggle between "Deltas" and "Repos" views. When a Delta is selected, the Chat inner tab renders the DeltaSplitView instead of the terminal.

- [ ] **Step 1: Add Delta state and sidebar toggle to App.tsx**

Add imports at top:
```typescript
import { DeltaSidebar } from "./features/delta/DeltaSidebar";
import { DeltaCreationModal } from "./features/delta/DeltaCreationModal";
import { DeltaSplitView } from "./features/delta/DeltaSplitView";
import { useDeltaQuery, useDeltaPlanQuery, useDeltaDAGQuery, useDeltaTasksQuery, useDeltaEventsQuery, useUpdateDeltaPlanMutation } from "./hooks/use-delta-query";
```

Add state:
```typescript
const [sidebarMode, setSidebarMode] = useState<"deltas" | "repos">("deltas");
const [activeDeltaId, setActiveDeltaId] = useState<string | null>(null);
const [showCreateDelta, setShowCreateDelta] = useState(false);
```

Add delta queries (conditionally fetched):
```typescript
const { data: activeDelta } = useDeltaQuery(activeDeltaId);
const { data: deltaPlan } = useDeltaPlanQuery(activeDeltaId);
const { data: deltaDag } = useDeltaDAGQuery(activeDeltaId);
const { data: deltaTasks } = useDeltaTasksQuery(activeDeltaId);
const { data: deltaEvents } = useDeltaEventsQuery(activeDeltaId);
const updatePlanMutation = useUpdateDeltaPlanMutation();
```

- [ ] **Step 2: Add sidebar toggle UI**

Replace the Sidebar render with a conditional:
```tsx
{sidebarMode === "deltas" ? (
  <DeltaSidebar
    activeDeltaId={activeDeltaId}
    onSelectDelta={setActiveDeltaId}
    onNewDelta={() => setShowCreateDelta(true)}
    width={sidebarWidth}
    onResizeStart={handleSidebarResizeStart}
  />
) : (
  <Sidebar
    activeTab={activeTab}
    width={sidebarWidth}
    busyTabIds={busyTabIds}
    tabs={tabs}
    onBranchSelect={handleBranchSelect}
    onBranchDeleted={handleBranchDeleted}
    onWorktreeDeleted={handleWorktreeDeleted}
    onWorktreeSelect={handleWorktreeSelect}
    onResizeStart={handleSidebarResizeStart}
  />
)}
```

Add a small toggle at the top of the sidebar area (in the TitleBar or just below it):
```tsx
<div className="flex border-b border-border-subtle">
  <button
    onClick={() => setSidebarMode("deltas")}
    className={`flex-1 py-1.5 text-[10px] font-medium ${sidebarMode === "deltas" ? "text-fg border-b-2 border-accent" : "text-fg-subtle"}`}
  >
    Deltas
  </button>
  <button
    onClick={() => setSidebarMode("repos")}
    className={`flex-1 py-1.5 text-[10px] font-medium ${sidebarMode === "repos" ? "text-fg border-b-2 border-accent" : "text-fg-subtle"}`}
  >
    Repos
  </button>
</div>
```

- [ ] **Step 3: Render DeltaSplitView in Chat tab when a Delta is active**

In the main content area, when `innerTab === "chat"` and `activeDeltaId` is set and `sidebarMode === "deltas"`:

```tsx
{innerTab === "chat" && activeDelta && sidebarMode === "deltas" ? (
  <DeltaSplitView
    delta={activeDelta}
    events={deltaEvents ?? []}
    tasks={deltaTasks ?? []}
    dag={deltaDag ?? null}
    plan={deltaPlan ?? ""}
    onAnswerQuestion={(qId, answer, taskId) => {
      invoke("delta_answer_question", { deltaId: activeDeltaId, questionId: qId, answer, taskId });
    }}
    onApprovePlan={() => {
      invoke("delta_approve_plan", { deltaId: activeDeltaId });
    }}
    onUpdatePlan={(content) => {
      if (activeDeltaId) {
        updatePlanMutation.mutate({ deltaId: activeDeltaId, content });
      }
    }}
    onSendMessage={(msg) => {
      // For planning: write to PTY. For execution: broadcast to agents.
      console.log("[delta] send message:", msg);
    }}
  />
) : (
  /* existing terminal rendering */
)}
```

- [ ] **Step 4: Add DeltaCreationModal**

At the bottom of the JSX (before the closing `</>`):
```tsx
<DeltaCreationModal
  open={showCreateDelta}
  onClose={() => setShowCreateDelta(false)}
  onCreated={(id) => {
    setActiveDeltaId(id);
    setSidebarMode("deltas");
    setInnerTab("chat");
  }}
/>
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(delta): integrate Delta sidebar, creation modal, and split view into App"
```

---

## Phase 6: Delta Event Listener & Live Updates

### Task 13: Listen for delta-event Tauri events and refresh queries

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add delta-event listener to auto-refresh queries**

Add a `useEffect` in App.tsx that listens for `delta-event` and `delta-state-change` Tauri events and invalidates the relevant React Query caches:

```typescript
// Listen for delta events and refresh queries
useEffect(() => {
  if (!activeDeltaId) return;

  const unlistenEvent = listen<{ delta_id: string }>("delta-event", (event) => {
    if (event.payload.delta_id === activeDeltaId) {
      queryClient.invalidateQueries({ queryKey: ["delta-events", activeDeltaId] });
      queryClient.invalidateQueries({ queryKey: ["delta-tasks", activeDeltaId] });
      queryClient.invalidateQueries({ queryKey: ["delta-plan", activeDeltaId] });
    }
  });

  return () => {
    unlistenEvent.then((fn) => fn());
  };
}, [activeDeltaId, queryClient]);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(delta): add live event listener for delta query invalidation"
```

---

### Task 14: ReviewSummary component

**Files:**
- Create: `src/features/delta/ReviewSummary.tsx`

- [ ] **Step 1: Build ReviewSummary**

```tsx
// src/features/delta/ReviewSummary.tsx
import type { DeltaEvent } from "./types";

type ReviewFinding = Extract<DeltaEvent, { type: "review_finding" }>;

interface ReviewSummaryProps {
  findings: ReviewFinding[];
  onDismiss: (index: number) => void;
  onRequestFixes: (taskId: string) => void;
  onApproveMerge: () => void;
}

export function ReviewSummary({
  findings,
  onDismiss,
  onRequestFixes,
  onApproveMerge,
}: ReviewSummaryProps) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity !== "error" && f.severity !== "warning");

  return (
    <div className="space-y-3 p-3">
      <h3 className="text-xs font-semibold text-fg">Review Summary</h3>

      <div className="flex gap-3 text-xs">
        {errors.length > 0 && (
          <span className="text-red">{errors.length} error{errors.length > 1 ? "s" : ""}</span>
        )}
        {warnings.length > 0 && (
          <span className="text-yellow">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</span>
        )}
        {infos.length > 0 && (
          <span className="text-fg-subtle">{infos.length} info</span>
        )}
        {findings.length === 0 && (
          <span className="text-green">No issues found</span>
        )}
      </div>

      {findings.map((finding, idx) => (
        <div
          key={idx}
          className={`rounded border px-3 py-2 text-xs ${
            finding.severity === "error"
              ? "border-red/30 bg-red-bg"
              : finding.severity === "warning"
              ? "border-yellow/30 bg-yellow-bg"
              : "border-border-subtle bg-bg-overlay"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-fg">
              {finding.file}{finding.line ? `:${finding.line}` : ""}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => onDismiss(idx)}
                className="rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-bg-hover"
              >
                Dismiss
              </button>
              <button
                onClick={() => onRequestFixes(finding.task_id)}
                className="rounded px-1.5 py-0.5 text-[10px] text-accent-fg hover:bg-accent-bg"
              >
                Fix
              </button>
            </div>
          </div>
          <p className="mt-1 text-fg-muted">{finding.message}</p>
          {finding.suggestion && (
            <p className="mt-0.5 text-fg-subtle">Suggestion: {finding.suggestion}</p>
          )}
        </div>
      ))}

      {/* Action buttons */}
      <div className="flex justify-end gap-2 pt-2">
        {errors.length > 0 && (
          <button
            onClick={() => {
              const taskIds = new Set(errors.map((f) => f.task_id));
              taskIds.forEach((id) => onRequestFixes(id));
            }}
            className="rounded border border-red/30 px-3 py-1.5 text-xs text-red hover:bg-red-bg"
          >
            Request Fixes ({errors.length})
          </button>
        )}
        <button
          onClick={onApproveMerge}
          disabled={errors.length > 0}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Approve & Merge
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/delta/ReviewSummary.tsx
git commit -m "feat(delta): add ReviewSummary component for review phase"
```

---

### Task 15: TaskDAG visualization component

**Files:**
- Create: `src/features/delta/TaskDAG.tsx`

- [ ] **Step 1: Build a simple DAG visualization using CSS**

```tsx
// src/features/delta/TaskDAG.tsx
import type { TaskDAG as TaskDAGType, TaskState } from "./types";

interface TaskDAGProps {
  dag: TaskDAGType;
  tasks: TaskState[];
}

function statusColor(status: string): string {
  switch (status) {
    case "blocked": return "bg-fg-faint";
    case "ready": return "bg-blue";
    case "running": return "bg-accent";
    case "blocked_on_question": return "bg-yellow";
    case "verifying": return "bg-yellow";
    case "done": return "bg-green";
    default: return "bg-fg-subtle";
  }
}

export function TaskDAG({ dag, tasks }: TaskDAGProps) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Group tasks into layers by dependency depth
  const layers = computeLayers(dag);

  return (
    <div className="flex flex-col items-center gap-3 py-3">
      {layers.map((layer, layerIdx) => (
        <div key={layerIdx} className="flex items-center gap-4">
          {layer.map((taskId) => {
            const def = dag.tasks.find((t) => t.id === taskId);
            const state = taskMap.get(taskId);
            if (!def) return null;
            return (
              <div
                key={taskId}
                className="flex flex-col items-center gap-1 rounded border border-border-subtle px-3 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${statusColor(state?.status ?? "blocked")}`} />
                  <span className="text-[11px] font-medium text-fg">{def.title}</span>
                </div>
                <span className="text-[9px] text-fg-subtle">{def.agent}</span>
              </div>
            );
          })}
        </div>
      ))}
      {layers.length > 1 && (
        <div className="text-[9px] text-fg-faint">↓ dependency order ↓</div>
      )}
    </div>
  );
}

function computeLayers(dag: TaskDAGType): string[][] {
  const taskDepth = new Map<string, number>();
  const taskMap = new Map(dag.tasks.map((t) => [t.id, t]));

  function getDepth(id: string): number {
    if (taskDepth.has(id)) return taskDepth.get(id)!;
    const task = taskMap.get(id);
    if (!task || task.depends_on.length === 0) {
      taskDepth.set(id, 0);
      return 0;
    }
    const depth = 1 + Math.max(...task.depends_on.map(getDepth));
    taskDepth.set(id, depth);
    return depth;
  }

  for (const task of dag.tasks) getDepth(task.id);

  const maxDepth = Math.max(0, ...taskDepth.values());
  const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const [id, depth] of taskDepth) {
    layers[depth].push(id);
  }
  return layers;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/delta/TaskDAG.tsx
git commit -m "feat(delta): add TaskDAG visualization component"
```

---

## Phase 7: Final Integration

### Task 16: End-to-end wiring and cleanup

**Files:**
- Modify: `src-tauri/src/lib.rs` (ensure all commands registered)
- Modify: `src/App.tsx` (final polish)

- [ ] **Step 1: Verify all Tauri commands are registered**

Check that `tauri::generate_handler![]` in `lib.rs` includes:
```
delta_create, delta_list, delta_get, delta_get_plan, delta_update_plan,
delta_get_dag, delta_get_tasks, delta_get_events, delta_delete,
delta_approve_plan, delta_answer_question, delta_cancel
```

- [ ] **Step 2: Full compile check**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit`
Expected: both compile cleanly

- [ ] **Step 3: Run all tests**

Run: `node --test test/delta/*.test.ts`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(delta): complete Delta workflow integration"
```

---

## Summary

| Phase | Tasks | What it produces |
|-------|-------|------------------|
| 1: Backend Foundation | 1-4 | Delta types, CRUD, PTY env vars, file watcher |
| 2: Orchestrator | 5-8 | DAG evaluation, gates, plan parsing, question handling |
| 3: Frontend Sidebar | 9-10 | DeltaSidebar, DeltaCreationModal |
| 4: Split View | 11 | DeltaSplitView, EventFeed, PlanPane, QuestionCard, GateResult |
| 5: App Integration | 12 | Sidebar toggle, Delta rendering in App.tsx |
| 6: Live Updates | 13-15 | Event listener, ReviewSummary, TaskDAG |
| 7: Final Integration | 16 | End-to-end wiring, compile verification |
