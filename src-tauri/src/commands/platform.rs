use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    platform: String,
    shortcut: String,
    reveal_label: String,
}

#[tauri::command]
pub async fn get_platform_info() -> PlatformInfo {
    #[cfg(target_os = "windows")]
    {
        return PlatformInfo {
            platform: "windows".to_string(),
            shortcut: "Ctrl + Shift + Space".to_string(),
            reveal_label: "Show in Explorer".to_string(),
        };
    }

    #[cfg(target_os = "macos")]
    {
        return PlatformInfo {
            platform: "macos".to_string(),
            shortcut: "Cmd + Shift + Space".to_string(),
            reveal_label: "Reveal in Finder".to_string(),
        };
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        PlatformInfo {
            platform: "linux".to_string(),
            shortcut: "Ctrl + Shift + Space".to_string(),
            reveal_label: "Reveal in file manager".to_string(),
        }
    }
}

#[tauri::command]
pub async fn register_app_shortcuts(_app: AppHandle) -> Result<(), String> {
    crate::native::shortcuts::register(&_app)
}

#[tauri::command]
pub async fn set_app_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    crate::native::shortcuts::register_shortcut(&app, &shortcut)
}

#[tauri::command]
pub async fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<(), String> {
    let _note = crate::native::autostart::AUTOSTART_NOTE;
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|error| error.to_string())
    } else {
        autostart.disable().map_err(|error| error.to_string())
    }
}
