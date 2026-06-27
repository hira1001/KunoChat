use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const SHOW_HIDE_SHORTCUT: &str = "CommandOrControl+Shift+Space";
pub const SEND_CLIPBOARD_SHORTCUT: &str = "CommandOrControl+Shift+V";
pub const PICK_FILE_SHORTCUT: &str = "CommandOrControl+O";

pub fn register(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
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
        .map_err(|error| error.to_string())?;

    app.global_shortcut()
        .on_shortcut(PICK_FILE_SHORTCUT, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("kuno:pick-files", ());
                }
            }
        })
        .map_err(|error| error.to_string())?;

    app.global_shortcut()
        .on_shortcut(SEND_CLIPBOARD_SHORTCUT, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("kuno:send-clipboard", ());
                }
            }
        })
        .map_err(|error| error.to_string())
}
