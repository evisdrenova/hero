# Delta Workflow System — Design Spec

## Overview

A **Delta** is the primary unit of work in Entire. It represents a feature, bugfix, or initiative executed by one or more AI agents working in parallel across isolated git worktrees, coordinated through a shared file-based workspace with a strict task DAG and verification gates.

Deltas replace the repo/branch sidebar as the top-level navigation concept. Repos and branches become implementation details managed by the system.

---

## 1. Core Data Model

### 1.1 Delta workspace on disk

The Delta workspace lives at a global path (`~/.entire/deltas/{delta-id}/`) rather than inside any single repo, since Deltas can span multiple repos.

```
~/.entire/deltas/{delta-id}/
├── delta.json                                # metadata
├── plan.md                                   # living plan document
├── dag.json                                  # task graph with gates
├── tasks/
│   └── {task-id}.json                        # per-task state
├── events/
│   └── {timestamp}-{task-id}-{type}.json     # append-only event log
└── summary.md                                # generated on completion
```

### 1.2 delta.json

```json
{
  "id": "delta-1711234567",
  "name": "OAuth2 Authentication",
  "status": "planning",
  "repos": [
    { "path": "/Users/dev/api", "role": "backend" },
    { "path": "/Users/dev/web", "role": "frontend" }
  ],
  "created_at": 1711234567,
  "updated_at": 1711234567
}
```

**Delta statuses:** `planning` → `ready` → `executing` → `reviewing` → `completed` | `cancelled`

### 1.3 dag.json

```json
{
  "tasks": [
    {
      "id": "task-1",
      "title": "OAuth2 provider setup",
      "description": "Configure OAuth2 providers (Google, GitHub) with PKCE flow",
      "repo": "/Users/dev/api",
      "depends_on": [],
      "agent": "claude-code",
      "gates": [
        { "type": "command", "run": "cargo test --lib oauth", "expect": "exit_0" },
        { "type": "command", "run": "cargo clippy -- -D warnings", "expect": "exit_0" },
        { "type": "file_exists", "path": "src/oauth/mod.rs" }
      ]
    },
    {
      "id": "task-2",
      "title": "Auth middleware",
      "description": "JWT validation middleware with token refresh",
      "repo": "/Users/dev/api",
      "depends_on": ["task-1"],
      "agent": "claude-code",
      "gates": [
        { "type": "command", "run": "cargo test --lib auth", "expect": "exit_0" },
        { "type": "agent_review", "prompt": "Verify token refresh handles concurrent requests safely" }
      ]
    },
    {
      "id": "task-3",
      "title": "Frontend login flow",
      "description": "Login/logout UI with OAuth2 redirect handling",
      "repo": "/Users/dev/web",
      "depends_on": ["task-2"],
      "agent": "codex",
      "gates": [
        { "type": "command", "run": "npm test -- --filter auth", "expect": "exit_0" }
      ]
    }
  ]
}
```

### 1.4 Task states

```
blocked ──→ ready ──→ running ──→ verifying ──→ done
                        ↑    ↓        │
                        │    ↓        │ (gates fail)
                        │  blocked_on_question
                        │              │
                        └──────────────┘
                        (question answered / gates fail → retry)
```

- `blocked` — waiting on dependency tasks to complete
- `ready` — all dependencies met, waiting for orchestrator to spawn agent
- `running` — agent PTY is active and working
- `blocked_on_question` — agent posted a blocking question, PTY paused
- `verifying` — agent signaled completion, gates running sequentially
- `done` — all gates passed, task complete

When gates fail, the task returns to `running` with failure context injected into the agent's PTY via `pty_write`.

### 1.5 tasks/{task-id}.json

```json
{
  "id": "task-1",
  "status": "running",
  "agent": "claude-code",
  "pty_session_id": "pty-1711234567-123",
  "worktree_path": "/Users/dev/api-delta-task-1",
  "worktree_branch": "delta/oauth2-auth/task-1",
  "base_branch": "main",
  "started_at": 1711234600,
  "completed_at": null,
  "gate_results": [],
  "summary": null,
  "retry_count": 0
}
```

