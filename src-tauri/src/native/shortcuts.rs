use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const SHOW_HIDE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

pub fn register(app: &AppHandle) -> Result<(), String> {
    register_shortcut(app, SHOW_HIDE_SHORTCUT)
}

pub fn register_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let shortcut = normalize_shortcut(shortcut);
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();
    if let Err(error) = manager
        .on_shortcut(shortcut.as_str(), |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(false);
                    if visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = app.emit("kuno:navigate", "main");
                    }
                }
            }
        })
    {
        eprintln!("KunoChat could not register global shortcut {shortcut}: {error}");
        return Err(error.to_string());
    }

    Ok(())
}

fn normalize_shortcut(shortcut: &str) -> String {
    let compact = shortcut.split_whitespace().collect::<String>();
    if compact.is_empty() {
        SHOW_HIDE_SHORTCUT.to_string()
    } else {
        compact
    }
}
