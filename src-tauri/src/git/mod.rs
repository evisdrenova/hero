use git2::Repository;
use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateWorktreeMode {
    Existing,
    New,
}

#[derive(Debug, Serialize, Clone)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub branches: Vec<BranchInfo>,
    pub worktrees: Vec<WorktreeInfo>,
    pub registered: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub checkpoint_count: u32,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
}

pub fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::open(path).map_err(|e| format!("Failed to open repo: {}", e))
}

pub fn list_branches(repo: &Repository) -> Result<Vec<BranchInfo>, String> {
    let mut branches = Vec::new();
    let head = repo.head().ok();
    let head_name = head
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    // Get the HEAD branch's commit tree for diffing
    let head_tree = head
        .as_ref()
        .and_then(|h| h.peel_to_commit().ok())
        .and_then(|c| c.tree().ok());

    let git_branches = repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| format!("Failed to list branches: {}", e))?;

    for branch_result in git_branches {
        let (branch, _) = branch_result.map_err(|e| format!("Branch error: {}", e))?;
        if let Some(name) = branch.name().ok().flatten() {
            // Skip entire/ internal branches
            if name.starts_with("entire/") {
                continue;
            }
            let is_head = head_name.as_deref() == Some(name);
            let (additions, deletions) = if is_head {
                (0, 0)
            } else {
                compute_branch_diff_stats(repo, &branch, head_tree.as_ref())
            };
            branches.push(BranchInfo {
                is_head,
                name: name.to_string(),
                checkpoint_count: 0, // TODO: count from checkpoint branch
                additions,
                deletions,
            });
        }
    }

    Ok(branches)
}

fn compute_branch_diff_stats(
    repo: &Repository,
    branch: &git2::Branch,
    head_tree: Option<&git2::Tree>,
) -> (u32, u32) {
    let head_tree = match head_tree {
        Some(t) => t,
        None => return (0, 0),
    };
    let branch_tree = match branch.get().peel_to_commit() {
        Ok(c) => match c.tree() {
            Ok(t) => t,
            Err(_) => return (0, 0),
        },
        Err(_) => return (0, 0),
    };
    let diff = match repo.diff_tree_to_tree(Some(head_tree), Some(&branch_tree), None) {
        Ok(d) => d,
        Err(_) => return (0, 0),
    };
    let stats = match diff.stats() {
        Ok(s) => s,
        Err(_) => return (0, 0),
    };
    (stats.insertions() as u32, stats.deletions() as u32)
}

pub fn list_worktrees(repo: &Repository) -> Result<Vec<WorktreeInfo>, String> {
    let mut worktrees = Vec::new();
    let wt_names = repo
        .worktrees()
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    for name in wt_names.iter() {
        if let Some(name) = name {
            if let Ok(wt) = repo.find_worktree(name) {
                let wt_path = wt.path().to_string_lossy().to_string();
                // Try to detect branch from worktree
                let branch = detect_worktree_branch(&wt_path).unwrap_or_else(|| name.to_string());
                worktrees.push(WorktreeInfo {
                    path: wt_path,
                    branch,
                    is_main: false,
                });
            }
        }
    }

    Ok(worktrees)
}

fn detect_worktree_branch(wt_path: &str) -> Option<String> {
    let head_path = Path::new(wt_path).join(".git");
    // Worktree .git is a file pointing to the main repo's worktree dir
    if head_path.is_file() {
        if let Ok(repo) = Repository::open(wt_path) {
            if let Ok(head) = repo.head() {
                return head.shorthand().map(|s| s.to_string());
            }
        }
    }
    None
}

pub fn get_repo_info(path: &str) -> Result<RepoInfo, String> {
    let repo = open_repo(path)?;
    let name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let mut branches = list_branches(&repo)?;
    let worktrees = list_worktrees(&repo)?;

    // Count checkpoints per branch from the checkpoint tree
    let counts = count_checkpoints_per_branch(&repo);
    for branch in &mut branches {
        if let Some(&count) = counts.get(&branch.name) {
            branch.checkpoint_count = count;
        }
    }

    Ok(RepoInfo {
        path: path.to_string(),
        name,
        branches,
        worktrees,
        registered: false,
    })
}

pub fn validate_worktree_request(
    mode: &str,
    branch_name: &str,
    target_path: &str,
) -> Result<CreateWorktreeMode, String> {
    if branch_name.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }
    if target_path.trim().is_empty() {
        return Err("Target path is required".to_string());
    }

    match mode {
        "existing" => Ok(CreateWorktreeMode::Existing),
        "new" => Ok(CreateWorktreeMode::New),
        _ => Err("Invalid create mode".to_string()),
    }
}

pub fn build_git_worktree_add_args(
    mode: CreateWorktreeMode,
    branch_name: &str,
    target_path: &str,
) -> Vec<String> {
    match mode {
        CreateWorktreeMode::Existing => vec![
            "worktree".to_string(),
            "add".to_string(),
            target_path.to_string(),
            branch_name.to_string(),
        ],
        CreateWorktreeMode::New => vec![
            "worktree".to_string(),
            "add".to_string(),
            "-b".to_string(),
            branch_name.to_string(),
            target_path.to_string(),
        ],
    }
}

