use serde::{Deserialize, Serialize};

use crate::{DiffLine, FileDiff};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SemanticReviewAnnotation {
    pub file_path: String,
    pub line_key: String,
    pub line_kind: String,
    pub line_number: u32,
    pub line_content: String,
    pub summary: String,
    pub rationale: Option<String>,
    pub importance: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunCheckpointSemanticReviewResponse {
    pub review_run_id: String,
    pub annotations: Vec<SemanticReviewAnnotation>,
}

#[derive(Debug, Clone)]
pub struct PromptTranscriptMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct PromptTranscriptSession {
    pub session_index: u32,
    pub messages: Vec<PromptTranscriptMessage>,
}

#[derive(Debug, Deserialize)]
struct SemanticReviewEnvelope {
    annotations: Vec<SemanticReviewDraftAnnotation>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SemanticReviewDraftAnnotation {
    file_path: String,
    line_number: u32,
    line_kind: String,
    summary: String,
    rationale: Option<String>,
    importance: Option<String>,
}

pub(crate) fn build_prompt(
    files: &[FileDiff],
    sessions: &[PromptTranscriptSession],
) -> String {
    let mut lines = vec![
        "Review this checkpoint diff semantically.".to_string(),
        "Explain only the important changes, grounded in the diff and transcript context.".to_string(),
        "Comment on lines where the change meaningfully affects behavior, architecture, risk, or reveals non-obvious intent.".to_string(),
        "Skip formatting-only edits, repetitive low-signal edits, and trivial rename churn.".to_string(),
        "Return JSON only with this shape:".to_string(),
        "{\"annotations\":[{\"file_path\":\"src/file.ts\",\"line_number\":12,\"line_kind\":\"add\",\"summary\":\"What this change means.\",\"rationale\":\"Why it was done, especially if transcript context explains it.\",\"importance\":\"high\"}]}".to_string(),
        "Use only line numbers and file paths that exist in the diff below.".to_string(),
        String::new(),
        "## Sanitized checkpoint transcripts".to_string(),
    ];

    if sessions.is_empty() {
        lines.push("(no transcript context available)".to_string());
    } else {
        for session in sessions {
            lines.push(format!("### Session {}", session.session_index));
            for message in &session.messages {
                lines.push(format!("{}: {}", message.role, message.content));
            }
            lines.push(String::new());
        }
    }

    lines.push("## Diff".to_string());
    for file in files {
        lines.push(format!("### {} ({})", file.path, file.status));
        for hunk in &file.hunks {
            lines.push(hunk.header.trim().to_string());
            for line in &hunk.lines {
                let line_number = diff_line_number(line);
                lines.push(format!(
                    "L{} {} {}",
                    line_number,
                    diff_line_prefix(&line.kind),
                    line.content.trim_end()
                ));
            }
        }
        lines.push(String::new());
    }

    lines.join("\n")
}

pub(crate) fn parse_response_text(
    text: &str,
) -> Result<Vec<SemanticReviewDraftAnnotation>, String> {
    let payload = strip_code_fence(text).trim();
    if payload.is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<SemanticReviewEnvelope>(payload)
        .map(|envelope| envelope.annotations)
        .map_err(|err| format!("Failed to parse semantic review JSON: {}", err))
}

pub(crate) fn resolve_annotations(
    files: &[FileDiff],
    annotations: Vec<SemanticReviewDraftAnnotation>,
) -> Vec<SemanticReviewAnnotation> {
    let mut resolved = Vec::new();

    for annotation in annotations {
        let normalized_kind = normalize_line_kind(&annotation.line_kind);
        if normalized_kind.is_empty() {
            continue;
        }

        let Some((line_key, line_content)) = find_line(files, &annotation.file_path, annotation.line_number, &normalized_kind) else {
            continue;
        };

        let summary = annotation.summary.trim();
        if summary.is_empty() {
            continue;
        }

        let rationale = annotation
            .rationale
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let importance = annotation
            .importance
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty());

        resolved.push(SemanticReviewAnnotation {
            file_path: annotation.file_path,
            line_key,
            line_kind: normalized_kind,
            line_number: annotation.line_number,
            line_content,
            summary: summary.to_string(),
            rationale,
            importance,
        });
    }

    resolved
}

fn find_line(
    files: &[FileDiff],
    file_path: &str,
    line_number: u32,
    line_kind: &str,
) -> Option<(String, String)> {
    let file = files.iter().find(|file| file.path == file_path)?;
    for hunk in &file.hunks {
        for line in &hunk.lines {
            if line.kind == line_kind && diff_line_number(line) == line_number {
                return Some((make_line_key(file_path, line), line.content.clone()));
            }
        }
    }
    None
}

fn make_line_key(file_path: &str, line: &DiffLine) -> String {
    format!(
        "{}:{}:{}",
        file_path,
        line.old_lineno.map(|value| value.to_string()).unwrap_or_default(),
        line.new_lineno.map(|value| value.to_string()).unwrap_or_default()
    )
}

fn diff_line_number(line: &DiffLine) -> u32 {
    if line.kind == "delete" {
        line.old_lineno.unwrap_or(0)
    } else {
        line.new_lineno.or(line.old_lineno).unwrap_or(0)
    }
}

fn diff_line_prefix(kind: &str) -> &'static str {
    match kind {
        "add" => "+",
        "delete" => "-",
        _ => " ",
    }
}

