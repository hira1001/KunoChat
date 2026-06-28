mod commands;
mod native;

use commands::{fs, identity, notification, opener, platform, transfer_session, window};
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            window::start(app);
            transfer_session::start(app)
                .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?;
            native::signal_server::start(app.handle().clone(), 8787);
            native::transfer::start(app);
            native::peer_discovery::start(app.handle().clone());
            native::tailscale_discovery::start(app.handle().clone());
            native::tray::build_tray(app)?;
            native::shortcuts::register(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window::position_top_right_for_window(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            window::show_main_window,
            window::hide_main_window,
            window::position_top_right,
            window::set_always_on_top,
            window::set_unread_count,
            window::set_window_mode,
            fs::ensure_download_dir,
            fs::unique_save_path,
            fs::file_metadata,
            fs::grant_file_read_access,
            fs::file_sha256,
            fs::read_file_chunk,
            fs::save_received_file,
            fs::path_metadata,
            fs::zip_directory,
            fs::unzip_file,
            fs::prepare_part_file,
            fs::get_part_file_size,
            fs::finalize_part_file,
            fs::delete_part_file,
            identity::get_device_identity,
            identity::sign_device_challenge,
            identity::verify_device_signature,
            transfer_session::save_transfer_session,
            transfer_session::list_recoverable_transfer_sessions,
            transfer_session::remove_transfer_session,
            native::transfer::prepare_native_receive,
            native::transfer::cancel_native_receive,
            native::transfer::cancel_native_send,
            native::transfer::pause_native_send,
            native::transfer::resume_native_send,
            native::transfer::send_native_file,
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
