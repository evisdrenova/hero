use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, State};

/// Payload emitted to the frontend for each line of agent output.
#[derive(Clone, serde::Serialize)]
pub struct AgentOutputPayload {
    pub session_id: String,
    /// A single line from the agent's stdout.
    pub data: String,
}

/// Payload emitted when the agent process exits.
#[derive(Clone, serde::Serialize)]
pub struct AgentDonePayload {
    pub session_id: String,
    pub exit_code: Option<i32>,
}

struct AgentSession {
    child: Child,
    stdin: Option<ChildStdin>,
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

/// Spawn an agent process with `-p` flag.
/// The prompt is passed as a trailing argument — the process outputs to stdout and exits.
#[tauri::command]
pub fn agent_create(
    app: AppHandle,
    working_dir: String,
    command: String,
    prompt: String,
    args: Option<Vec<String>>,
    env_vars: Option<std::collections::HashMap<String, String>>,
    state: State<'_, Mutex<AgentState>>,
) -> Result<String, String> {
    let program = resolve_command(&command);

    eprintln!("[agent] Spawning: {} -p {:?} {:?}", program, args, prompt);

    let mut cmd = Command::new(program);
    cmd.current_dir(&working_dir);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Unset CLAUDECODE env var so claude doesn't refuse to run
    // inside another claude session (the Tauri app may inherit this)
    cmd.env_remove("CLAUDECODE");

    // Inject extra environment variables if provided
    if let Some(vars) = env_vars {
        for (key, value) in vars {
            cmd.env(key, value);
        }
    }

    // Add -p flag for non-interactive print mode
    cmd.arg("-p");

    // Enable bidirectional stream-json for permission prompts
    cmd.arg("--input-format");
    cmd.arg("stream-json");
    cmd.arg("--permission-prompt-tool");
    cmd.arg("stdio");

    // Add extra args (e.g., --output-format stream-json)
    if let Some(ref extra_args) = args {
        for arg in extra_args {
            cmd.arg(arg);
        }
    }

    // The prompt is the last argument
    cmd.arg(&prompt);

    let mut child = cmd
        .spawn()
        .map_err(|e| {
            eprintln!("[agent] Spawn FAILED: {}", e);
            format!("Failed to spawn agent: {}", e)
        })?;

    let pid = child.id();
    eprintln!("[agent] Spawned pid={}", pid);

    let stdin = child
        .stdin
        .take();

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture agent stdout".to_string())?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture agent stderr".to_string())?;

    let session_id = generate_session_id();
    eprintln!("[agent] session_id={}", session_id);

    // Stream stdout line-by-line to the frontend
    {
        let id = session_id.clone();
        let app_handle = app.clone();

        thread::spawn(move || {
            eprintln!("[agent:{}] stdout reader started", id);
            let reader = BufReader::new(stdout);
            let mut line_count = 0u64;
            for line in reader.lines() {
                match line {
                    Ok(text) if !text.is_empty() => {
                        line_count += 1;
                        if line_count <= 5 {
                            eprintln!("[agent:{}] stdout line {}: {}", id, line_count,
                                if text.len() > 200 { format!("{}...", &text[..200]) } else { text.clone() });
                        }
                        let _ = app_handle.emit(
                            "agent-output",
                            AgentOutputPayload {
                                session_id: id.clone(),
                                data: text,
                            },
                        );
                    }
                    Ok(_) => {} // skip empty lines
                    Err(e) => {
                        eprintln!("[agent:{}] stdout error: {}", id, e);
                        break;
                    }
                }
            }
            eprintln!("[agent:{}] stdout EOF after {} lines", id, line_count);
            let _ = app_handle.emit("agent-done", AgentDonePayload {
                session_id: id,
                exit_code: None,
            });
        });
    }

    // Stream stderr — log and emit
    {
        let id = session_id.clone();
        let app_handle = app.clone();

        thread::spawn(move || {
            eprintln!("[agent:{}] stderr reader started", id);
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) if !text.is_empty() => {
                        eprintln!("[agent:{}] STDERR: {}", id, text);
                        let _ = app_handle.emit(
                            "agent-output",
                            AgentOutputPayload {
                                session_id: id.clone(),
                                data: format!(
                                    "{{\"type\":\"error\",\"error\":{{\"message\":{}}}}}",
                                    serde_json::to_string(&text).unwrap_or_else(|_| "\"unknown\"".into())
                                ),
                            },
                        );
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("[agent:{}] stderr error: {}", id, e);
                        break;
                    }
                }
            }
            eprintln!("[agent:{}] stderr EOF", id);
        });
    }

    let mut state = state.lock().map_err(|_| "State lock error".to_string())?;
    state.sessions.insert(
        session_id.clone(),
        AgentSession { child, stdin },
    );

    Ok(session_id)
}

/// Destroy an agent session — kills the child process.
#[tauri::command]
pub fn agent_destroy(
    session_id: String,
    state: State<'_, Mutex<AgentState>>,
) -> Result<(), String> {
    eprintln!("[agent] Destroying session {}", session_id);
    let mut state = state.lock().map_err(|_| "State lock error".to_string())?;
    if let Some(mut session) = state.sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// Write a line of JSON to the agent's stdin (for permission responses, follow-up messages, etc.)
#[tauri::command]
pub fn agent_write(
    session_id: String,
    data: String,
    state: State<'_, Mutex<AgentState>>,
) -> Result<(), String> {
    eprintln!("[agent] Writing to session {}: {}", session_id, if data.len() > 200 { format!("{}...", &data[..200]) } else { data.clone() });
    let mut state = state.lock().map_err(|_| "State lock error".to_string())?;
    if let Some(session) = state.sessions.get_mut(&session_id) {
        if let Some(ref mut stdin) = session.stdin {
            stdin.write_all(data.as_bytes()).map_err(|e| format!("Write error: {}", e))?;
            stdin.write_all(b"\n").map_err(|e| format!("Write error: {}", e))?;
            stdin.flush().map_err(|e| format!("Flush error: {}", e))?;
            Ok(())
        } else {
            Err("Agent stdin not available".to_string())
        }
    } else {
        Err(format!("No agent session: {}", session_id))
    }
}
