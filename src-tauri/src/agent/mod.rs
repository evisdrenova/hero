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

    eprintln!("[agent] === agent_create START ===");
    eprintln!("[agent] program={}, working_dir={}", program, working_dir);
    eprintln!("[agent] args={:?}", args);
    eprintln!("[agent] prompt (first 200 chars): {}", &prompt[..prompt.len().min(200)]);

    let mut cmd = Command::new(program);
    cmd.current_dir(&working_dir);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Unset CLAUDECODE env var so claude doesn't refuse to run
    // inside another claude session (the Tauri app may inherit this)
    cmd.env_remove("CLAUDECODE");

    // Inject extra environment variables if provided
    if let Some(ref vars) = env_vars {
        for (key, value) in vars {
            eprintln!("[agent] env: {}={}", key, if key.contains("KEY") || key.contains("SECRET") { "***" } else { value.as_str() });
            cmd.env(key, value);
        }
    }

    // Add -p flag for non-interactive print mode
    cmd.arg("-p");

    // Add extra args (e.g., --output-format stream-json)
    if let Some(ref extra_args) = args {
        for arg in extra_args {
            cmd.arg(arg);
        }
    }

    // The prompt is the last argument
    cmd.arg(&prompt);

    // Log the full command for debugging
    eprintln!("[agent] Full command: {} -p {} \"<prompt>\"",
        program,
        args.as_ref().map(|a| a.join(" ")).unwrap_or_default()
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| {
            eprintln!("[agent] Spawn FAILED: {}", e);
            format!("Failed to spawn agent: {}", e)
        })?;

    let pid = child.id();
    eprintln!("[agent] Spawned pid={}, returning session_id to frontend now", pid);

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
            let start = std::time::Instant::now();
            eprintln!("[agent:{}] stdout reader started (t=0ms)", id);
            let reader = BufReader::new(stdout);
            let mut line_count = 0u64;
            for line in reader.lines() {
                let elapsed = start.elapsed().as_millis();
                match line {
                    Ok(text) if !text.is_empty() => {
                        line_count += 1;
                        // Log every line with type info for debugging
                        let type_hint = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                            let t = v.get("type").and_then(|t| t.as_str()).unwrap_or("?");
                            let sub = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
                            if sub.is_empty() { t.to_string() } else { format!("{}/{}", t, sub) }
                        } else {
                            "non-json".to_string()
                        };
                        eprintln!("[agent:{}] stdout line {}: type={} len={} (t={}ms)", id, line_count, type_hint, text.len(), elapsed);
                        let emit_result = app_handle.emit(
                            "agent-output",
                            AgentOutputPayload {
                                session_id: id.clone(),
                                data: text,
                            },
                        );
                        if let Err(e) = emit_result {
                            eprintln!("[agent:{}] EMIT FAILED: {} (t={}ms)", id, e, elapsed);
                        }
                    }
                    Ok(_) => {
                        eprintln!("[agent:{}] stdout: empty line skipped (t={}ms)", id, elapsed);
                    }
                    Err(e) => {
                        eprintln!("[agent:{}] stdout error: {} (t={}ms)", id, e, elapsed);
                        break;
                    }
                }
            }
            let elapsed = start.elapsed().as_millis();
            eprintln!("[agent:{}] stdout EOF after {} lines (t={}ms) — emitting agent-done", id, line_count, elapsed);
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
            let start = std::time::Instant::now();
            eprintln!("[agent:{}] stderr reader started (t=0ms)", id);
            let reader = BufReader::new(stderr);
            let mut stderr_line_count = 0u64;
            for line in reader.lines() {
                let elapsed = start.elapsed().as_millis();
                match line {
                    Ok(text) if !text.is_empty() => {
                        stderr_line_count += 1;
                        eprintln!("[agent:{}] STDERR line {}: {} (t={}ms)", id, stderr_line_count, text, elapsed);
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
                        eprintln!("[agent:{}] stderr error: {} (t={}ms)", id, e, elapsed);
                        break;
                    }
                }
            }
            let elapsed = start.elapsed().as_millis();
            eprintln!("[agent:{}] stderr EOF after {} lines (t={}ms)", id, stderr_line_count, elapsed);
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
