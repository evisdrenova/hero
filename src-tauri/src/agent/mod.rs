use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, State};

/// Payload emitted to the frontend for each line of agent output.
#[derive(Clone, serde::Serialize)]
pub struct AgentOutputPayload {
    pub session_id: String,
    /// A single line of JSON from the agent's stdout.
    pub data: String,
}

struct AgentSession {
    stdin: std::process::ChildStdin,
    child: Child,
}

pub struct AgentState {
    sessions: HashMap<String, AgentSession>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

fn generate_session_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("agent-{}-{}", now.as_secs(), now.subsec_nanos())
}

fn resolve_command(command: &str) -> &str {
    match command {
        "claude-code" => "claude",
        "codex" => "codex",
        other => other,
    }
}

/// Spawn an agent process with piped stdin/stdout (not a PTY).
/// This ensures --output-format flags are respected (no TTY detection).
#[tauri::command]
pub fn agent_create(
    app: AppHandle,
    working_dir: String,
    command: String,
    args: Option<Vec<String>>,
    state: State<'_, Mutex<AgentState>>,
) -> Result<String, String> {
    let program = resolve_command(&command);

    let mut cmd = Command::new(program);
    cmd.current_dir(&working_dir);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());

    if let Some(ref extra_args) = args {
        for arg in extra_args {
            cmd.arg(arg);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn agent: {}", e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture agent stdin".to_string())?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture agent stdout".to_string())?;

    let session_id = generate_session_id();

    // Stream stdout line-by-line to the frontend
    {
        let id = session_id.clone();
        let app_handle = app.clone();

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let _ = app_handle.emit(
                            "agent-output",
                            AgentOutputPayload {
                                session_id: id.clone(),
                                data: text,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let mut state = state.lock().map_err(|_| "State lock error".to_string())?;
    state.sessions.insert(
        session_id.clone(),
        AgentSession { stdin, child },
    );

    Ok(session_id)
}

/// Write data to an agent's stdin.
#[tauri::command]
pub fn agent_write(
    session_id: String,
    data: String,
    state: State<'_, Mutex<AgentState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "State lock error".to_string())?;
    let session = state
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Agent session not found: {}", session_id))?;

    session
        .stdin
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    session
        .stdin
        .flush()
        .map_err(|e| format!("Flush failed: {}", e))?;

    Ok(())
}

/// Destroy an agent session — kills the child process.
#[tauri::command]
pub fn agent_destroy(
    session_id: String,
    state: State<'_, Mutex<AgentState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "State lock error".to_string())?;
    if let Some(mut session) = state.sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}
