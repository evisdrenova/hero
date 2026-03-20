use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionState {
    pub session_id: Option<String>,
    pub base_commit: Option<String>,
    pub phase: Option<String>,
    pub agent_type: Option<String>,
    pub model_name: Option<String>,
    pub step_count: Option<u32>,
    pub files_touched: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TranscriptMessage {
    pub role: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub timestamp: Option<String>,
}

pub fn sanitize_transcript_for_semantic_review(
    messages: &[TranscriptMessage],
    max_chars: usize,
) -> Vec<TranscriptMessage> {
    let sanitized: Vec<TranscriptMessage> = messages
        .iter()
        .filter_map(|message| match message.role.as_str() {
            "user" | "assistant" if message.tool_name.is_none() => {
                let content = message.content.trim();
                if content.is_empty() {
                    None
                } else {
                    Some(TranscriptMessage {
                        role: message.role.clone(),
                        content: content.to_string(),
                        tool_name: None,
                        tool_input: None,
                        timestamp: message.timestamp.clone(),
                    })
                }
            }
            "assistant" => message.tool_name.as_ref().map(|tool_name| TranscriptMessage {
                role: "assistant".to_string(),
                content: format!("used tool {}.", tool_name),
                tool_name: None,
                tool_input: None,
                timestamp: message.timestamp.clone(),
            }),
            _ => None,
        })
        .collect();

    if max_chars == 0 {
        return Vec::new();
    }

    let mut kept = Vec::new();
    let mut used = 0usize;

    for message in sanitized.into_iter().rev() {
        let len = message.content.chars().count();
        if kept.is_empty() && len > max_chars {
            kept.push(TranscriptMessage {
                content: truncate_for_budget(&message.content, max_chars),
                ..message
            });
            break;
        }

        if used + len > max_chars {
            continue;
        }

        used += len;
        kept.push(message);
    }

    kept.reverse();
    kept
}

fn truncate_for_budget(content: &str, max_chars: usize) -> String {
    let chars: Vec<char> = content.chars().collect();
    if chars.len() <= max_chars {
        return content.to_string();
    }

    chars[..max_chars].iter().collect()
}

/// Find the git common dir (handles worktrees)
pub fn git_common_dir(repo_path: &str) -> PathBuf {
    let git_dir = Path::new(repo_path).join(".git");
    if git_dir.is_file() {
        // Worktree: .git is a file containing "gitdir: /path/to/worktree/git"
        if let Ok(content) = fs::read_to_string(&git_dir) {
            if let Some(gitdir) = content.strip_prefix("gitdir: ") {
                let gitdir = gitdir.trim();
                let gitdir_path = if Path::new(gitdir).is_absolute() {
                    PathBuf::from(gitdir)
                } else {
                    Path::new(repo_path).join(gitdir)
                };
                // commondir file tells us where the shared git dir is
                let commondir_file = gitdir_path.join("commondir");
                if let Ok(commondir) = fs::read_to_string(&commondir_file) {
                    let commondir = commondir.trim();
                    if Path::new(commondir).is_absolute() {
                        return PathBuf::from(commondir);
                    } else {
                        return gitdir_path.join(commondir);
                    }
                }
                return gitdir_path;
            }
        }
    }
    git_dir
}

/// List active sessions from .git/entire-sessions/
pub fn list_active_sessions(repo_path: &str) -> Result<Vec<SessionState>, String> {
    let sessions_dir = git_common_dir(repo_path).join("entire-sessions");
    if !sessions_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    let entries =
        fs::read_dir(&sessions_dir).map_err(|e| format!("Failed to read sessions dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(state) = serde_json::from_str::<SessionState>(&content) {
                    sessions.push(state);
                }
            }
        }
    }

    Ok(sessions)
}

