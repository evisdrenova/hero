mod agent;
mod checkpoint;
mod config;
mod git;
mod pty;
mod semantic_review;
mod session;
mod trail;
mod watcher;

use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::sync::Mutex;
use tauri::{Emitter, State};

struct AppState {
    watched_repos: HashSet<String>,
}

#[tauri::command]
fn debug_log(message: String) -> Result<(), String> {
    use std::io::Write;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let line = format!(
        "[{}.{:03}] [frontend] {}\n",
        timestamp.as_secs(),
        timestamp.subsec_millis(),
        message
    );
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/entire-terminal-debug.log")
        .and_then(|mut f| f.write_all(line.as_bytes()))
        .map_err(|e| format!("Failed to write debug log: {}", e))
}

#[tauri::command]
fn list_repos() -> Result<Vec<git::RepoInfo>, String> {
    let repo_paths = config::discover_repos();
    let registered = config::get_registered_repos();
    let registered_set: HashSet<String> = registered.into_iter().collect();
    let mut repos = Vec::new();
    for path in repo_paths {
        match git::get_repo_info(&path) {
            Ok(mut info) => {
                info.registered = registered_set.contains(&path);
                repos.push(info);
            }
            Err(e) => eprintln!("Skipping repo {}: {}", path, e),
        }
    }
    Ok(repos)
}

#[tauri::command]
fn register_repo(path: String) -> Result<(), String> {
    config::register_repo(&path)
}

#[tauri::command]
fn unregister_repo(path: String) -> Result<(), String> {
    config::unregister_repo(&path)
}

#[tauri::command]
fn hide_repo(path: String) -> Result<(), String> {
    config::hide_repo(&path)
}

#[tauri::command]
fn create_worktree(
    repo_path: String,
    mode: String,
    branch_name: String,
    target_path: String,
) -> Result<(), String> {
    git::create_worktree(&repo_path, &mode, &branch_name, &target_path)
}

#[tauri::command]
fn delete_worktree(
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    force: bool,
) -> Result<(), String> {
    git::delete_worktree(&repo_path, &worktree_path, &branch_name, force)
}

#[tauri::command]
fn delete_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    git::delete_branch(&repo_path, &branch_name)
}

#[tauri::command]
fn list_checkpoints(
    repo_path: String,
    branch: String,
) -> Result<Vec<checkpoint::CheckpointSummary>, String> {
    let repo = git::open_repo(&repo_path)?;
    checkpoint::list_checkpoints(&repo, &branch)
}

#[tauri::command]
fn get_transcript(
    repo_path: String,
    checkpoint_id: String,
    session_index: u32,
) -> Result<Vec<session::TranscriptMessage>, String> {
    let repo = git::open_repo(&repo_path)?;

    let prefix = &checkpoint_id[..2];
    let suffix = &checkpoint_id[2..];
    let meta_path = format!("{}/{}/metadata.json", prefix, suffix);
    let meta_content = read_blob(&repo, &meta_path).ok();
    let candidates =
        transcript_candidate_paths(&checkpoint_id, session_index, meta_content.as_deref());

    for path in &candidates {
        if let Ok(content) = read_blob(&repo, path) {
            return Ok(session::read_transcript(&content));
        }
    }

    Err(format!("Transcript not found for checkpoint {} session {}", checkpoint_id, session_index))
}

fn transcript_candidate_paths(
    checkpoint_id: &str,
    session_index: u32,
    meta_content: Option<&str>,
) -> Vec<String> {
    let prefix = &checkpoint_id[..2];
    let suffix = &checkpoint_id[2..];
    let requested_session_dir = format!("{}/{}/{}", prefix, suffix, session_index);
    let mut candidates = Vec::new();

    let mut push_candidate = |path: String| {
        if !path.is_empty() && !candidates.contains(&path) {
            candidates.push(path);
        }
    };

    if let Some(meta_content) = meta_content {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(meta_content) {
            if let Some(sessions) = meta.get("sessions").and_then(|s| s.as_array()) {
                let mut ordered_sessions = Vec::new();
                if let Some(session) = sessions.get(session_index as usize) {
                    ordered_sessions.push(session);
                }
                for (idx, session) in sessions.iter().enumerate() {
                    if idx != session_index as usize {
                        ordered_sessions.push(session);
                    }
                }

                for session in ordered_sessions {
                    if let Some(path) = session.get("transcript").and_then(|p| p.as_str()) {
                        push_candidate(path.trim_start_matches('/').to_string());
                    }
                }
            }
        }
    }

    push_candidate(format!("{}/full.jsonl", requested_session_dir));
    push_candidate(format!("{}/transcript.jsonl", requested_session_dir));
    candidates
}

