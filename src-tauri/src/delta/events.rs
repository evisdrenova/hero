use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;

use super::DeltaEvent;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeltaEventPayload {
    pub delta_id: String,
    pub event: DeltaEvent,
}

pub fn start_delta_watcher(app: AppHandle) -> Result<(), String> {
    let deltas_root = super::deltas_root();
    if !deltas_root.exists() {
        std::fs::create_dir_all(&deltas_root).map_err(|e| e.to_string())?;
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(300), tx)
        .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&deltas_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let _debouncer = debouncer; // keep alive

        while let Ok(Ok(events)) = rx.recv() {
            for event in events {
                let path = &event.path;
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if !path_is_in_events_dir(path) {
                    continue;
                }
                if let Some(delta_id) = extract_delta_id(path) {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        if let Ok(delta_event) = serde_json::from_str::<DeltaEvent>(&content) {
                            let _ = app_handle.emit(
                                "delta-event",
                                DeltaEventPayload {
                                    delta_id,
                                    event: delta_event,
                                },
                            );
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

fn path_is_in_events_dir(path: &std::path::Path) -> bool {
    path.parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        == Some("events")
}

fn extract_delta_id(path: &std::path::Path) -> Option<String> {
    path.parent()? // events/
        .parent()? // {delta_id}/
        .file_name()?
        .to_str()
        .map(|s| s.to_string())
}