/// Read transcript from checkpoint data (Claude Code JSONL format)
///
/// Each line is a JSON envelope with a `type` field:
///   - "user"      → message in `.message.content` (string or content blocks)
///   - "assistant"  → message in `.message.content` (array of text/tool_use blocks)
///   - "tool_result"→ tool output in `.content`
///   - "progress", "system", "file-history-snapshot", "last-prompt" → skip
pub fn read_transcript(content: &str) -> Vec<TranscriptMessage> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(messages) = read_kiro_transcript(&value) {
            return messages;
        }
    }

    let mut messages = Vec::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let timestamp = value.get("timestamp").and_then(|t| t.as_str()).map(|s| s.to_string());

        match line_type {
            "user" => {
                let msg = match value.get("message") {
                    Some(m) => m,
                    None => continue,
                };
                let text = extract_message_content(msg);
                if !text.is_empty() {
                    messages.push(TranscriptMessage {
                        role: "user".to_string(),
                        content: text,
                        tool_name: None,
                        tool_input: None,
                        timestamp,
                    });
                }
            }
            "assistant" => {
                let msg = match value.get("message") {
                    Some(m) => m,
                    None => continue,
                };
                // Assistant content is an array of content blocks
                if let Some(blocks) = msg.get("content").and_then(|c| c.as_array()) {
                    for block in blocks {
                        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match block_type {
                            "text" => {
                                let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("");
                                if !text.is_empty() {
                                    messages.push(TranscriptMessage {
                                        role: "assistant".to_string(),
                                        content: text.to_string(),
                                        tool_name: None,
                                        tool_input: None,
                                        timestamp: timestamp.clone(),
                                    });
                                }
                            }
                            "tool_use" => {
                                let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                                let input = block.get("input").map(|v| {
                                    serde_json::to_string_pretty(v).unwrap_or_default()
                                });
                                messages.push(TranscriptMessage {
                                    role: "assistant".to_string(),
                                    content: String::new(),
                                    tool_name: Some(name.to_string()),
                                    tool_input: input,
                                    timestamp: timestamp.clone(),
                                });
                            }
                            _ => {}
                        }
                    }
                }
            }
            "tool_result" => {
                // Tool results can have content at the top level
                let text = value
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                let tool_name = value
                    .get("tool_name")
                    .or_else(|| value.get("name"))
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string());
                if !text.is_empty() || tool_name.is_some() {
                    messages.push(TranscriptMessage {
                        role: "tool".to_string(),
                        content: text,
                        tool_name,
                        tool_input: None,
                        timestamp,
                    });
                }
            }
            _ => {
                // Skip progress, system, file-history-snapshot, last-prompt, etc.
            }
        }
    }

    messages
}

fn read_kiro_transcript(value: &serde_json::Value) -> Option<Vec<TranscriptMessage>> {
    let history = value.get("history")?.as_array()?;
    let mut messages = Vec::new();

    for entry in history {
        if let Some(user) = entry.get("user") {
            let timestamp = user
                .get("timestamp")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());

            if let Some(prompt) = user
                .get("content")
                .and_then(|c| c.get("Prompt"))
                .and_then(|p| p.get("prompt"))
                .and_then(|p| p.as_str())
            {
                messages.push(TranscriptMessage {
                    role: "user".to_string(),
                    content: prompt.to_string(),
                    tool_name: None,
                    tool_input: None,
                    timestamp,
                });
            } else if let Some(tool_results) = user
                .get("content")
                .and_then(|c| c.get("ToolUseResults"))
                .and_then(|r| r.get("tool_use_results"))
                .and_then(|r| r.as_array())
            {
                for result in tool_results {
                    let text = result
                        .get("content")
                        .and_then(|c| c.as_array())
                        .map(|parts| {
                            parts
                                .iter()
                                .filter_map(|part| part.get("Text").and_then(|t| t.as_str()))
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_default();

                    if !text.is_empty() {
                        messages.push(TranscriptMessage {
                            role: "tool".to_string(),
                            content: text,
                            tool_name: None,
                            tool_input: None,
                            timestamp: timestamp.clone(),
                        });
                    }
                }
            }
        }

        if let Some(assistant) = entry.get("assistant") {
            if let Some(tool_use) = assistant.get("ToolUse") {
                let timestamp = entry
                    .get("user")
                    .and_then(|user| user.get("timestamp"))
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());

                let content = tool_use
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                let tool_uses = tool_use
                    .get("tool_uses")
                    .and_then(|t| t.as_array())
                    .cloned()
                    .unwrap_or_default();

                if tool_uses.is_empty() && !content.is_empty() {
                    messages.push(TranscriptMessage {
                        role: "assistant".to_string(),
                        content,
                        tool_name: None,
                        tool_input: None,
                        timestamp,
                    });
                } else {
                    for tool in tool_uses {
                        let tool_name = tool
                            .get("name")
                            .or_else(|| tool.get("orig_name"))
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string());
                        let tool_input = tool
                            .get("args")
                            .or_else(|| tool.get("orig_args"))
                            .map(|args| serde_json::to_string_pretty(args).unwrap_or_default());

                        messages.push(TranscriptMessage {
                            role: "assistant".to_string(),
                            content: content.clone(),
                            tool_name,
                            tool_input,
                            timestamp: timestamp.clone(),
                        });
                    }
                }
            } else if let Some(response) = assistant.get("Response") {
                let content = response
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                if !content.is_empty() {
                    messages.push(TranscriptMessage {
                        role: "assistant".to_string(),
                        content,
                        tool_name: None,
                        tool_input: None,
                        timestamp: None,
                    });
                }
            }
        }
    }

    Some(messages)
}