/// Read a blob from the entire/checkpoints/v1 branch by path
fn read_blob(repo: &git2::Repository, path: &str) -> Result<String, String> {
    let branch_ref = repo
        .find_branch("entire/checkpoints/v1", git2::BranchType::Local)
        .map_err(|e| format!("No checkpoint branch: {}", e))?;

    let commit = branch_ref
        .get()
        .peel_to_commit()
        .map_err(|e| format!("Failed to peel: {}", e))?;

    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree: {}", e))?;

    let entry = tree
        .get_path(std::path::Path::new(path))
        .map_err(|e| format!("Path not found: {}", e))?;

    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("Failed to read blob: {}", e))?;

    std::str::from_utf8(blob.content())
        .map(|s| s.to_string())
        .map_err(|e| format!("Invalid UTF-8: {}", e))
}

#[cfg(test)]
mod transcript_tests {
    use super::transcript_candidate_paths;

    #[test]
    fn transcript_candidates_fall_back_to_other_metadata_sessions() {
        let meta = r#"{
            "sessions": [
                { "transcript": "/76/5026ba9e43/0/full.jsonl" },
                { "transcript": "/76/5026ba9e43/1/full.jsonl" }
            ]
        }"#;

        let candidates = transcript_candidate_paths("765026ba9e43", 0, Some(meta));

        assert_eq!(candidates[0], "76/5026ba9e43/0/full.jsonl");
        assert!(candidates
            .iter()
            .any(|candidate| candidate == "76/5026ba9e43/1/full.jsonl"));
    }
}

#[tauri::command]
fn list_sessions(repo_path: String) -> Result<Vec<session::SessionState>, String> {
    session::list_active_sessions(&repo_path)
}

#[tauri::command]
fn get_entire_settings(repo_path: String) -> Result<config::EntireSettings, String> {
    config::read_settings(&repo_path)
}

#[derive(serde::Serialize)]
struct EntireLogResult {
    lines: Vec<String>,
    total_lines: u32,
    file_size_bytes: u64,
}

#[tauri::command]
fn get_entire_logs(repo_path: String, tail_lines: u32) -> Result<EntireLogResult, String> {
    let log_path = std::path::Path::new(&repo_path).join(".entire/logs/entire.log");
    if !log_path.exists() {
        return Err("No log file found".to_string());
    }

    let metadata = std::fs::metadata(&log_path)
        .map_err(|e| format!("Failed to read log metadata: {}", e))?;
    let file_size_bytes = metadata.len();

    let file = std::fs::File::open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    // Count total lines
    let reader = BufReader::new(&file);
    let all_lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
    let total_lines = all_lines.len() as u32;

    // Take last N lines
    let start = all_lines.len().saturating_sub(tail_lines as usize);
    let lines = all_lines[start..].to_vec();

    Ok(EntireLogResult {
        lines,
        total_lines,
        file_size_bytes,
    })
}

#[tauri::command]
fn get_checkpoint_logs(
    repo_path: String,
    checkpoint_id: String,
    session_ids: Vec<String>,
) -> Result<EntireLogResult, String> {
    let log_path = std::path::Path::new(&repo_path).join(".entire/logs/entire.log");
    if !log_path.exists() {
        return Ok(EntireLogResult {
            lines: Vec::new(),
            total_lines: 0,
            file_size_bytes: 0,
        });
    }

    let metadata = std::fs::metadata(&log_path)
        .map_err(|e| format!("Failed to read log metadata: {}", e))?;
    let file_size_bytes = metadata.len();

    let file = std::fs::File::open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    let reader = BufReader::new(file);
    let mut matching_lines = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        // Parse each line as JSON and check for matching session_id or checkpoint_id
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            let line_session_id = value.get("session_id").and_then(|v| v.as_str());
            let line_checkpoint_id = value.get("checkpoint_id").and_then(|v| v.as_str());

            let matches = line_session_id
                .map(|sid| session_ids.iter().any(|s| s == sid))
                .unwrap_or(false)
                || line_checkpoint_id
                    .map(|cid| cid == checkpoint_id)
                    .unwrap_or(false);

            if matches {
                matching_lines.push(line);
            }
        }
    }

    Ok(EntireLogResult {
        total_lines: matching_lines.len() as u32,
        lines: matching_lines,
        file_size_bytes,
    })
}

