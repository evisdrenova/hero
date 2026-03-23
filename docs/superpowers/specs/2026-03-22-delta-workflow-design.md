# Delta Workflow System — Design Spec

## Overview

A **Delta** is the primary unit of work in Entire. It represents a feature, bugfix, or initiative executed by one or more AI agents working in parallel across isolated git worktrees, coordinated through a shared file-based workspace with a strict task DAG and verification gates.

Deltas replace the repo/branch sidebar as the top-level navigation concept. Repos and branches become implementation details managed by the system.

---

## 1. Core Data Model

### 1.1 Delta workspace on disk

```
.entire/deltas/{delta-id}/
├── delta.json                        # metadata
├── plan.md                           # living plan document
├── dag.json                          # task graph with gates
├── tasks/
│   └── {task-id}.json                # per-task state
├── events/
│   └── {timestamp}-{type}.json       # append-only event log
├── questions/
│   └── {question-id}.json            # blocking/non-blocking questions
└── summary.md                        # generated on completion
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

**Delta statuses:** `planning` → `ready` → `executing` → `reviewing` → `completed`

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
        { "type": "command", "run": "npm test -- --filter auth", "expect": "exit_0" },
        { "type": "test_pass" }
      ]
    }
  ]
}
```

### 1.4 Task states

`blocked` → `ready` → `running` → `verifying` → `passed` | `failed` → `done`

Additional state: `blocked_on_question` (when an agent posts a blocking question).

When gates fail, the task returns to `running` with failure context injected into the agent.

### 1.5 tasks/{task-id}.json

```json
{
  "id": "task-1",
  "status": "running",
  "agent": "claude-code",
  "pty_session_id": "pty-1711234567-123",
  "worktree_path": "/Users/dev/api-delta-task-1",
  "worktree_branch": "delta/oauth2-auth/task-1",
  "started_at": 1711234600,
  "completed_at": null,
  "gate_results": [],
  "summary": null
}
```

### 1.6 Gate types

| Type | Description | Pass condition |
|------|-------------|----------------|
| `command` | Run a shell command in the task's worktree | Exit code matches `expect` (`exit_0` or regex on stdout) |
| `file_exists` | Check a file was created | File exists at path relative to worktree |
| `test_pass` | Run the project's test suite | Exit code 0 |
| `agent_review` | Spin up a short-lived review agent | Agent returns no `error`-severity findings |

---

## 2. Event System

### 2.1 Event types

All events are JSON files written to `.entire/deltas/{id}/events/`.

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

The Rust file watcher monitors `.entire/deltas/{id}/events/` and:

1. Parses each new event file
2. Emits a typed Tauri event (`delta-event`) to the frontend
3. Routes to the orchestrator for state transitions:
   - `task_complete` → trigger gate verification
   - `question` (blocking) → pause task, notify frontend
   - `plan_update` → append to `plan.md`

### 2.3 Agent communication protocol

Agents interact with the Delta exclusively via file I/O. On spawn, each agent receives:

- `DELTA_WORKSPACE` env var → `.entire/deltas/{id}/`
- Initial prompt with the plan, task description, predecessor summaries, gates, and the file-based communication protocol

To post an event, an agent writes a JSON file to `{DELTA_WORKSPACE}/events/`. Filename format: `{unix_millis}-{type}.json`.

To read shared context, an agent reads `{DELTA_WORKSPACE}/plan.md` or other agents' event files.

---

## 3. Orchestrator

### 3.1 Module location

`src-tauri/src/delta/orchestrator.rs`

### 3.2 Responsibilities

1. **DAG evaluation** — on every `task_complete` or gate pass, scan for newly unblocked tasks and transition them to `ready`.

2. **Agent spawning** — when a task becomes `ready`:
   - Create a git worktree: `delta/{delta-name}/{task-id}` branch in the task's repo
   - Spawn a PTY session in that worktree with the agent command
   - Inject the initial prompt (plan + task + context + communication protocol)
   - Record the PTY session ID and worktree path in `tasks/{task-id}.json`

