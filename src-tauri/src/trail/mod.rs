use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrailMetadata {
    pub trail_id: String,
    pub branch: String,
    #[serde(default)]
    pub base: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub status: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    pub merged_at: Option<String>,
    #[serde(default)]
    pub priority: String,
    #[serde(default, rename = "type")]
    pub trail_type: String,
    #[serde(default)]
    pub reviewers: Vec<Reviewer>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Reviewer {
    pub login: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrailCheckpoints {
    pub checkpoints: Vec<CheckpointRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CheckpointRef {
    pub checkpoint_id: String,
    pub commit_sha: String,
    pub created_at: String,
    pub summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Discussion {
    pub comments: Vec<Comment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub resolved: bool,
    #[serde(default)]
    pub replies: Vec<CommentReply>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommentReply {
    pub id: String,
    pub author: String,
    pub body: String,
    pub created_at: String,
}

/// Full trail with all data
#[derive(Debug, Serialize, Clone)]
pub struct Trail {
    pub metadata: TrailMetadata,
    pub checkpoint_count: usize,
    pub comment_count: usize,
}

/// List all trails from entire/trails/v1 branch
pub fn list_trails(repo: &Repository) -> Result<Vec<Trail>, String> {
    let branch_ref = match repo.find_branch("entire/trails/v1", git2::BranchType::Local) {
        Ok(b) => b,
        Err(_) => return Ok(Vec::new()),
    };

    let commit = branch_ref
        .get()
        .peel_to_commit()
        .map_err(|e| format!("Failed to get trails commit: {}", e))?;

    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree: {}", e))?;

    let mut trails = Vec::new();

    // Trails use sharded storage: <shard(2chars)>/<suffix(10chars)>/metadata.json
    // Top-level entries are 2-char shard directories
    for shard_entry in tree.iter() {
        let shard_name = match shard_entry.name() {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Only process directories (shards)
        if shard_entry.kind() != Some(git2::ObjectType::Tree) {
            continue;
        }

        // Get the shard subtree
        let shard_tree = match repo.find_tree(shard_entry.id()) {
            Ok(t) => t,
            Err(_) => continue,
        };

        // Each entry in the shard is a trail directory
        for trail_entry in shard_tree.iter() {
            let trail_suffix = match trail_entry.name() {
                Some(n) => n.to_string(),
                None => continue,
            };

            if trail_entry.kind() != Some(git2::ObjectType::Tree) {
                continue;
            }

            let trail_dir = format!("{}/{}", shard_name, trail_suffix);

            // Read metadata.json
            let meta_path = format!("{}/metadata.json", trail_dir);
            if let Ok(metadata) = read_json_from_branch::<TrailMetadata>(repo, &meta_path) {
                // Count checkpoints
                let checkpoint_count = read_json_from_branch::<TrailCheckpoints>(
                    repo,
                    &format!("{}/checkpoints.json", trail_dir),
                )
                .map(|c| c.checkpoints.len())
                .unwrap_or(0);

                // Count comments
                let comment_count = read_json_from_branch::<Discussion>(
                    repo,
                    &format!("{}/discussion.json", trail_dir),
                )
                .map(|d| d.comments.len())
                .unwrap_or(0);

                trails.push(Trail {
                    metadata,
                    checkpoint_count,
                    comment_count,
                });
            }
        }
    }

    // Sort by updated_at descending
    trails.sort_by(|a, b| b.metadata.updated_at.cmp(&a.metadata.updated_at));

    Ok(trails)
}

fn read_json_from_branch<T: serde::de::DeserializeOwned>(
    repo: &Repository,
    path: &str,
) -> Result<T, String> {
    let branch_ref = repo
        .find_branch("entire/trails/v1", git2::BranchType::Local)
        .map_err(|e| format!("No trails branch: {}", e))?;

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

    let content = std::str::from_utf8(blob.content())
        .map_err(|e| format!("Invalid UTF-8: {}", e))?;

    serde_json::from_str(content).map_err(|e| format!("JSON parse error: {}", e))
}