### 1.6 Gate types

| Type | Description | Pass condition |
|------|-------------|----------------|
| `command` | Run a shell command in the task's worktree | Exit code matches `expect` (`exit_0` or regex on stdout) |
| `file_exists` | Check a file was created | File exists at path relative to worktree |
| `agent_review` | Spin up a short-lived review agent | Agent returns no `error`-severity findings |

Note: there is no `test_pass` shorthand. Use `command` with the project's test command for clarity.

### 1.7 Timeouts

- **Task timeout**: configurable per task in `dag.json` (`timeout_secs`, default 1800 = 30 min). If exceeded, task transitions to `running` with a timeout warning injected. After 3 timeouts, the task is marked `done` with an error summary and the user is notified.
- **Gate timeout**: 120 seconds per gate. If exceeded, the gate fails.
- **Question timeout**: blocking questions have no timeout (they wait for the user). Non-blocking questions are informational only.

---

## 2. Event System

### 2.1 Event types

All events are JSON files written to `~/.entire/deltas/{id}/events/`. Filename format: `{unix_millis}-{task_id}-{type}.json` to avoid collisions between agents posting simultaneously.

**Agent-authored events** (written by agents to the events directory):

```json
// Progress update
{
  "type": "progress",
  "task_id": "task-1",
  "agent": "claude-code",
  "message": "OAuth provider config done, implementing PKCE flow",
  "timestamp": 1711234600
}

// Question (blocking or non-blocking)
{
  "type": "question",
  "id": "q-1711234601",
  "task_id": "task-1",
  "agent": "claude-code",
  "blocking": true,
  "question": "Should token refresh use sliding window or fixed expiry?",
  "options": ["sliding", "fixed"],
  "timestamp": 1711234601
}

// Task complete signal
{
  "type": "task_complete",
  "task_id": "task-1",
  "agent": "claude-code",
  "summary": "OAuth2 providers configured with PKCE for Google and GitHub",
  "timestamp": 1711234700
}

// Plan update suggestion
{
  "type": "plan_update",
  "task_id": "task-1",
  "agent": "claude-code",
  "section": "decisions",
  "content": "Using PKCE flow for all OAuth providers — more secure for public clients",
  "timestamp": 1711234650
}
```

**System events** (written by the orchestrator):

```json
// Task state transition
{
  "type": "task_state",
  "task_id": "task-2",
  "from": "blocked",
  "to": "ready",
  "reason": "Dependency task-1 completed",
  "timestamp": 1711234701
}

// Gate result
{
  "type": "gate_result",
  "task_id": "task-1",
  "gate_index": 0,
  "gate_type": "command",
  "passed": true,
  "output": "test result: ok. 12 passed; 0 failed",
  "timestamp": 1711234710
}

// Question answered
{
  "type": "question_answered",
  "question_id": "q-1711234601",
  "answer": "sliding",
  "answered_by": "user",
  "timestamp": 1711234650
}
```

**Review events:**

```json
{
  "type": "review_finding",
  "task_id": "task-2",
  "agent": "claude-code",
  "severity": "warning",
  "file": "src/middleware/auth.rs",
  "line": 45,
  "message": "Token refresh doesn't handle concurrent requests",
  "suggestion": "Add a mutex around the refresh logic",
  "timestamp": 1711235000
}
```

### 2.2 Event routing

The Rust file watcher monitors `~/.entire/deltas/{id}/events/` using `RecursiveMode::Recursive` (a separate watcher instance from the existing per-repo watcher) and:

1. Parses each new event file
2. Emits a typed Tauri event (`delta-event`) to the frontend
3. Routes to the orchestrator for state transitions:
   - `task_complete` → trigger gate verification
   - `question` (blocking) → set task to `blocked_on_question`, notify frontend
   - `question` (non-blocking) → emit to frontend only, agent continues
   - `plan_update` → orchestrator appends to `plan.md`