3. **Gate execution** — when an agent signals `task_complete`:
   - Set task status to `verifying`
   - Run gates sequentially in the task's worktree
   - If all pass → `passed` → `done`, write gate results, trigger DAG re-evaluation
   - If any fail → `failed` → `running`, inject failure context into agent's PTY, reset

4. **Question management**:
   - Blocking question → set task to `blocked_on_question`, emit to frontend
   - User answers → write `question_answered` event, inject answer into agent PTY, resume task to `running`
   - Non-blocking question → emit to frontend, agent continues

5. **Review orchestration** — when all tasks are `done`:
   - Transition Delta to `reviewing`
   - Spawn review agents per task (or one global reviewer)
   - Collect `review_finding` events
   - Present to user for resolution

6. **Completion** — when user approves:
   - Merge worktree branches into integration branch
   - Surface merge conflicts if any
   - Generate `summary.md`
   - Clean up worktrees (optional)
   - Transition Delta to `completed`

### 3.3 Concurrency

- Each task's worktree is isolated — no write conflicts between agents on code.
- The events directory is append-only with unique timestamped filenames — no write conflicts on events.
- The orchestrator is the single writer for `tasks/*.json` and `dag.json` — no mutex needed for task state.
- `plan.md` updates from agents go through the orchestrator (it processes `plan_update` events and appends) — single writer.
- Questions directory: agents write, orchestrator reads. Orchestrator writes answers. No concurrent writes to the same file.

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
   - Writes `dag.json` from the structured plan
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
As you discuss with the user, maintain a structured plan with:
- Tasks (title, description, repo, dependencies)
- Gates per task (command, file_exists, test_pass, agent_review)
- Agent assignment per task

Write plan updates to {DELTA_WORKSPACE}/plan.md as the conversation progresses.
```

### 4.3 Multiple planning agents (future)

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
Sidebar (Delta list) | TabBar (agent tabs) | Content
```

The sidebar shows:
- List of Deltas with status indicators and task progress (e.g., "3/5 tasks done")
- "+ New Delta" button at the bottom
- Completed Deltas shown in a "History" section (collapsed)

Selecting a Delta populates the tab bar with its agents (one tab per running agent). The inner tabs remain: Chat (event feed), Checkpoints, Diff, Insights, Debug.

### 5.2 Delta creation flow

1. User clicks "+ New Delta"
2. Modal or inline form:
   - Name the Delta
   - Select repos (from registered repos, multi-select)
   - Describe the objective (text area)
3. On submit → creates `.entire/deltas/{id}/` workspace, opens the Delta in planning mode

### 5.3 Split view — the Chat tab

The Chat inner tab becomes a split view for Deltas:

**Left pane — Conversation / Event Feed:**
- During planning: conversation with the planning LLM
- During execution: chronological event feed showing agent progress, questions, state transitions
- Blocking questions appear inline with answer buttons
- User can type messages to broadcast to all agents or address specific ones
- Filter toggles: All | Questions | Decisions | Progress

**Right pane — Plan Document:**
- During planning: editable plan that updates as the LLM proposes changes
- During execution: read-only plan with live progress indicators per task
- Task status badges: blocked, running, verifying, done
- Gate results shown inline under each task
- Decisions log at the bottom (accumulates throughout the Delta)
- DAG visualization (small box-and-arrow diagram) below the task list

### 5.4 Review UI

During the `reviewing` phase:
- Left pane shows review agent findings as they come in
- Right pane shows a review summary: per-task status, findings with severity
- Each finding has actions: Dismiss, Fix (sends agent back), Comment
- "Request Fixes" button → affected tasks go back to `running`
- "Approve & Merge" button → triggers completion flow

### 5.5 Key components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DeltaSidebar` | `src/features/delta/DeltaSidebar.tsx` | Delta list with status, replaces repo sidebar |
| `DeltaCreationModal` | `src/features/delta/DeltaCreationModal.tsx` | New Delta form with repo selection |
| `DeltaSplitView` | `src/features/delta/DeltaSplitView.tsx` | Left/right split container |
| `EventFeed` | `src/features/delta/EventFeed.tsx` | Chronological event stream |
| `PlanPane` | `src/features/delta/PlanPane.tsx` | Plan document viewer/editor |
| `TaskDAG` | `src/features/delta/TaskDAG.tsx` | Visual DAG diagram |
| `QuestionCard` | `src/features/delta/QuestionCard.tsx` | Inline blocking question with actions |
| `ReviewSummary` | `src/features/delta/ReviewSummary.tsx` | Review findings and actions |
| `GateResult` | `src/features/delta/GateResult.tsx` | Gate pass/fail display |