#[tauri::command]
fn get_raw_checkpoint_metadata(repo_path: String, checkpoint_id: String) -> Result<String, String> {
    let repo = git::open_repo(&repo_path)?;
    let prefix = &checkpoint_id[..2];
    let suffix = &checkpoint_id[2..];
    let meta_path = format!("{}/{}/metadata.json", prefix, suffix);
    read_blob(&repo, &meta_path)
}

#[tauri::command]
fn get_raw_session_file(repo_path: String, session_id: String) -> Result<String, String> {
    let session_path = session::git_common_dir(&repo_path)
        .join("entire-sessions")
        .join(format!("{}.json", session_id));
    std::fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {}", e))
}

#[tauri::command]
fn list_trails(repo_path: String) -> Result<Vec<trail::Trail>, String> {
    let repo = git::open_repo(&repo_path)?;
    trail::list_trails(&repo)
}

#[derive(serde::Serialize)]
struct FileDiff {
    path: String,
    status: String, // "added", "modified", "deleted"
    hunks: Vec<DiffHunk>,
}

#[derive(serde::Serialize)]
struct DiffHunk {
    header: String,
    lines: Vec<DiffLine>,
}

#[derive(serde::Serialize)]
struct DiffLine {
    kind: String, // "add", "delete", "context"
    content: String,
    old_lineno: Option<u32>,
    new_lineno: Option<u32>,
}

#[derive(serde::Deserialize)]
struct CheckpointReviewMetadata {
    sessions: Option<Vec<serde_json::Value>>,
}

#[derive(serde::Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    temperature: f32,
    system: String,
    messages: Vec<AnthropicMessage>,
}

#[derive(serde::Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(serde::Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(serde::Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

