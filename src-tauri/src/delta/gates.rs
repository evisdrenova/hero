use super::{GateDef, GateResultEntry};
use std::process::Command;

const GATE_TIMEOUT_SECS: u64 = 120;

/// Run a single gate in the given working directory.
pub fn run_gate(gate: &GateDef, gate_index: usize, worktree_path: &str) -> GateResultEntry {
    match gate {
        GateDef::Command { run, expect } => run_command_gate(gate_index, run, expect, worktree_path),
        GateDef::FileExists { path } => run_file_exists_gate(gate_index, path, worktree_path),
        GateDef::AgentReview { prompt: _ } => {
            GateResultEntry {
                gate_index,
                gate_type: "agent_review".to_string(),
                passed: true,
                output: "Agent review not yet implemented — auto-passing".to_string(),
            }
        }
    }
}

/// Run all gates for a task sequentially. Returns on first failure or all pass.
pub fn run_all_gates(gates: &[GateDef], worktree_path: &str) -> Vec<GateResultEntry> {
    let mut results = Vec::new();
    for (idx, gate) in gates.iter().enumerate() {
        let result = run_gate(gate, idx, worktree_path);
        let passed = result.passed;
        results.push(result);
        if !passed {
            break;
        }
    }
    results
}

fn run_command_gate(
    gate_index: usize,
    run_cmd: &str,
    expect: &str,
    worktree_path: &str,
) -> GateResultEntry {
    let result = Command::new("sh")
        .arg("-c")
        .arg(format!("timeout {} {}", GATE_TIMEOUT_SECS, run_cmd))
        .current_dir(worktree_path)
        .output();

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}{}", stdout, stderr);

            let passed = match expect {
                "exit_0" => output.status.success(),
                other => combined.contains(other),
            };

            GateResultEntry {
                gate_index,
                gate_type: "command".to_string(),
                passed,
                output: if combined.len() > 2000 {
                    format!("{}...(truncated)", &combined[..2000])
                } else {
                    combined.to_string()
                },
            }
        }
        Err(e) => GateResultEntry {
            gate_index,
            gate_type: "command".to_string(),
            passed: false,
            output: format!("Failed to execute: {e}"),
        },
    }
}

fn run_file_exists_gate(
    gate_index: usize,
    path: &str,
    worktree_path: &str,
) -> GateResultEntry {
    let full_path = std::path::Path::new(worktree_path).join(path);
    let exists = full_path.exists();
    GateResultEntry {
        gate_index,
        gate_type: "file_exists".to_string(),
        passed: exists,
        output: if exists {
            format!("{} exists", path)
        } else {
            format!("{} not found", path)
        },
    }
}