---

## 6. Rust Backend Modules

### 6.1 New modules

| Module | File | Purpose |
|--------|------|---------|
| `delta` | `src-tauri/src/delta/mod.rs` | Delta CRUD, state management |
| `orchestrator` | `src-tauri/src/delta/orchestrator.rs` | DAG evaluation, agent lifecycle, gate execution |
| `events` | `src-tauri/src/delta/events.rs` | Event parsing, routing, file watching |
| `gates` | `src-tauri/src/delta/gates.rs` | Gate execution logic |
| `planner` | `src-tauri/src/delta/planner.rs` | Planning phase agent setup |

### 6.2 New Tauri commands

| Command | Purpose |
|---------|---------|
| `delta_create` | Create a new Delta workspace |
| `delta_list` | List all Deltas with status |
| `delta_get` | Get full Delta state (metadata, dag, events) |
| `delta_update_plan` | Write to plan.md during planning |
| `delta_approve_plan` | Transition from planning → executing |
| `delta_answer_question` | User answers a blocking question |
| `delta_dismiss_finding` | Dismiss a review finding |
| `delta_request_fixes` | Send tasks back to running |
| `delta_approve_merge` | Trigger completion and merge |
| `delta_delete` | Delete a Delta and clean up worktrees |

### 6.3 New Tauri events

| Event | Payload | Direction |
|-------|---------|-----------|
| `delta-event` | Parsed event from any agent | Backend → Frontend |
| `delta-state-change` | Delta or task status transition | Backend → Frontend |
| `delta-gate-result` | Gate pass/fail | Backend → Frontend |
| `delta-question` | New blocking question | Backend → Frontend |

---

## 7. Data Flow Summary

```
User creates Delta
  → delta_create → .entire/deltas/{id}/ created
  → Planning LLM spawned in PTY
  → User + LLM iterate on plan.md

User approves plan
  → delta_approve_plan → dag.json written
  → Orchestrator evaluates DAG → finds tasks with no dependencies
  → For each ready task:
      → Create worktree (delta/{name}/{task-id} branch)
      → Spawn agent PTY with plan + task context
      → Agent works, writes events to events/

Agent writes event file
  → File watcher detects new file
  → Orchestrator parses event
  → Routes: progress → emit to frontend
           question (blocking) → pause task, emit to frontend
           task_complete → run gates

Gates run
  → All pass → task done → re-evaluate DAG → spawn next agents
  → Any fail → inject failure into agent → agent retries

All tasks done
  → Delta → reviewing
  → Review agents spawned
  → Findings collected, shown to user

User approves
  → Merge branches → generate summary → Delta completed
```

---

## 8. Migration from Current Architecture

The existing repo/branch sidebar and tab system remain functional but become secondary:

1. **Phase 1**: Build Delta system alongside existing sidebar. Add a toggle or tab to switch between "Deltas" and "Repos" views in the sidebar.
2. **Phase 2**: Once Delta workflow is stable, make it the default. Move repo browsing to a "Repos" section within Delta creation (for selecting target repos).
3. **Phase 3**: Remove standalone repo sidebar. Repos are only visible during Delta creation and in settings.

The existing PTY, worktree, and checkpoint infrastructure is reused by the Delta system — no throwaway work.

---

## 9. Out of Scope for v1

- Multiple planning agents (single planner for v1)
- Agent-to-agent direct messaging (agents communicate via shared events, not direct channels)
- Automatic conflict resolution between concurrent agent worktrees
- Cost budgets per task/Delta
- CI/CD integration (running gates in CI)
- Delta templates (reusable task patterns)

These are natural extensions once the core is stable.
