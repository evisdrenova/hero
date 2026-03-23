use super::{
    delta_dir, get_delta_plan, update_delta_status,
    DeltaStatus, TaskDAG,
};
use std::collections::{HashMap, HashSet};
use std::fs;

/// Extract DAG JSON from plan.md by finding the last ```dag fenced block.
pub fn extract_dag_from_plan(plan_content: &str) -> Result<TaskDAG, String> {
    let dag_json = find_last_fenced_block(plan_content, "dag")
        .or_else(|| find_last_fenced_block(plan_content, "json"))
        .ok_or_else(|| {
            "No ```dag or ```json block found in plan. Ask the planning agent to output the task DAG as a fenced code block.".to_string()
        })?;

    let dag: TaskDAG = serde_json::from_str(&dag_json)
        .map_err(|e| format!("Failed to parse DAG JSON: {e}"))?;

    validate_dag(&dag)?;
    Ok(dag)
}

/// Approve the plan: extract DAG, write dag.json, transition to executing.
pub fn approve_plan(delta_id: &str) -> Result<TaskDAG, String> {
    let plan = get_delta_plan(delta_id)?;
    let dag = extract_dag_from_plan(&plan)?;

    let dag_json = serde_json::to_string_pretty(&dag).map_err(|e| e.to_string())?;
    fs::write(delta_dir(delta_id).join("dag.json"), dag_json).map_err(|e| e.to_string())?;

    update_delta_status(delta_id, DeltaStatus::Executing)?;
    Ok(dag)
}

fn validate_dag(dag: &TaskDAG) -> Result<(), String> {
    if dag.tasks.is_empty() {
        return Err("DAG has no tasks".to_string());
    }

    let task_ids: HashSet<&str> = dag.tasks.iter().map(|t| t.id.as_str()).collect();

    for task in &dag.tasks {
        for dep in &task.depends_on {
            if !task_ids.contains(dep.as_str()) {
                return Err(format!(
                    "Task '{}' depends on '{}' which doesn't exist",
                    task.id, dep
                ));
            }
        }
    }

    if has_cycle(dag) {
        return Err("DAG contains a cycle".to_string());
    }

    Ok(())
}

fn has_cycle(dag: &TaskDAG) -> bool {
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    let task_map: HashMap<&str, &super::TaskDef> =
        dag.tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    fn dfs<'a>(
        id: &'a str,
        task_map: &HashMap<&str, &super::TaskDef>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> bool {
        if visiting.contains(id) {
            return true;
        }
        if visited.contains(id) {
            return false;
        }
        visiting.insert(id.to_string());
        if let Some(task) = task_map.get(id) {
            for dep in &task.depends_on {
                if dfs(dep, task_map, visiting, visited) {
                    return true;
                }
            }
        }
        visiting.remove(id);
        visited.insert(id.to_string());
        false
    }

    dag.tasks.iter().any(|t| dfs(&t.id, &task_map, &mut visiting, &mut visited))
}

fn find_last_fenced_block(content: &str, tag: &str) -> Option<String> {
    let open = format!("```{}", tag);
    let close = "```";
    let mut last_block = None;

    let mut search_from = 0;
    while let Some(start) = content[search_from..].find(&open) {
        let abs_start = search_from + start + open.len();
        let block_start = content[abs_start..]
            .find('\n')
            .map(|i| abs_start + i + 1)
            .unwrap_or(abs_start);
        if let Some(end) = content[block_start..].find(close) {
            let block = content[block_start..block_start + end].trim().to_string();
            last_block = Some(block);
            search_from = block_start + end + close.len();
        } else {
            break;
        }
    }

    last_block
}
