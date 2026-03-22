use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::session;

#[derive(Debug, Serialize, Clone)]
pub struct CheckpointSummary {
    pub checkpoint_id: String,
    pub branch: String,
    pub commit_sha: String,
    pub commit_message: String,
    pub files_touched: Vec<String>,
    pub sessions: Vec<SessionSummary>,
    pub token_usage: Option<TokenUsage>,
    pub created_at: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct SessionSummary {
    pub session_id: String,
    pub agent: String,
    pub model: Option<String>,
    pub step_count: u32,
    pub summary: Option<SessionSummaryInfo>,
    pub token_usage: Option<TokenUsage>,
    pub initial_attribution: Option<Attribution>,
    pub prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionSummaryInfo {
    pub intent: String,
    pub outcome: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Attribution {
    pub agent_lines: u64,
    pub human_added: u64,
    pub human_modified: u64,
    pub total_committed: u64,
    pub agent_percentage: f64,
}

/// Raw metadata format from entire/checkpoints/v1 branch
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RawCheckpointMetadata {
    cli_version: Option<String>,
    checkpoint_id: Option<String>,
    branch: Option<String>,
    commit_sha: Option<String>,
    commit_message: Option<String>,
    created_at: Option<String>,
    files_touched: Option<Vec<String>>,
    sessions: Option<Vec<RawSessionRef>>,
    token_usage: Option<TokenUsage>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RawSessionRef {
    metadata: Option<String>,
    transcript: Option<String>,
    prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RawSessionMetadata {
    checkpoint_id: Option<String>,
    session_id: Option<String>,
    agent: Option<String>,
    model: Option<String>,
    branch: Option<String>,
    created_at: Option<String>,
    files_touched: Option<Vec<String>>,
    token_usage: Option<TokenUsage>,
    summary: Option<SessionSummaryInfo>,
    initial_attribution: Option<Attribution>,
}

/// List all checkpoints from the entire/checkpoints/v1 branch
pub fn list_checkpoints(
    repo: &Repository,
    filter_branch: &str,
) -> Result<Vec<CheckpointSummary>, String> {
    let branch_ref = match repo.find_branch("entire/checkpoints/v1", git2::BranchType::Local) {
        Ok(b) => b,
        Err(_) => return Ok(Vec::new()), // No checkpoints branch yet
    };

    let commit = branch_ref
        .get()
        .peel_to_commit()
        .map_err(|e| format!("Failed to get checkpoint commit: {}", e))?;

    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree: {}", e))?;

    let mut checkpoints = Vec::new();

    // Walk the sharded directory structure: <id[:2]>/<id[2:]>/metadata.json
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        let name = match entry.name() {
            Some(n) => n,
            None => return git2::TreeWalkResult::Ok,
        };

        // Look for metadata.json at the checkpoint level (e.g., "a1/b2c3d4/metadata.json")
        if name == "metadata.json" && !dir.is_empty() {
            // dir looks like "a1/b2c3d4/" — that's 2 levels deep
            let parts: Vec<&str> = dir.trim_end_matches('/').split('/').collect();
            if parts.len() == 2 {
                // This is a root checkpoint metadata.json
                if let Ok(blob) = repo.find_blob(entry.id()) {
                    if let Ok(content) = std::str::from_utf8(blob.content()) {
                        if let Ok(meta) = serde_json::from_str::<RawCheckpointMetadata>(content) {
                            let branch = meta.branch.clone().unwrap_or_default();
                            if filter_branch.is_empty() || branch == filter_branch {
                                let cp = build_checkpoint_summary(
                                    repo,
                                    &tree,
                                    dir,
                                    &meta,
                                );
                                if let Ok(cp) = cp {
                                    checkpoints.push(cp);
                                }
                            }
                        }
                    }
                }
            }
        }

        git2::TreeWalkResult::Ok
    })
    .map_err(|e| format!("Tree walk error: {}", e))?;

    // Sort by created_at descending
    checkpoints.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(checkpoints)
}

fn build_checkpoint_summary(
    repo: &Repository,
    tree: &git2::Tree,
    dir: &str,
    meta: &RawCheckpointMetadata,
) -> Result<CheckpointSummary, String> {
    let checkpoint_id = meta
        .checkpoint_id
        .clone()
        .unwrap_or_else(|| dir.replace('/', ""));

    let mut sessions = Vec::new();
    let mut earliest_created_at: Option<String> = None;
    // Read session metadata from subdirectories (0/, 1/, etc.)
    if let Some(refs) = &meta.sessions {
        for (i, session_ref) in refs.iter().enumerate() {
            let session_dir = format!("{}{}/", dir, i);
            let session_meta_path = format!("{}metadata.json", session_dir);

            // Try to read session metadata from the tree
            if let Ok(session_meta) = read_blob_from_tree(repo, tree, &session_meta_path) {
                if let Ok(sm) = serde_json::from_str::<RawSessionMetadata>(&session_meta) {
                    // Track earliest created_at across sessions
                    if let Some(ref ca) = sm.created_at {
                        if earliest_created_at.as_ref().map_or(true, |e| ca < e) {
                            earliest_created_at = Some(ca.clone());
                        }
                    }

                    // Defer transcript step counting — expensive, done on demand
                    let step_count = 0;

                    // Read the prompt file (small text) for display as title
                    let prompt = session_ref.prompt.as_deref().and_then(|p| {
                        let path = if p.starts_with('/') {
                            p.trim_start_matches('/').to_string()
                        } else {
                            format!("{}{}", session_dir, p)
                        };
                        read_blob_from_tree(repo, tree, &path).ok()
                    });

                    sessions.push(SessionSummary {
                        session_id: sm.session_id.unwrap_or_default(),
                        agent: sm.agent.unwrap_or_else(|| "Unknown".to_string()),
                        model: sm.model,
                        step_count,
                        summary: sm.summary,
                        token_usage: sm.token_usage,
                        initial_attribution: sm.initial_attribution,
                        prompt,
                    });
                }
            }
        }
    }

    // Use checkpoint metadata fields first, fall back to session-derived values
    let created_at = meta
        .created_at
        .clone()
        .or(earliest_created_at)
        .unwrap_or_default();

    let branch_name = meta.branch.clone().unwrap_or_default();

    // Use commit info from metadata directly — skip expensive revwalk/diff for listing
    let commit_sha = meta.commit_sha.clone().unwrap_or_default();
    let commit_message = meta.commit_message.clone().unwrap_or_default();

    // Defer diff stats — will be computed on demand when a checkpoint is selected
    let (additions, deletions) = (0, 0);

    Ok(CheckpointSummary {
        checkpoint_id,
        branch: branch_name,
        commit_sha,
        commit_message,
        files_touched: meta.files_touched.clone().unwrap_or_default(),
        sessions,
        token_usage: meta.token_usage.clone(),
        created_at,
        additions,
        deletions,
    })
}

/// Find the most recent commit on a branch at or before the given timestamp.
/// Returns (sha, message) or None if not found.
fn resolve_commit_from_branch(
    repo: &Repository,
    branch_name: &str,
    created_at: &str,
) -> Option<(String, String)> {
    if branch_name.is_empty() || created_at.is_empty() {
        return None;
    }

    let branch = repo.find_branch(branch_name, git2::BranchType::Local).ok()?;
    let branch_commit = branch.get().peel_to_commit().ok()?;

    // Parse the checkpoint created_at as a unix timestamp for comparison
    let checkpoint_ts = parse_iso_timestamp(created_at)?;

    // Walk commits from branch HEAD backward
    let mut revwalk = repo.revwalk().ok()?;
    revwalk.push(branch_commit.id()).ok()?;
    revwalk.set_sorting(git2::Sort::TIME).ok()?;

    for oid in revwalk {
        let oid = oid.ok()?;
        let commit = repo.find_commit(oid).ok()?;
        let commit_ts = commit.time().seconds();

        // Find the first commit whose time is at or before the checkpoint
        if commit_ts <= checkpoint_ts {
            let sha = oid.to_string();
            let message = commit
                .summary()
                .unwrap_or("")
                .to_string();
            return Some((sha, message));
        }
    }

    None
}

/// Parse an ISO 8601 timestamp string to unix seconds
fn parse_iso_timestamp(s: &str) -> Option<i64> {
    // Handle formats like "2026-03-16T21:10:30.808196Z" and "2026-03-16T21:10:30Z"
    let s = s.trim();
    // Strip fractional seconds and Z
    let s = s.trim_end_matches('Z');
    let s = if let Some(dot_pos) = s.rfind('.') {
        &s[..dot_pos]
    } else {
        s
    };

    // Parse "YYYY-MM-DDTHH:MM:SS"
    let parts: Vec<&str> = s.split('T').collect();
    if parts.len() != 2 {
        return None;
    }
    let date_parts: Vec<i64> = parts[0].split('-').filter_map(|p| p.parse().ok()).collect();
    let time_parts: Vec<i64> = parts[1].split(':').filter_map(|p| p.parse().ok()).collect();

    if date_parts.len() != 3 || time_parts.len() != 3 {
        return None;
    }

    let (year, month, day) = (date_parts[0], date_parts[1], date_parts[2]);
    let (hour, min, sec) = (time_parts[0], time_parts[1], time_parts[2]);

    // Simple days-since-epoch calculation (good enough for comparison)
    let mut days: i64 = 0;
    for y in 1970..year {
        days += if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
    }
    let month_days = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    for m in 1..month {
        days += month_days[m as usize];
        if m == 2 && is_leap {
            days += 1;
        }
    }
    days += day - 1;

    Some(days * 86400 + hour * 3600 + min * 60 + sec)
}

/// Compute additions and deletions for a commit by diffing against its parent.
pub fn compute_diff_stats(repo: &Repository, commit_sha: &str) -> (u32, u32) {
    let oid = match git2::Oid::from_str(commit_sha) {
        Ok(o) => o,
        Err(_) => return (0, 0),
    };
    let commit = match repo.find_commit(oid) {
        Ok(c) => c,
        Err(_) => return (0, 0),
    };
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return (0, 0),
    };
    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    let diff = match repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None) {
        Ok(d) => d,
        Err(_) => return (0, 0),
    };
    let stats = match diff.stats() {
        Ok(s) => s,
        Err(_) => return (0, 0),
    };
    (stats.insertions() as u32, stats.deletions() as u32)
}

fn count_transcript_steps(
    repo: &Repository,
    tree: &git2::Tree,
    session_ref: &RawSessionRef,
    session_dir: &str,
) -> u32 {
    // Try to read the transcript file and count assistant messages (steps)
    // Paths from metadata may be absolute (leading /) — use as-is, stripping the /
    let transcript_path = session_ref
        .transcript
        .as_deref()
        .map(|t| {
            if t.starts_with('/') {
                t.trim_start_matches('/').to_string()
            } else {
                format!("{}{}", session_dir, t)
            }
        })
        .unwrap_or_else(|| format!("{}full.jsonl", session_dir));

    if let Ok(content) = read_blob_from_tree(repo, tree, &transcript_path) {
        session::read_transcript(&content)
            .into_iter()
            .filter(|message| message.role == "assistant")
            .count() as u32
    } else {
        0
    }
}

fn read_blob_from_tree(repo: &Repository, tree: &git2::Tree, path: &str) -> Result<String, String> {
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