### 2.3 Agent communication protocol

Agents interact with the Delta exclusively via file I/O. On spawn, each agent receives:

- `DELTA_WORKSPACE` env var → `~/.entire/deltas/{id}/`
- `DELTA_TASK_ID` env var → the task ID assigned to this agent
- Initial prompt with the plan, task description, predecessor summaries, gates, and the file-based communication protocol

**Prerequisite**: `pty_create` must be extended with an `env_vars: Option<HashMap<String, String>>` parameter to inject these environment variables into the spawned process. The existing `CommandBuilder` API supports `.env()` calls — this is a straightforward addition.

To post an event, an agent writes a JSON file to `{DELTA_WORKSPACE}/events/`.

To read shared context, an agent reads `{DELTA_WORKSPACE}/plan.md` or other agents' event files.

### 2.4 Execution agent prompt template

When an agent's task becomes `ready`, the orchestrator spawns a PTY with this initial prompt:

```
You are an execution agent working on a specific task within a larger plan.

## Your Task
Title: {task.title}
Description: {task.description}
Working directory: {worktree_path}

## Full Plan
{plan.md contents}

## Dependencies Completed
{for each predecessor task: title + summary from tasks/{id}.json}

## Verification Gates
When you believe your work is complete, these gates will run automatically:
{for each gate: formatted description}

## Communication Protocol
You can communicate with the orchestrator and other agents by writing JSON files
to the shared workspace at: {DELTA_WORKSPACE}/events/

To report progress:
  echo '{"type":"progress","task_id":"{task_id}","agent":"{agent}","message":"...","timestamp":'$(date +%s%3N)'}' > {DELTA_WORKSPACE}/events/$(date +%s%3N)-{task_id}-progress.json

To ask a question (blocking — you will receive an answer before continuing):
  echo '{"type":"question","id":"q-'$(date +%s%3N)'","task_id":"{task_id}","agent":"{agent}","blocking":true,"question":"...","timestamp":'$(date +%s%3N)'}' > {DELTA_WORKSPACE}/events/$(date +%s%3N)-{task_id}-question.json

To ask a non-blocking question (FYI, no need to wait):
  Same as above but with "blocking":false

To signal completion:
  echo '{"type":"task_complete","task_id":"{task_id}","agent":"{agent}","summary":"...","timestamp":'$(date +%s%3N)'}' > {DELTA_WORKSPACE}/events/$(date +%s%3N)-{task_id}-task_complete.json

To add a decision to the shared plan:
  echo '{"type":"plan_update","task_id":"{task_id}","agent":"{agent}","section":"decisions","content":"...","timestamp":'$(date +%s%3N)'}' > {DELTA_WORKSPACE}/events/$(date +%s%3N)-{task_id}-plan_update.json

## Reading Shared Context
- Plan: cat {DELTA_WORKSPACE}/plan.md
- Other agents' events: ls {DELTA_WORKSPACE}/events/

Now begin working on your task.
```

### 2.5 Injecting responses into agent PTYs

When the orchestrator needs to send information to a running agent (question answer, gate failure, etc.), it uses `pty_write` to send a structured text block:

```
--- ORCHESTRATOR MESSAGE ---
[Question Answered] q-1711234601
Question: Should token refresh use sliding window or fixed expiry?
Answer: sliding (from: user)
--- END MESSAGE ---
```

For gate failures:
```
--- ORCHESTRATOR MESSAGE ---
[Gate Failed] Gate 0: cargo test --lib auth
Exit code: 1
Output:
  test auth::test_token_refresh ... FAILED
  thread 'auth::test_token_refresh' panicked at 'assertion failed'

Please fix the failing test and signal task_complete again when ready.
--- END MESSAGE ---
```