pub fn build_git_worktree_remove_args(worktree_path: &str, force: bool) -> Vec<String> {
    let mut args = vec!["worktree".to_string(), "remove".to_string()];
    if force {
        args.push("--force".to_string());
    }
    args.push(worktree_path.to_string());
    args
}

pub fn build_git_branch_delete_args(branch_name: &str, force: bool) -> Vec<String> {
    vec![
        "branch".to_string(),
        if force { "-D" } else { "-d" }.to_string(),
        branch_name.to_string(),
    ]
}

pub fn delete_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
    if branch_name.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }

    open_repo(repo_path)?;

    let args = build_git_branch_delete_args(branch_name.trim(), false);
    run_git_command(repo_path, &args)
}

pub fn create_worktree(
    repo_path: &str,
    mode: &str,
    branch_name: &str,
    target_path: &str,
) -> Result<(), String> {
    let mode = validate_worktree_request(mode, branch_name, target_path)?;
    open_repo(repo_path)?;

    let args = build_git_worktree_add_args(mode, branch_name.trim(), target_path.trim());
    run_git_command(repo_path, &args)
}

pub fn delete_worktree(
    repo_path: &str,
    worktree_path: &str,
    branch_name: &str,
    force: bool,
) -> Result<(), String> {
    if branch_name.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }
    if worktree_path.trim().is_empty() {
        return Err("Worktree path is required".to_string());
    }
    if paths_match(repo_path, worktree_path) {
        return Err("Cannot delete the main repository checkout".to_string());
    }

    open_repo(repo_path)?;

    let remove_args = build_git_worktree_remove_args(worktree_path.trim(), force);
    run_git_command(repo_path, &remove_args)?;

    let delete_args = build_git_branch_delete_args(branch_name.trim(), force);
    run_git_command(repo_path, &delete_args)
}

fn run_git_command(repo_path: &str, args: &[String]) -> Result<(), String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "Git command failed".to_string()
    };

    Err(message)
}

fn paths_match(left: &str, right: &str) -> bool {
    let left = std::fs::canonicalize(left).ok();
    let right = std::fs::canonicalize(right).ok();
    matches!((left, right), (Some(left), Some(right)) if left == right)
}

/// Count checkpoints per branch by walking the checkpoint tree
fn count_checkpoints_per_branch(repo: &Repository) -> std::collections::HashMap<String, u32> {
    let mut counts = std::collections::HashMap::new();

    let branch_ref = match repo.find_branch("entire/checkpoints/v1", git2::BranchType::Local) {
        Ok(b) => b,
        Err(_) => return counts,
    };

    let commit = match branch_ref.get().peel_to_commit() {
        Ok(c) => c,
        Err(_) => return counts,
    };

    let tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return counts,
    };

    let _ = tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        let name = match entry.name() {
            Some(n) => n,
            None => return git2::TreeWalkResult::Ok,
        };

        if name == "metadata.json" && !dir.is_empty() {
            let parts: Vec<&str> = dir.trim_end_matches('/').split('/').collect();
            if parts.len() == 2 {
                if let Ok(blob) = repo.find_blob(entry.id()) {
                    if let Ok(content) = std::str::from_utf8(blob.content()) {
                        // Quick parse just the branch field
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
                            if let Some(branch) = val.get("branch").and_then(|b| b.as_str()) {
                                *counts.entry(branch.to_string()).or_insert(0) += 1;
                            }
                        }
                    }
                }
            }
        }

        git2::TreeWalkResult::Ok
    });

    counts
}

#[cfg(test)]
mod tests {
    use super::{
        build_git_branch_delete_args, build_git_worktree_add_args, build_git_worktree_remove_args,
        create_worktree, delete_branch, delete_worktree, validate_worktree_request,
        CreateWorktreeMode,
    };
    use git2::{BranchType, Repository};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn builds_existing_branch_worktree_add_args() {
        assert_eq!(
            build_git_worktree_add_args(
                CreateWorktreeMode::Existing,
                "feature/test",
                "/tmp/entire-app-feature-test",
            ),
            vec![
                "worktree".to_string(),
                "add".to_string(),
                "/tmp/entire-app-feature-test".to_string(),
                "feature/test".to_string(),
            ]
        );
    }

    #[test]
    fn builds_new_branch_worktree_add_args() {
        assert_eq!(
            build_git_worktree_add_args(
                CreateWorktreeMode::New,
                "feature/test",
                "/tmp/entire-app-feature-test",
            ),
            vec![
                "worktree".to_string(),
                "add".to_string(),
                "-b".to_string(),
                "feature/test".to_string(),
                "/tmp/entire-app-feature-test".to_string(),
            ]
        );
    }

    #[test]
    fn builds_safe_delete_args() {
        assert_eq!(
            build_git_worktree_remove_args("/tmp/entire-app-feature-test", false),
            vec![
                "worktree".to_string(),
                "remove".to_string(),
                "/tmp/entire-app-feature-test".to_string(),
            ]
        );
    }

