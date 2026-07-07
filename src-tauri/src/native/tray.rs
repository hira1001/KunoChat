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

    let mut builder = TrayIconBuilder::with_id("main");
    // Bind the app icon explicitly; on some platforms build() fails/panics
    // without an icon. Fall back gracefully if none is embedded.
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder
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
                    // Only open the folder if we could ensure it exists, so a
                    // failed create doesn't surface a raw OS error dialog.
                    match std::fs::create_dir_all(&kunochat_downloads) {
                        Ok(()) => {
                            let _ = open::that(kunochat_downloads);
                        }
                        Err(error) => {
                            eprintln!("KunoChat could not open downloads folder: {error}");
                            let _ = open::that(downloads);
                        }
                    }
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
