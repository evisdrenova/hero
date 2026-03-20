use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

#[allow(dead_code)]
pub struct FileWatcher {
    _watcher: notify::RecommendedWatcher,
}

pub enum WatchEvent {
    CheckpointChanged,
    SessionChanged(#[allow(dead_code)] String),
    ConfigChanged,
}

/// Start watching a repo for Entire-related file changes
pub fn watch_repo(
    repo_path: &str,
    callback: impl Fn(WatchEvent) + Send + 'static,
) -> Result<(), String> {
    let git_dir = Path::new(repo_path).join(".git");
    let entire_dir = Path::new(repo_path).join(".entire");

    let (tx, rx) = mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
        .map_err(|e| format!("Failed to create debouncer: {}", e))?;

    // Watch session directory
    let sessions_dir = git_dir.join("entire-sessions");
    if sessions_dir.exists() {
        debouncer
            .watcher()
            .watch(&sessions_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch sessions: {}", e))?;
    }

    // Watch .entire/ config directory
    if entire_dir.exists() {
        debouncer
            .watcher()
            .watch(&entire_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch .entire: {}", e))?;
    }

    // Watch git refs for checkpoint branch changes
    let refs_dir = git_dir.join("refs/heads/entire");
    if refs_dir.exists() {
        debouncer
            .watcher()
            .watch(&refs_dir, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch refs: {}", e))?;
    }

    // Spawn thread to process events
    std::thread::spawn(move || {
        let _debouncer = debouncer; // Keep alive
        for result in rx {
            match result {
                Ok(events) => {
                    for event in events {
                        if event.kind == DebouncedEventKind::Any {
                            let path_str = event.path.to_string_lossy();
                            if path_str.contains("entire-sessions") {
                                callback(WatchEvent::SessionChanged(
                                    event.path.to_string_lossy().to_string(),
                                ));
                            } else if path_str.contains("refs/heads/entire/checkpoints") {
                                callback(WatchEvent::CheckpointChanged);
                            } else if path_str.contains(".entire") {
                                callback(WatchEvent::ConfigChanged);
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Watch error: {:?}", e);
                }
            }
        }
    });

    Ok(())
}