This is injected as text into the PTY's stdin. The agent (Claude, Codex, etc.) sees it as user input and can act on it.

---

## 3. Orchestrator

### 3.1 Module location

`src-tauri/src/delta/orchestrator.rs`

### 3.2 Responsibilities

1. **DAG evaluation** — on every task reaching `done`, scan for tasks whose `depends_on` are all `done` and transition them from `blocked` → `ready`.

2. **Agent spawning** — when a task becomes `ready`:
   - Create a git worktree in the task's repo. **Branch base**: if the task has dependencies in the same repo, create the worktree from the last completed predecessor's branch (not from HEAD). If no same-repo dependencies, create from the repo's default branch.
   - Branch name: `delta/{delta-name}/{task-id}`
   - Spawn a PTY session in that worktree with the agent command, injecting `DELTA_WORKSPACE` and `DELTA_TASK_ID` env vars
   - Send the initial prompt via `pty_write`
   - Record the PTY session ID and worktree path in `tasks/{task-id}.json`

3. **Gate execution** — when an agent signals `task_complete`:
   - Set task status to `verifying`
   - Run gates sequentially in the task's worktree (each gate is a subprocess with a 120s timeout)
   - If all pass → `done`, write gate results, trigger DAG re-evaluation
   - If any fail → back to `running`, inject failure context into agent's PTY via `pty_write`, increment `retry_count`

4. **Question management**:
   - Blocking question → set task to `blocked_on_question`, emit `delta-question` to frontend
   - User answers (via `delta_answer_question` command) → write `question_answered` event, inject answer into agent PTY via `pty_write`, resume task to `running`
   - Non-blocking question → emit to frontend, no state change

5. **Review orchestration** — when all tasks are `done`:
   - Transition Delta to `reviewing`
   - Spawn review agents per task (or one global reviewer)
   - Each review agent gets: the plan, the task's diff, the event history
   - Collect `review_finding` events, present to user for resolution

6. **Completion** — when user approves (`delta_approve_merge`):
   - Merge worktree branches into an integration branch (`delta/{delta-name}/integration`) using sequential merge (in DAG topological order)
   - If merge conflicts → surface in event feed with the conflicting files. User can assign an agent to resolve or resolve manually.
   - Generate `summary.md`
   - Clean up worktrees (user option: auto-clean or keep)
   - Transition Delta to `completed`

7. **Cancellation** — `delta_cancel` command:
   - Destroy all active PTY sessions for the Delta's tasks
   - Set all non-`done` tasks to a terminal state
   - Transition Delta to `cancelled`
   - Worktrees remain for inspection (user can delete manually)

### 3.3 Concurrency

- Each task's worktree is isolated — no write conflicts between agents on code.
- The events directory is append-only with unique filenames (`{timestamp}-{task_id}-{type}`) — no write conflicts on events.
- The orchestrator is the single writer for `tasks/*.json`, `dag.json`, and `delta.json` — no mutex needed for task state.
- `plan.md` updates from agents go through the orchestrator (it processes `plan_update` events and appends) — single writer.

### 3.4 Recovery on restart

On application startup, the orchestrator scans `~/.entire/deltas/` for Deltas in `executing` or `reviewing` status:

1. Reads `tasks/*.json` to reconstruct task states
2. For tasks in `running` or `verifying` — checks if the PTY session still exists. If not (app crashed), respawns the agent with context about what was already done (reads events for that task).
3. For tasks in `blocked_on_question` — re-emits the question to the frontend.
4. Resumes DAG evaluation.

---

## 4. Planning Phase

### 4.1 Flow

1. User creates a new Delta → selects target repos → enters description
2. Delta status: `planning`
3. The Chat tab opens in **planning mode**: left pane is a conversation with the planning LLM, right pane is the evolving plan document
4. The planning LLM:
   - Analyzes the codebase (reads repo structure, key files)
   - Proposes task decomposition with dependencies
   - Suggests verification gates per task
   - Recommends agent assignments
