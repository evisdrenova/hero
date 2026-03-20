use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct EntireSettings {
    pub enabled: Option<bool>,
    pub local_dev: Option<bool>,
    pub log_level: Option<String>,
    pub telemetry: Option<bool>,
}

/// Read .entire/settings.json from a repo
pub fn read_settings(repo_path: &str) -> Result<EntireSettings, String> {
    let settings_path = Path::new(repo_path).join(".entire/settings.json");
    if !settings_path.exists() {
        return Err("No .entire/settings.json found".to_string());
    }

    let content =
        fs::read_to_string(&settings_path).map_err(|e| format!("Failed to read settings: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))
}

/// Check if a repo has Entire enabled
pub fn is_entire_enabled(repo_path: &str) -> bool {
    let entire_dir = Path::new(repo_path).join(".entire");
    if !entire_dir.exists() {
        return false;
    }
    match read_settings(repo_path) {
        Ok(settings) => settings.enabled.unwrap_or(false),
        Err(_) => false,
    }
}

// --- Registry persistence for manually registered repos ---

#[derive(Debug, Serialize, Deserialize, Default)]
struct RepoRegistry {
    repos: Vec<String>,
}

fn registry_path() -> PathBuf {
    let home = dirs_next().unwrap_or_default();
    PathBuf::from(home).join(".entire").join("registered-repos.json")
}

fn load_registered_repos() -> Vec<String> {
    let path = registry_path();
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str::<RepoRegistry>(&content) {
        Ok(reg) => reg.repos,
        Err(_) => Vec::new(),
    }
}

fn save_registered_repos(repos: &[String]) -> Result<(), String> {
    let path = registry_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create ~/.entire: {}", e))?;
    }
    let registry = RepoRegistry {
        repos: repos.to_vec(),
    };
    let content =
        serde_json::to_string_pretty(&registry).map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write registry: {}", e))
}

pub fn register_repo(path: &str) -> Result<(), String> {
    let p = Path::new(path);

    if !p.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    // Validate it's a git repo
    git2::Repository::open(p).map_err(|_| "Not a git repository".to_string())?;

    // Validate .entire is enabled
    if !is_entire_enabled(path) {
        return Err("Repository does not have Entire enabled (.entire/settings.json with enabled: true)".to_string());
    }

    // Canonicalize to avoid duplicates from different path representations
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {}", e))?
        .to_string_lossy()
        .to_string();

    let mut repos = load_registered_repos();
    if repos.contains(&canonical) {
        return Ok(()); // Already registered, not an error
    }

    repos.push(canonical);
    save_registered_repos(&repos)
}

pub fn unregister_repo(path: &str) -> Result<(), String> {
    let mut repos = load_registered_repos();
    let canonical = Path::new(path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string());

    repos.retain(|r| r != &canonical && r != path);
    save_registered_repos(&repos)
}

pub fn get_registered_repos() -> Vec<String> {
    load_registered_repos()
}

// --- Hidden repos persistence (for excluding discovered repos) ---

#[derive(Debug, Serialize, Deserialize, Default)]
struct HiddenRegistry {
    repos: Vec<String>,
}

fn hidden_registry_path() -> PathBuf {
    let home = dirs_next().unwrap_or_default();
    PathBuf::from(home).join(".entire").join("hidden-repos.json")
}

fn load_hidden_repos() -> Vec<String> {
    let path = hidden_registry_path();
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str::<HiddenRegistry>(&content) {
        Ok(reg) => reg.repos,
        Err(_) => Vec::new(),
    }
}

fn save_hidden_repos(repos: &[String]) -> Result<(), String> {
    let path = hidden_registry_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create ~/.entire: {}", e))?;
    }
    let registry = HiddenRegistry {
        repos: repos.to_vec(),
    };
    let content =
        serde_json::to_string_pretty(&registry).map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write hidden registry: {}", e))
}

pub fn hide_repo(path: &str) -> Result<(), String> {
    let canonical = Path::new(path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string());

    let mut repos = load_hidden_repos();
    if !repos.contains(&canonical) {
        repos.push(canonical);
    }
    save_hidden_repos(&repos)
}

pub fn get_hidden_repos() -> HashSet<String> {
    load_hidden_repos().into_iter().collect()
}

/// Discover repos with Entire enabled by scanning common directories
pub fn discover_repos() -> Vec<String> {
    let mut seen = HashSet::new();
    let mut repos = Vec::new();
    let home = dirs_next().unwrap_or_default();
    let hidden = get_hidden_repos();

    // Scan common project directories
    let scan_dirs = vec![
        PathBuf::from(&home).join("Projects"),
        PathBuf::from(&home).join("code"),
        PathBuf::from(&home).join("src"),
        PathBuf::from(&home).join("dev"),
    ];

    for dir in scan_dirs {
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && is_entire_enabled(&path.to_string_lossy()) {
                        let s = path.to_string_lossy().to_string();
                        if !hidden.contains(&s) && seen.insert(s.clone()) {
                            repos.push(s);
                        }
                    }
                }
            }
        }
    }

    // Merge in manually registered repos
    for registered in load_registered_repos() {
        if !hidden.contains(&registered) && seen.insert(registered.clone()) {
            // Only add if the repo still exists and is still enabled
            if Path::new(&registered).is_dir() && is_entire_enabled(&registered) {
                repos.push(registered);
            }
        }
    }

    repos
}

fn dirs_next() -> Option<String> {
    std::env::var("HOME").ok()
}
