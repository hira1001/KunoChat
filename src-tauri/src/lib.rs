mod commands;
mod native;

use commands::{fs, notification, opener, platform, window};
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            native::signal_server::start(8787);
            native::peer_discovery::start(app.handle().clone());
            native::tray::build_tray(app)?;
            native::shortcuts::register(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window::position_top_right_for_window(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            window::show_main_window,
            window::hide_main_window,
            window::position_top_right,
            window::set_always_on_top,
            fs::ensure_download_dir,
            fs::unique_save_path,
            fs::file_metadata,
            fs::file_sha256,
            fs::read_file_chunk,
            fs::save_received_file,
            opener::open_path,
            opener::reveal_path,
            notification::notify_message,
            notification::notify_file_received,
            platform::get_platform_info,
            platform::register_app_shortcuts,
            platform::set_launch_at_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running KunoChat");
}