/// Convert a git2::Diff into our FileDiff structs
fn collect_diff_files(diff: &git2::Diff) -> Result<Vec<FileDiff>, String> {
    let mut files: Vec<FileDiff> = Vec::new();

    diff.print(git2::DiffFormat::Patch, |delta, hunk, line| {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            _ => "modified",
        };

        // Ensure we have a FileDiff entry for this path
        if files.last().map_or(true, |f| f.path != path) {
            files.push(FileDiff {
                path: path.clone(),
                status: status.to_string(),
                hunks: Vec::new(),
            });
        }

        let file = files.last_mut().unwrap();

        // New hunk
        if let Some(h) = hunk {
            let header = std::str::from_utf8(h.header()).unwrap_or("").to_string();
            if file.hunks.last().map_or(true, |last| last.header != header) {
                file.hunks.push(DiffHunk {
                    header,
                    lines: Vec::new(),
                });
            }
        }

        // Diff line
        if let Some(current_hunk) = file.hunks.last_mut() {
            let kind = match line.origin() {
                '+' => "add",
                '-' => "delete",
                ' ' => "context",
                _ => return true,
            };
            let content = std::str::from_utf8(line.content()).unwrap_or("").to_string();
            current_hunk.lines.push(DiffLine {
                kind: kind.to_string(),
                content,
                old_lineno: line.old_lineno(),
                new_lineno: line.new_lineno(),
            });
        }

        true
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;

    Ok(files)
}

fn collect_checkpoint_diff(
    repo: &git2::Repository,
    commit_sha: &str,
) -> Result<Vec<FileDiff>, String> {
    let oid = git2::Oid::from_str(commit_sha)
        .map_err(|e| format!("Invalid commit SHA: {}", e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {}", e))?;

    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree: {}", e))?;

    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(|e| format!("Failed to compute diff: {}", e))?;

    collect_diff_files(&diff)
}

fn load_sanitized_checkpoint_transcripts(
    repo: &git2::Repository,
    checkpoint_id: &str,
) -> Result<Vec<semantic_review::PromptTranscriptSession>, String> {
    let prefix = &checkpoint_id[..2];
    let suffix = &checkpoint_id[2..];
    let meta_path = format!("{}/{}/metadata.json", prefix, suffix);
    let meta_content = read_blob(repo, &meta_path)?;
    let meta = serde_json::from_str::<CheckpointReviewMetadata>(&meta_content)
        .map_err(|e| format!("Failed to parse checkpoint metadata: {}", e))?;

    let session_count = meta.sessions.map(|sessions| sessions.len()).unwrap_or(0);
    let mut all_sessions = Vec::new();

    for session_index in 0..session_count {
        let candidates =
            transcript_candidate_paths(checkpoint_id, session_index as u32, Some(&meta_content));
        let mut transcript_content = None;
        for path in candidates {
            if let Ok(content) = read_blob(repo, &path) {
                transcript_content = Some(content);
                break;
            }
        }

        let Some(content) = transcript_content else {
            continue;
        };

        let parsed = session::read_transcript(&content);
        let sanitized = session::sanitize_transcript_for_semantic_review(&parsed, 4_000);
        if sanitized.is_empty() {
            continue;
        }

        all_sessions.push(semantic_review::PromptTranscriptSession {
            session_index: session_index as u32,
            messages: sanitized
                .into_iter()
                .map(|message| semantic_review::PromptTranscriptMessage {
                    role: message.role,
                    content: message.content,
                })
                .collect(),
        });
    }

    Ok(all_sessions)
}

fn call_anthropic_semantic_review(prompt: &str) -> Result<String, String> {
    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .map_err(|_| "ANTHROPIC_API_KEY is not set".to_string())?;
    let model = std::env::var("ANTHROPIC_MODEL")
        .unwrap_or_else(|_| "claude-sonnet-4-20250514".to_string());

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| format!("Failed to build Anthropic client: {}", e))?;

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&AnthropicRequest {
            model,
            max_tokens: 2_000,
            temperature: 0.2,
            system: "You are reviewing a git diff. Return JSON only with precise, line-linked explanations of the most important changes.".to_string(),
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
        })
        .send()
        .map_err(|e| format!("Anthropic request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    let body: AnthropicResponse = response
        .json()
        .map_err(|e| format!("Failed to decode Anthropic response: {}", e))?;

    let text = body
        .content
        .into_iter()
        .filter(|block| block.kind == "text")
        .filter_map(|block| block.text)
        .collect::<Vec<_>>()
        .join("\n");

    if text.trim().is_empty() {
        return Err("Anthropic response did not include any text output".to_string());
    }

    Ok(text)
}

fn generate_review_run_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("review-{}-{}", now.as_secs(), now.subsec_nanos())
}

#[tauri::command]
fn get_checkpoint_diff(
    repo_path: String,
    commit_sha: String,
) -> Result<Vec<FileDiff>, String> {
    if commit_sha.is_empty() {
        return Err("No commit SHA available for this checkpoint".to_string());
    }

    let repo = git::open_repo(&repo_path)?;
    collect_checkpoint_diff(&repo, &commit_sha)
}

#[tauri::command]
fn run_checkpoint_semantic_review(
    repo_path: String,
    checkpoint_id: String,
    commit_sha: String,
) -> Result<semantic_review::RunCheckpointSemanticReviewResponse, String> {
    if checkpoint_id.len() < 2 {
        return Err("Invalid checkpoint ID".to_string());
    }
    if commit_sha.is_empty() {
        return Err("No commit SHA available for this checkpoint".to_string());
    }

    let repo = git::open_repo(&repo_path)?;
    let files = collect_checkpoint_diff(&repo, &commit_sha)?;
    if files.is_empty() {
        return Ok(semantic_review::RunCheckpointSemanticReviewResponse {
            review_run_id: generate_review_run_id(),
            annotations: Vec::new(),
        });
    }

    let transcripts = load_sanitized_checkpoint_transcripts(&repo, &checkpoint_id)?;
    let prompt = semantic_review::build_prompt(&files, &transcripts);
    let raw_text = call_anthropic_semantic_review(&prompt)?;
    let parsed = semantic_review::parse_response_text(&raw_text)?;
    let annotations = semantic_review::resolve_annotations(&files, parsed);

    Ok(semantic_review::RunCheckpointSemanticReviewResponse {
        review_run_id: generate_review_run_id(),
        annotations,
    })
}

#[tauri::command]
fn get_branch_diff(
    repo_path: String,
    branch: String,
) -> Result<Vec<FileDiff>, String> {
    let repo = git::open_repo(&repo_path)?;

    // Resolve the branch HEAD
    let branch_ref = repo
        .find_branch(&branch, git2::BranchType::Local)
        .map_err(|e| format!("Branch not found: {}", e))?;
    let branch_commit = branch_ref
        .get()
        .peel_to_commit()
        .map_err(|e| format!("Failed to resolve branch HEAD: {}", e))?;

    // Find the default branch (try main, then master)
    let default_branch_name = if repo.find_branch("main", git2::BranchType::Local).is_ok() {
        "main"
    } else if repo.find_branch("master", git2::BranchType::Local).is_ok() {
        "master"
    } else {
        return Err("No default branch (main/master) found".to_string());
    };

    // If we're diffing the default branch against itself, return empty
    if branch == default_branch_name {
        return Ok(Vec::new());
    }

    let default_ref = repo
        .find_branch(default_branch_name, git2::BranchType::Local)
        .map_err(|e| format!("Default branch error: {}", e))?;
    let default_commit = default_ref
        .get()
        .peel_to_commit()
        .map_err(|e| format!("Failed to resolve default branch: {}", e))?;

    // Find merge base
    let merge_base_oid = repo
        .merge_base(default_commit.id(), branch_commit.id())
        .map_err(|e| format!("Failed to find merge base: {}", e))?;
    let merge_base_commit = repo
        .find_commit(merge_base_oid)
        .map_err(|e| format!("Failed to find merge base commit: {}", e))?;

    let base_tree = merge_base_commit
        .tree()
        .map_err(|e| format!("Failed to get base tree: {}", e))?;
    let branch_tree = branch_commit
        .tree()
        .map_err(|e| format!("Failed to get branch tree: {}", e))?;

    let diff = repo
        .diff_tree_to_tree(Some(&base_tree), Some(&branch_tree), None)
        .map_err(|e| format!("Failed to compute branch diff: {}", e))?;

    collect_diff_files(&diff)
}

#[tauri::command]
fn watch_repo(
    repo_path: String,
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let mut app_state = state.lock().map_err(|_| "State lock error".to_string())?;

    // Don't double-watch
    if app_state.watched_repos.contains(&repo_path) {
        return Ok(());
    }
    app_state.watched_repos.insert(repo_path.clone());

    let app_handle = app.clone();
    let repo_path_for_closure = repo_path.clone();
    watcher::watch_repo(&repo_path, move |event| {
        let event_name = match event {
            watcher::WatchEvent::CheckpointChanged => "checkpoint-changed",
            watcher::WatchEvent::SessionChanged(_) => "session-changed",
            watcher::WatchEvent::ConfigChanged => "config-changed",
        };
        let _ = app_handle.emit(event_name, serde_json::json!({
            "repoPath": repo_path_for_closure,
        }));
    })?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Mutex::new(AppState {
            watched_repos: HashSet::new(),
        }))
        .manage(Mutex::new(pty::PtyState::new()))
        .manage(Mutex::new(agent::AgentState::new()))
        .setup(|app| {
            // Round the window corners on macOS (decorations: false)
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                    if let Ok(handle) = window.window_handle() {
                        if let RawWindowHandle::AppKit(handle) = handle.as_raw() {
                            use objc2::msg_send;
                            use objc2::runtime::AnyObject;
                            let ns_view = handle.ns_view.as_ptr() as *mut AnyObject;
                            unsafe {
                                let ns_window: *mut AnyObject = msg_send![ns_view, window];
                                // Make the window background fully transparent so
                                // rounded corners don't show a black triangle
                                let _: () = msg_send![ns_window, setOpaque: false];
                                let ns_color_class = objc2::runtime::AnyClass::get(
                                    c"NSColor"
                                ).unwrap();
                                let clear_color: *mut AnyObject = msg_send![ns_color_class, clearColor];
                                let _: () = msg_send![ns_window, setBackgroundColor: clear_color];
                                let _: () = msg_send![ns_window, setHasShadow: true];
                                // Get the content view and round its corners
                                let content_view: *mut AnyObject = msg_send![ns_window, contentView];
                                let _: () = msg_send![content_view, setWantsLayer: true];
                                let layer: *mut AnyObject = msg_send![content_view, layer];
                                let _: () = msg_send![layer, setCornerRadius: 10.0f64];
                                let _: () = msg_send![layer, setMasksToBounds: true];
                                // Set the content view's background to the app bg color
                                let bg_color: *mut AnyObject = msg_send![
                                    ns_color_class,
                                    colorWithRed: 0.043f64,
                                    green: 0.043f64,
                                    blue: 0.051f64,
                                    alpha: 1.0f64
                                ];
                                let cg_color: *mut AnyObject = msg_send![bg_color, CGColor];
                                let _: () = msg_send![layer, setBackgroundColor: cg_color];
                            }
                        }
                    }
                }
            }

            // System tray
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;
            use tauri::Manager;

            let show = MenuItemBuilder::with_id("show", "Show Entire").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .tooltip("Entire Desktop")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            debug_log,
            list_repos,
            register_repo,
            unregister_repo,
            hide_repo,
            create_worktree,
            delete_worktree,
            delete_branch,
            list_checkpoints,
            get_transcript,
            get_checkpoint_diff,
            run_checkpoint_semantic_review,
            get_branch_diff,
            list_sessions,
            get_entire_settings,
            get_entire_logs,
            get_checkpoint_logs,
            get_raw_checkpoint_metadata,
            get_raw_session_file,
            list_trails,
            watch_repo,
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_destroy,
            agent::agent_create,
            agent::agent_destroy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
