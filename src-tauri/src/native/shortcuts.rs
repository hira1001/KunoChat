use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const SHOW_HIDE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

pub fn register(app: &AppHandle) -> Result<(), String> {
    if let Err(error) = app.global_shortcut()
        .on_shortcut(SHOW_HIDE_SHORTCUT, |app, _shortcut, event| {
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
        eprintln!("KunoChat could not register global shortcut {SHOW_HIDE_SHORTCUT}: {error}");
    }

    Ok(())
}
