use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter, State};

/// Payload emitted to the frontend for each chunk of PTY output.
#[derive(Clone, serde::Serialize)]
pub struct PtyOutputPayload {
    pub session_id: String,
    /// Base64-encoded raw bytes from the PTY.
    pub data: String,
}

/// A running PTY session.
struct PtySession {
    /// Writer half of the PTY master — sends bytes to the child's stdin.
    writer: Box<dyn Write + Send>,
    /// The PTY pair, kept alive so the master fd stays open.
    pair: portable_pty::PtyPair,
    /// The child process.
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

// SAFETY: PtySession fields are Send. We access them only through Mutex.
unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}

pub struct PtyState {
    sessions: HashMap<String, PtySession>,
}

impl PtyState {
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
    format!("pty-{}-{}", now.as_secs(), now.subsec_nanos())
}

fn resolve_command(command: Option<&str>) -> Option<&str> {
    match command {
        Some("claude-code") => Some("claude"),
        Some("codex") => Some("codex"),
        Some("terminal") | None => None,
        Some(other) => Some(other),
    }
}

/// Create a new PTY session, spawn the child process, and start
/// streaming output to the frontend via Tauri events.
#[tauri::command]
pub fn pty_create(
    app: AppHandle,
    working_dir: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    initial_input: Option<String>,
    state: State<'_, Mutex<PtyState>>,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let resolved = resolve_command(command.as_deref());

    let mut cmd = if let Some(program) = resolved {
        let mut c = CommandBuilder::new(program);
        if let Some(ref extra_args) = args {
            for arg in extra_args {
                c.arg(arg);
            }
        }
        c
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut c = CommandBuilder::new(&shell);
        c.arg("-l"); // login shell
        c
    };

    cmd.cwd(&working_dir);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let session_id = generate_session_id();

    // Start the output reader thread
    {
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let id = session_id.clone();
        let app_handle = app.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child exited
                    Ok(n) => {
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app_handle.emit(
                            "pty-output",
                            PtyOutputPayload {
                                session_id: id.clone(),
                                data: encoded,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // Send initial input if provided (e.g., "git checkout branch && clear\n")
    let mut session = PtySession {
        writer,
        pair,
        child,
    };

    if let Some(input) = initial_input {
        let _ = session.writer.write_all(input.as_bytes());
    }

    let mut ps = state.lock().map_err(|_| "State lock error".to_string())?;
    ps.sessions.insert(session_id.clone(), session);

    Ok(session_id)
}

/// Write data to a PTY session's stdin.
#[tauri::command]
pub fn pty_write(
    session_id: String,
    data: String,
    state: State<'_, Mutex<PtyState>>,
) -> Result<(), String> {
    let mut ps = state.lock().map_err(|_| "State lock error".to_string())?;
    let session = ps
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;

    Ok(())
}

/// Resize a PTY session.
#[tauri::command]
pub fn pty_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, Mutex<PtyState>>,
) -> Result<(), String> {
    let ps = state.lock().map_err(|_| "State lock error".to_string())?;
    let session = ps
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    session
        .pair
        .master
        .resize(PtySize {
            rows: rows as u16,
            cols: cols as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {}", e))?;

    Ok(())
}

/// Destroy a PTY session — kills the child and cleans up.
#[tauri::command]
pub fn pty_destroy(
    session_id: String,
    state: State<'_, Mutex<PtyState>>,
) -> Result<(), String> {
    let mut ps = state.lock().map_err(|_| "State lock error".to_string())?;
    if let Some(mut session) = ps.sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::resolve_command;

    #[test]
    fn resolves_agent_command_names() {
        assert_eq!(resolve_command(Some("claude-code")), Some("claude"));
        assert_eq!(resolve_command(Some("codex")), Some("codex"));
        assert_eq!(resolve_command(Some("terminal")), None);
        assert_eq!(resolve_command(None), None);
        assert_eq!(resolve_command(Some("custom-agent")), Some("custom-agent"));
    }
}
