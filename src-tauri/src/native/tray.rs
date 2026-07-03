use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Emitter, Manager};

pub fn build_tray(app: &mut App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open KunoChat", true, None::<&str>)?;
    let send_file = MenuItem::with_id(app, "send_file", "Send File...", true, None::<&str>)?;
    let send_clipboard =
        MenuItem::with_id(app, "send_clipboard", "Send Clipboard", true, None::<&str>)?;
    let downloads = MenuItem::with_id(app, "downloads", "Open Downloads", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &send_file,
            &send_clipboard,
            &separator,
            &downloads,
            &settings,
            &separator,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .tooltip("KunoChat")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("kuno:navigate", "main");
                }
            }
            "send_file" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("kuno:pick-files", ());
                }
            }
            "send_clipboard" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("kuno:send-clipboard", ());
                }
            }
            "downloads" => {
                if let Some(downloads) = dirs::download_dir() {
                    let kunochat_downloads = downloads.join("KunoChat");
                    let _ = std::fs::create_dir_all(&kunochat_downloads);
                    let _ = open::that(kunochat_downloads);
                }
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("kuno:navigate", "settings");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = tray.app_handle().emit("kuno:navigate", "main");
                }
            }
        })
        .build(app)?;

    Ok(())
}