/// Extract text content from a message object (handles both string and content blocks)
fn extract_message_content(msg: &serde_json::Value) -> String {
    if let Some(content) = msg.get("content") {
        if let Some(text) = content.as_str() {
            return text.to_string();
        }
        if let Some(arr) = content.as_array() {
            let mut parts = Vec::new();
            for item in arr {
                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                    parts.push(text.to_string());
                }
            }
            return parts.join("\n");
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::{read_transcript, sanitize_transcript_for_semantic_review, TranscriptMessage};

    #[test]
    fn read_transcript_parses_kiro_history_format() {
        let content = r#"{"history":[{"user":{"content":{"Prompt":{"prompt":"create hello world golang"}},"timestamp":"2026-03-18T00:30:32.802939-07:00"},"assistant":{"ToolUse":{"message_id":"abc","content":"","tool_uses":[{"name":"fs_write","args":{"command":"create","path":"/tmp/main.go"}}]}}},{"user":{"content":{"ToolUseResults":{"tool_use_results":[{"content":[{"Text":"write ok"}],"status":"Success"}]}},"timestamp":null},"assistant":{"Response":{"message_id":"def","content":"Created `main.go`."}}}]}"#;

        let messages = read_transcript(content);

        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "create hello world golang");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].tool_name.as_deref(), Some("fs_write"));
        assert!(messages[1]
            .tool_input
            .as_deref()
            .unwrap_or_default()
            .contains("\"path\": \"/tmp/main.go\""));
        assert_eq!(messages[2].role, "tool");
        assert_eq!(messages[2].content, "write ok");
        assert_eq!(messages[3].role, "assistant");
        assert_eq!(messages[3].content, "Created `main.go`.");
    }

    #[test]
    fn semantic_review_sanitizer_keeps_user_and_assistant_text() {
        let messages = vec![
            TranscriptMessage {
                role: "user".to_string(),
                content: "Please add caching to reduce duplicate API calls.".to_string(),
                tool_name: None,
                tool_input: None,
                timestamp: None,
            },
            TranscriptMessage {
                role: "assistant".to_string(),
                content: "I am adding a small cache in the fetch layer to avoid repeated requests."
                    .to_string(),
                tool_name: None,
                tool_input: None,
                timestamp: None,
            },
        ];

        let sanitized = sanitize_transcript_for_semantic_review(&messages, 2_000);

        assert_eq!(sanitized.len(), 2);
        assert_eq!(sanitized[0].role, "user");
        assert!(sanitized[0]
            .content
            .contains("Please add caching to reduce duplicate API calls."));
        assert_eq!(sanitized[1].role, "assistant");
        assert!(sanitized[1]
            .content
            .contains("adding a small cache in the fetch layer"));
    }

    #[test]
    fn semantic_review_sanitizer_summarizes_tool_use_and_drops_tool_output() {
        let messages = vec![
            TranscriptMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_name: Some("exec_command".to_string()),
                tool_input: Some("{\"cmd\":\"rg cache src\"}".to_string()),
                timestamp: None,
            },
            TranscriptMessage {
                role: "tool".to_string(),
                content: "very long terminal output".repeat(20),
                tool_name: Some("exec_command".to_string()),
                tool_input: None,
                timestamp: None,
            },
            TranscriptMessage {
                role: "assistant".to_string(),
                content: "The existing fetcher already deduplicates requests, so I only need to cache failures."
                    .to_string(),
                tool_name: None,
                tool_input: None,
                timestamp: None,
            },
        ];

        let sanitized = sanitize_transcript_for_semantic_review(&messages, 2_000);

        assert_eq!(sanitized.len(), 2);
        assert_eq!(sanitized[0].role, "assistant");
        assert!(sanitized[0].content.contains("used tool exec_command"));
        assert!(!sanitized[0].content.contains("rg cache src"));
        assert_eq!(sanitized[1].role, "assistant");
        assert!(sanitized[1]
            .content
            .contains("existing fetcher already deduplicates requests"));
    }

    #[test]
    fn semantic_review_sanitizer_truncates_low_signal_context_to_fit_budget() {
        let messages = vec![
            TranscriptMessage {
                role: "assistant".to_string(),
                content: "a".repeat(500),
                tool_name: None,
                tool_input: None,
                timestamp: None,
            },
            TranscriptMessage {
                role: "assistant".to_string(),
                content: "Important conclusion: keep the retry guard because the API can return duplicate jobs."
                    .to_string(),
                tool_name: None,
                tool_input: None,
                timestamp: None,
            },
        ];

        let sanitized = sanitize_transcript_for_semantic_review(&messages, 120);

        assert_eq!(sanitized.len(), 1);
        assert!(sanitized[0]
            .content
            .contains("Important conclusion: keep the retry guard"));
    }
}
