use super::{
    delta_dir, get_delta_dag, get_task_states, update_delta_status,
    DeltaEvent, DeltaStatus, TaskDAG, TaskState, TaskStatus,
};
use std::collections::HashMap;
use std::fs;

/// Evaluate the DAG: find tasks whose dependencies are all done,
/// transition them from Blocked → Ready.
pub fn evaluate_dag(delta_id: &str) -> Result<Vec<String>, String> {
    let dag = get_delta_dag(delta_id)?
        .ok_or_else(|| "No DAG found".to_string())?;
    let states = get_task_states(delta_id)?;
    let state_map: HashMap<String, TaskStatus> = states
        .iter()
        .map(|s| (s.id.clone(), s.status.clone()))
        .collect();

    let done_ids: std::collections::HashSet<String> = states
        .iter()
        .filter(|s| matches!(s.status, TaskStatus::Done))
        .map(|s| s.id.clone())
        .collect();

    let mut newly_ready = Vec::new();

    for task_def in &dag.tasks {
        let current_status = state_map
            .get(&task_def.id)
            .cloned()
            .unwrap_or(TaskStatus::Blocked);
        if !matches!(current_status, TaskStatus::Blocked) {
            continue;
        }
        if task_def.depends_on.iter().all(|dep| done_ids.contains(dep)) {
            update_task_status(delta_id, &task_def.id, TaskStatus::Ready)?;
            newly_ready.push(task_def.id.clone());
        }
    }

    Ok(newly_ready)
}

/// Initialize task state files for all tasks in the DAG.
pub fn initialize_tasks(delta_id: &str) -> Result<(), String> {
    let dag = get_delta_dag(delta_id)?
        .ok_or_else(|| "No DAG found".to_string())?;

    for task_def in &dag.tasks {
        let initial_status = if task_def.depends_on.is_empty() {
            TaskStatus::Ready
        } else {
            TaskStatus::Blocked
        };

        let state = TaskState {
            id: task_def.id.clone(),
            status: initial_status,
            agent: task_def.agent.clone(),
            pty_session_id: None,
            worktree_path: None,
            worktree_branch: None,
            base_branch: None,
            started_at: None,
            completed_at: None,
            gate_results: Vec::new(),
            summary: None,
            retry_count: 0,
        };

        write_task_state(delta_id, &state)?;
    }

    Ok(())
}

/// Check if all tasks in the DAG are done.
pub fn all_tasks_done(delta_id: &str) -> Result<bool, String> {
    let states = get_task_states(delta_id)?;
    let dag = get_delta_dag(delta_id)?
        .ok_or_else(|| "No DAG found".to_string())?;
    Ok(dag.tasks.len() == states.iter().filter(|s| matches!(s.status, TaskStatus::Done)).count())
}

/// Topological sort of tasks.
pub fn topological_order(dag: &TaskDAG) -> Result<Vec<String>, String> {
    let mut visited = std::collections::HashSet::new();
    let mut result = Vec::new();
    let task_map: HashMap<&str, &super::TaskDef> = dag
        .tasks
        .iter()
        .map(|t| (t.id.as_str(), t))
        .collect();

    fn visit<'a>(
        id: &'a str,
        task_map: &HashMap<&str, &super::TaskDef>,
        visited: &mut std::collections::HashSet<String>,
        result: &mut Vec<String>,
    ) {
        if visited.contains(id) {
            return;
        }
        visited.insert(id.to_string());
        if let Some(task) = task_map.get(id) {
            for dep in &task.depends_on {
                visit(dep, task_map, visited, result);
            }
        }
        result.push(id.to_string());
    }

    for task in &dag.tasks {
        visit(&task.id, &task_map, &mut visited, &mut result);
    }
    Ok(result)
}

/// Answer a blocking question.
pub fn answer_question(
    delta_id: &str,
    question_id: &str,
    answer: &str,
    task_id: &str,
    pty_session_id: Option<&str>,
    pty_state: &std::sync::Mutex<crate::pty::PtyState>,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let event = DeltaEvent::QuestionAnswered {
        delta_id: delta_id.to_string(),
        task_id: task_id.to_string(),
        question_id: question_id.to_string(),
        answer: answer.to_string(),
        timestamp: now,
    };
    write_system_event(delta_id, &event)?;

    if let Some(sid) = pty_session_id {
        let message = format!(
            "\n--- ORCHESTRATOR MESSAGE ---\n[Question Answered] {}\nAnswer: {}\n--- END MESSAGE ---\n",
            question_id, answer
        );
        crate::pty::write_to_session(pty_state, sid, message.as_bytes())?;
    }

    update_task_status(delta_id, task_id, TaskStatus::Running)?;
    Ok(())
}

/// Cancel a running delta.
pub fn cancel_delta(
    delta_id: &str,
    pty_state: &std::sync::Mutex<crate::pty::PtyState>,
) -> Result<(), String> {
    let states = get_task_states(delta_id)?;
    for state in &states {
        if !matches!(state.status, TaskStatus::Done) {
            update_task_status(delta_id, &state.id, TaskStatus::Done)?;
        }
        if let Some(ref sid) = state.pty_session_id {
            crate::pty::kill_session(pty_state, sid);
        }
    }
    update_delta_status(delta_id, DeltaStatus::Cancelled)?;
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────

pub fn update_task_status(delta_id: &str, task_id: &str, status: TaskStatus) -> Result<(), String> {
    let path = delta_dir(delta_id).join("tasks").join(format!("{}.json", task_id));
    let mut state: TaskState = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err(format!("Task state not found: {}", task_id));
    };

    state.status = status;
    write_task_state(delta_id, &state)
}

pub fn write_task_state(delta_id: &str, state: &TaskState) -> Result<(), String> {
    let path = delta_dir(delta_id)
        .join("tasks")
        .join(format!("{}.json", state.id));
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn write_system_event(delta_id: &str, event: &DeltaEvent) -> Result<(), String> {
    let dir = delta_dir(delta_id).join("events");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let event_type = match event {
        DeltaEvent::TaskState { .. } => "task_state",
        DeltaEvent::GateResult { .. } => "gate_result",
        DeltaEvent::QuestionAnswered { .. } => "question_answered",
        _ => "system",
    };
    let filename = format!("{}-system-{}.json", ts, event_type);
    let json = serde_json::to_string_pretty(event).map_err(|e| e.to_string())?;
    fs::write(dir.join(filename), json).map_err(|e| e.to_string())
}