    #[test]
    fn builds_force_delete_args() {
        assert_eq!(
            build_git_worktree_remove_args("/tmp/entire-app-feature-test", true),
            vec![
                "worktree".to_string(),
                "remove".to_string(),
                "--force".to_string(),
                "/tmp/entire-app-feature-test".to_string(),
            ]
        );
    }

    #[test]
    fn builds_force_branch_delete_args() {
        assert_eq!(
            build_git_branch_delete_args("feature/test", true),
            vec![
                "branch".to_string(),
                "-D".to_string(),
                "feature/test".to_string(),
            ]
        );
    }

    #[test]
    fn rejects_blank_branch_names() {
        let err = validate_worktree_request("existing", "   ", "/tmp/target").unwrap_err();
        assert!(err.contains("Branch name is required"));
    }

    #[test]
    fn rejects_unknown_create_modes() {
        let err = validate_worktree_request("other", "feature/test", "/tmp/target").unwrap_err();
        assert!(err.contains("Invalid create mode"));
    }

    #[test]
    fn rejects_blank_target_paths() {
        let err = validate_worktree_request("new", "feature/test", " ").unwrap_err();
        assert!(err.contains("Target path is required"));
    }

    #[test]
    fn creates_a_worktree_for_a_new_branch() {
        let repo_dir = create_temp_repo("create-new-branch");
        let repo_path = repo_dir.join("repo");
        let worktree_path = repo_dir.join("repo-feature-test");
        init_repo(&repo_path);

        create_worktree(
            repo_path.to_str().unwrap(),
            "new",
            "feature/test",
            worktree_path.to_str().unwrap(),
        )
        .unwrap();

        let worktree_repo = Repository::open(&worktree_path).unwrap();
        let head = worktree_repo.head().unwrap();
        assert_eq!(head.shorthand(), Some("feature/test"));
    }

    #[test]
    fn deletes_a_clean_worktree_and_branch() {
        let repo_dir = create_temp_repo("delete-clean-worktree");
        let repo_path = repo_dir.join("repo");
        let worktree_path = repo_dir.join("repo-feature-test");
        init_repo(&repo_path);

        create_worktree(
            repo_path.to_str().unwrap(),
            "new",
            "feature/test",
            worktree_path.to_str().unwrap(),
        )
        .unwrap();

        delete_worktree(
            repo_path.to_str().unwrap(),
            worktree_path.to_str().unwrap(),
            "feature/test",
            false,
        )
        .unwrap();

        assert!(!worktree_path.exists());

        let repo = Repository::open(&repo_path).unwrap();
        assert!(repo.find_branch("feature/test", BranchType::Local).is_err());
    }

    #[test]
    fn safe_delete_preserves_dirty_worktrees_until_forced() {
        let repo_dir = create_temp_repo("delete-dirty-worktree");
        let repo_path = repo_dir.join("repo");
        let worktree_path = repo_dir.join("repo-feature-test");
        init_repo(&repo_path);

        create_worktree(
            repo_path.to_str().unwrap(),
            "new",
            "feature/test",
            worktree_path.to_str().unwrap(),
        )
        .unwrap();

        fs::write(worktree_path.join("dirty.txt"), "dirty").unwrap();

        let err = delete_worktree(
            repo_path.to_str().unwrap(),
            worktree_path.to_str().unwrap(),
            "feature/test",
            false,
        )
        .unwrap_err();
        assert!(!err.is_empty());
        assert!(worktree_path.exists());

        delete_worktree(
            repo_path.to_str().unwrap(),
            worktree_path.to_str().unwrap(),
            "feature/test",
            true,
        )
        .unwrap();

        assert!(!worktree_path.exists());
    }

    #[test]
    fn deletes_a_plain_branch() {
        let repo_dir = create_temp_repo("delete-plain-branch");
        let repo_path = repo_dir.join("repo");
        init_repo(&repo_path);
        run_git(&repo_path, &["branch", "feature/plain"]);

        delete_branch(repo_path.to_str().unwrap(), "feature/plain").unwrap();

        let repo = Repository::open(&repo_path).unwrap();
        assert!(repo.find_branch("feature/plain", BranchType::Local).is_err());
    }

    fn create_temp_repo(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("entire-{label}-{unique}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn init_repo(repo_path: &Path) {
        fs::create_dir_all(repo_path).unwrap();
        run_git(repo_path.parent().unwrap(), &["init", "--initial-branch=main", repo_path.to_str().unwrap()]);
        run_git(repo_path, &["config", "user.name", "Entire Tests"]);
        run_git(repo_path, &["config", "user.email", "entire@example.com"]);
        fs::write(repo_path.join("README.md"), "initial\n").unwrap();
        run_git(repo_path, &["add", "README.md"]);
        run_git(repo_path, &["commit", "-m", "initial"]);
    }

    fn run_git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git").args(args).current_dir(cwd).status().unwrap();
        assert!(status.success(), "git {:?} failed in {}", args, cwd.display());
    }
}