5. User iterates: adjusts tasks, edits gates, changes agents, adds constraints
6. The plan document on the right updates in real-time as the conversation progresses
7. User can directly edit the plan pane (it's a text editor, not read-only)
8. **"Approve Plan & Launch"** button on the plan pane:
   - Freezes the plan
   - Writes `dag.json` from the structured plan (see 4.3)
   - Transitions Delta to `ready` → `executing`
   - Orchestrator begins spawning agents per DAG order

### 4.2 Planning LLM

The planning phase uses a single LLM session (user's choice of agent) that runs in a PTY like current agent tabs. The difference is its prompt:

```
You are a planning agent for Entire. Your job is to decompose a feature request
into a task DAG with verification gates.

## Repos
{list of repos with structure summaries}

## Output Format
As you discuss with the user, maintain a structured plan. After each significant
change, output a fenced JSON block tagged ```dag that contains the current task
graph in this format:

{dag.json schema example}

This block will be parsed by the system to generate the execution plan.
Also write a human-readable summary to {DELTA_WORKSPACE}/plan.md.

## Gate Types
- command: { "type": "command", "run": "...", "expect": "exit_0" }
- file_exists: { "type": "file_exists", "path": "relative/path" }
- agent_review: { "type": "agent_review", "prompt": "..." }

## Agent Options
claude-code, codex, gemini, cursor
```

### 4.3 Plan-to-DAG conversion

When the user clicks "Approve Plan & Launch", the `delta_approve_plan` command:

1. Scans `plan.md` for the last fenced code block tagged ` ```dag `
2. Parses it as JSON into the `dag.json` schema
3. Validates: all `depends_on` references exist, no cycles (topological sort succeeds), all repos are in the Delta's repo list
4. If parsing fails (LLM didn't produce clean JSON), falls back to a one-shot LLM call: sends the full `plan.md` content with a system prompt "Extract the task DAG as JSON" and parses the response
5. Writes validated `dag.json`
6. Transitions Delta to `executing`

### 4.4 Multiple planning agents (future)

Step 3 of the user's workflow mentioned using multiple agents to define the plan. For v1, we use a single planning agent. The architecture supports multiple planners later — they'd each write `plan_update` events and the orchestrator merges them, with the user as the final arbiter.

---

## 5. Frontend Architecture

### 5.1 Navigation restructure

**Before:**
```
Sidebar (repos/branches) | TabBar (branch tabs) | Content
```

**After:**
```
Sidebar (Delta list) | TabBar (agent tabs per Delta) | Content
```

The sidebar shows:
- List of Deltas with status indicators and task progress (e.g., "3/5 tasks done")
- "+ New Delta" button at the bottom
- Completed Deltas shown in a "History" section (collapsed)

Selecting a Delta populates the tab bar with its agents. Each tab represents a task's agent (labeled with the task title). The inner tabs remain: Chat (split view), Checkpoints, Diff, Insights, Debug.

### 5.2 Tab model changes

The existing `Tab` interface is extended:

```typescript
interface Tab {
  id: string;
  branch: string;
  repoPath: string;
  worktree: WorktreeInfo | null;
  kind: "branch" | "agent" | "delta-task";
  agent: string | null;
  hasActiveSession: boolean;
  // New fields for Delta tasks
  deltaId?: string;
  taskId?: string;
}
```

When a Delta is selected, its tasks become tabs with `kind: "delta-task"`. Clicking a task tab shows that agent's PTY terminal (same as current agent tabs). The Chat inner tab always shows the Delta-level split view regardless of which task tab is selected.

### 5.3 Delta creation flow

1. User clicks "+ New Delta"
2. Modal:
   - Name the Delta
   - Select repos (from registered repos, multi-select with checkboxes)
   - Describe the objective (text area)
3. On submit → `delta_create` → creates workspace, opens the Delta in planning mode

### 5.4 Split view — the Chat tab

The Chat inner tab becomes a split view for Deltas:

**Left pane — Conversation / Event Feed:**
- During planning: conversation with the planning LLM (the planning agent's PTY)
- During execution: chronological event feed showing agent progress, questions, state transitions
- Blocking questions appear inline with answer buttons (text input + predefined options if provided)
- User can type messages to broadcast to all agents or @-mention a specific task's agent
- Filter toggles: All | Questions | Decisions | Progress

**Right pane — Plan Document:**
- During planning: editable plan that updates as the LLM proposes changes
- During execution: read-only plan with live progress indicators per task
- Task status badges: blocked (grey), running (blue pulse), verifying (yellow), done (green check)
- Gate results shown inline under each task (checkmark or X with output)
- Decisions log at the bottom (accumulates throughout the Delta)
- DAG visualization (small box-and-arrow diagram showing task dependencies and status)

### 5.5 Review UI

During the `reviewing` phase:
- Left pane shows review agent findings as they come in
- Right pane shows a review summary: per-task status, findings grouped by severity
- Each finding has actions: Dismiss, Fix (sends task back to `running`), Comment
- "Request Fixes" button → affected tasks go back to `running` with review feedback injected
- "Approve & Merge" button → triggers completion flow

### 5.6 Key components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DeltaSidebar` | `src/features/delta/DeltaSidebar.tsx` | Delta list with status, replaces repo sidebar |
| `DeltaCreationModal` | `src/features/delta/DeltaCreationModal.tsx` | New Delta form with repo selection |
| `DeltaSplitView` | `src/features/delta/DeltaSplitView.tsx` | Left/right split container |
| `EventFeed` | `src/features/delta/EventFeed.tsx` | Chronological event stream with filters |
| `PlanPane` | `src/features/delta/PlanPane.tsx` | Plan document viewer/editor |
| `TaskDAG` | `src/features/delta/TaskDAG.tsx` | Visual DAG diagram |
| `QuestionCard` | `src/features/delta/QuestionCard.tsx` | Inline blocking question with answer UI |
| `ReviewSummary` | `src/features/delta/ReviewSummary.tsx` | Review findings and actions |
| `GateResult` | `src/features/delta/GateResult.tsx` | Gate pass/fail display |

---

## 6. Rust Backend Modules

### 6.1 New modules

| Module | File | Purpose |
|--------|------|---------|
| `delta` | `src-tauri/src/delta/mod.rs` | Delta CRUD, state management, types |
| `orchestrator` | `src-tauri/src/delta/orchestrator.rs` | DAG evaluation, agent lifecycle, gate execution, recovery |
| `events` | `src-tauri/src/delta/events.rs` | Event parsing, routing, file watching |
| `gates` | `src-tauri/src/delta/gates.rs` | Gate execution logic with timeouts |
| `planner` | `src-tauri/src/delta/planner.rs` | Planning phase agent setup, plan-to-DAG parsing |

### 6.2 Modified modules

| Module | Change |
|--------|--------|
| `pty/mod.rs` | Add `env_vars: Option<HashMap<String, String>>` parameter to `pty_create` for injecting `DELTA_WORKSPACE` and `DELTA_TASK_ID` |
| `watcher/mod.rs` | Add a separate `RecursiveMode::Recursive` watcher for `~/.entire/deltas/` |
| `lib.rs` | Register new delta commands in the Tauri handler |

### 6.3 New Tauri commands

| Command | Purpose |
|---------|---------|
| `delta_create` | Create a new Delta workspace on disk |
| `delta_list` | List all Deltas with status and task progress |
| `delta_get` | Get full Delta state (metadata, dag, events, tasks) |
| `delta_update_plan` | Write to plan.md during planning |
| `delta_approve_plan` | Parse plan → dag.json, transition to executing |
| `delta_answer_question` | User answers a blocking question |
| `delta_dismiss_finding` | Dismiss a review finding |
| `delta_request_fixes` | Send tasks back to running with review feedback |
| `delta_approve_merge` | Trigger completion, merge, and summary |
| `delta_cancel` | Cancel a running Delta, destroy PTYs |
| `delta_pause_task` | Pause a specific task (agent keeps PTY but gets a "pause" message) |
| `delta_delete` | Delete a Delta and clean up worktrees |

### 6.4 New Tauri events

| Event | Payload | Direction |
|-------|---------|-----------|
| `delta-event` | Parsed event from any agent or system | Backend → Frontend |
| `delta-state-change` | Delta or task status transition | Backend → Frontend |
| `delta-gate-result` | Gate pass/fail with output | Backend → Frontend |
| `delta-question` | New blocking question needing user input | Backend → Frontend |

---

## 7. Data Flow Summary

```
User creates Delta
  → delta_create → ~/.entire/deltas/{id}/ created
  → Planning LLM spawned in PTY with DELTA_WORKSPACE env var
  → User + LLM iterate on plan.md
  → LLM outputs ```dag JSON blocks as plan evolves

User approves plan
  → delta_approve_plan
  → Parse last ```dag block from plan.md → validate → write dag.json
  → Orchestrator evaluates DAG → finds tasks with no dependencies
  → For each ready task:
      → Create worktree (base: predecessor branch or default branch)
      → Spawn agent PTY with env vars + initial prompt
      → Agent works, writes event files to events/

File watcher detects new event file
  → Orchestrator parses event
  → Routes:
      progress → emit delta-event to frontend
      question (blocking) → task → blocked_on_question, emit delta-question
      question (non-blocking) → emit delta-event only
      task_complete → task → verifying, run gates
      plan_update → append to plan.md, emit delta-event

Gates run (sequential, 120s timeout each)
  → All pass → task → done → re-evaluate DAG → spawn next ready tasks
  → Any fail → task → running, inject failure into agent PTY, retry

User answers blocking question
  → delta_answer_question → write question_answered event
  → Inject answer into agent PTY → task → running

All tasks done
  → Delta → reviewing
  → Review agents spawned with plan + diffs + event history
  → review_finding events collected, shown to user

User approves
  → delta_approve_merge
  → Merge branches sequentially (topological order) into integration branch
  → If conflicts → surface to user, assign resolution agent or manual
  → Generate summary.md
  → Clean up worktrees (optional)
  → Delta → completed
```

---

## 8. Migration from Current Architecture

The existing repo/branch sidebar and tab system remain functional but become secondary:

1. **Phase 1**: Build Delta system alongside existing sidebar. Add a toggle to switch between "Deltas" and "Repos" views in the sidebar. Both coexist.
2. **Phase 2**: Once Delta workflow is stable, make it the default. Move repo browsing to Delta creation (for selecting target repos) and settings.
3. **Phase 3**: Remove standalone repo sidebar. Repos are only visible during Delta creation and in settings.

The existing PTY, worktree, and checkpoint infrastructure is reused by the Delta system — no throwaway work.

---

## 9. Terminology

To avoid ambiguity, this spec uses these terms consistently:

- **Executor agent** — a long-running CLI process (Claude, Codex, etc.) in a PTY that performs a task
- **Review agent** — a short-lived CLI process that evaluates an executor's work
- **Planning LLM** — the interactive LLM session used during the planning phase to decompose the feature
- **Orchestrator** — deterministic Rust code that manages the DAG, spawns agents, runs gates. Not an LLM.

---

## 10. Out of Scope for v1

- Multiple planning agents (single planner for v1)
- Agent-to-agent direct messaging (agents communicate via shared events, not direct channels)
- Automatic conflict resolution between concurrent agent worktrees
- Cost budgets per task/Delta
- CI/CD integration (running gates in CI)
- Delta templates (reusable task patterns)
- Streaming plan pane updates (v1: poll plan.md on a timer; v2: watcher-driven live updates)

These are natural extensions once the core is stable.
