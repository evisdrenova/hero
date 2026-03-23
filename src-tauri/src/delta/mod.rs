pub mod events;
pub mod gates;
pub mod orchestrator;
pub mod planner;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn deltas_root() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME not set"))
        .join(".entire")
        .join("deltas")
}

pub fn delta_dir(delta_id: &str) -> PathBuf {
    deltas_root().join(delta_id)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaMetadata {
    pub id: String,
    pub name: String,
    pub status: DeltaStatus,
    pub repos: Vec<DeltaRepo>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DeltaEvent {
    Progress {
        delta_id: String,
        task_id: String,
        message: String,
        timestamp: u64,
    },
    Question {
        delta_id: String,
        task_id: String,
        question_id: String,
        question: String,
        timestamp: u64,
    },
    TaskComplete {
        delta_id: String,
        task_id: String,
        success: bool,
        summary: String,
        timestamp: u64,
    },
    PlanUpdate {
        delta_id: String,
        content: String,
        timestamp: u64,
    },
    TaskState {
        delta_id: String,
        task_id: String,
        state: self::TaskState,
        timestamp: u64,
    },
    GateResult {
        delta_id: String,
        task_id: String,
        gate_index: usize,
        passed: bool,
        output: String,
        timestamp: u64,
    },
    QuestionAnswered {
        delta_id: String,
        task_id: String,
        question_id: String,
        answer: String,
        timestamp: u64,
    },
    ReviewFinding {
        delta_id: String,
        task_id: String,
        severity: String,
        message: String,
        file: Option<String>,
        line: Option<u32>,
        timestamp: u64,
    },
}

// ---------------------------------------------------------------------------
// CRUD functions
// ---------------------------------------------------------------------------

pub fn create_delta_workspace(
    id: &str,
    name: &str,
    repos: Vec<DeltaRepo>,
) -> Result<DeltaMetadata, String> {
    let dir = delta_dir(id);
    std::fs::create_dir_all(dir.join("tasks"))
        .map_err(|e| format!("Failed to create tasks dir: {}", e))?;
    std::fs::create_dir_all(dir.join("events"))
        .map_err(|e| format!("Failed to create events dir: {}", e))?;

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

    let json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    std::fs::write(dir.join("delta.json"), json)
        .map_err(|e| format!("Failed to write delta.json: {}", e))?;

    std::fs::write(dir.join("plan.md"), "")
        .map_err(|e| format!("Failed to write plan.md: {}", e))?;

    Ok(meta)
}

pub fn list_deltas() -> Result<Vec<DeltaMetadata>, String> {
    let root = deltas_root();
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut deltas = Vec::new();
    let entries = std::fs::read_dir(&root)
        .map_err(|e| format!("Failed to read deltas dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let meta_path = entry.path().join("delta.json");
        if meta_path.exists() {
            let content = std::fs::read_to_string(&meta_path)
                .map_err(|e| format!("Failed to read {}: {}", meta_path.display(), e))?;
            let meta: DeltaMetadata = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse {}: {}", meta_path.display(), e))?;
            deltas.push(meta);
        }
    }

    deltas.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(deltas)
}

pub fn get_delta(delta_id: &str) -> Result<DeltaMetadata, String> {
    let meta_path = delta_dir(delta_id).join("delta.json");
    let content = std::fs::read_to_string(&meta_path)
        .map_err(|e| format!("Failed to read delta {}: {}", delta_id, e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse delta {}: {}", delta_id, e))
}

pub fn get_delta_plan(delta_id: &str) -> Result<String, String> {
    let plan_path = delta_dir(delta_id).join("plan.md");
    std::fs::read_to_string(&plan_path)
        .map_err(|e| format!("Failed to read plan for {}: {}", delta_id, e))
}

pub fn update_delta_plan(delta_id: &str, content: &str) -> Result<(), String> {
    let plan_path = delta_dir(delta_id).join("plan.md");
    std::fs::write(&plan_path, content)
        .map_err(|e| format!("Failed to write plan for {}: {}", delta_id, e))
}

pub fn update_delta_status(delta_id: &str, status: DeltaStatus) -> Result<(), String> {
    let mut meta = get_delta(delta_id)?;
    meta.status = status;
    meta.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    std::fs::write(delta_dir(delta_id).join("delta.json"), json)
        .map_err(|e| format!("Failed to write delta.json: {}", e))
}

pub fn get_delta_dag(delta_id: &str) -> Result<Option<TaskDAG>, String> {
    let dag_path = delta_dir(delta_id).join("dag.json");
    if !dag_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&dag_path)
        .map_err(|e| format!("Failed to read DAG for {}: {}", delta_id, e))?;
    let dag: TaskDAG = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse DAG for {}: {}", delta_id, e))?;
    Ok(Some(dag))
}

pub fn get_task_states(delta_id: &str) -> Result<Vec<TaskState>, String> {
    let tasks_dir = delta_dir(delta_id).join("tasks");
    if !tasks_dir.exists() {
        return Ok(Vec::new());
    }

    let mut states = Vec::new();
    let entries = std::fs::read_dir(&tasks_dir)
        .map_err(|e| format!("Failed to read tasks dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            let state: TaskState = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
            states.push(state);
        }
    }

    Ok(states)
}

pub fn get_delta_events(delta_id: &str) -> Result<Vec<DeltaEvent>, String> {
    let events_dir = delta_dir(delta_id).join("events");
    if !events_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files: Vec<_> = std::fs::read_dir(&events_dir)
        .map_err(|e| format!("Failed to read events dir: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|ext| ext.to_str())
                == Some("json")
        })
        .collect();

    files.sort_by_key(|e| e.file_name());

    let mut events = Vec::new();
    for entry in files {
        let path = entry.path();
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
        let event: DeltaEvent = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
        events.push(event);
    }

    Ok(events)
}

pub fn delete_delta(delta_id: &str) -> Result<(), String> {
    let dir = delta_dir(delta_id);
    if !dir.exists() {
        return Err(format!("Delta {} not found", delta_id));
    }
    std::fs::remove_dir_all(&dir)
        .map_err(|e| format!("Failed to delete delta {}: {}", delta_id, e))
}