fn normalize_line_kind(kind: &str) -> String {
    match kind.trim().to_lowercase().as_str() {
        "add" | "addition" => "add".to_string(),
        "delete" | "deletion" | "remove" | "removed" => "delete".to_string(),
        "context" => "context".to_string(),
        _ => String::new(),
    }
}

fn strip_code_fence(text: &str) -> &str {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed;
    }

    let without_opening = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim();
    without_opening.strip_suffix("```").unwrap_or(without_opening).trim()
}

#[cfg(test)]
mod tests {
    use super::{parse_response_text, resolve_annotations, SemanticReviewDraftAnnotation};
    use crate::{DiffHunk, DiffLine, FileDiff};

    #[test]
    fn resolves_annotations_to_existing_diff_lines() {
        let files = vec![FileDiff {
            path: "src/cache.ts".to_string(),
            status: "modified".to_string(),
            hunks: vec![DiffHunk {
                header: "@@ -10,1 +12,1 @@".to_string(),
                lines: vec![DiffLine {
                    kind: "add".to_string(),
                    content: "cache.set(key, value);\n".to_string(),
                    old_lineno: None,
                    new_lineno: Some(12),
                }],
            }],
        }];

        let annotations = resolve_annotations(
            &files,
            vec![SemanticReviewDraftAnnotation {
                file_path: "src/cache.ts".to_string(),
                line_number: 12,
                line_kind: "addition".to_string(),
                summary: "Adds a cache write.".to_string(),
                rationale: Some("The transcript says this avoids duplicate fetches.".to_string()),
                importance: Some("high".to_string()),
            }],
        );

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].line_key, "src/cache.ts::12");
        assert_eq!(annotations[0].line_kind, "add");
    }

    #[test]
    fn drops_annotations_that_do_not_match_diff_lines() {
        let annotations = resolve_annotations(&[], vec![SemanticReviewDraftAnnotation {
            file_path: "missing.ts".to_string(),
            line_number: 1,
            line_kind: "add".to_string(),
            summary: "Ignored.".to_string(),
            rationale: None,
            importance: None,
        }]);

        assert!(annotations.is_empty());
    }

    #[test]
    fn parses_json_wrapped_in_code_fence() {
        let parsed = parse_response_text(
            "```json\n{\"annotations\":[{\"file_path\":\"src/a.ts\",\"line_number\":1,\"line_kind\":\"add\",\"summary\":\"Meaningful change.\"}]}\n```",
        )
        .expect("should parse fenced JSON");

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].file_path, "src/a.ts");
    }
}
