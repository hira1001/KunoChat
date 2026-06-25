use std::sync::Mutex;
#[cfg(target_os = "windows")]
use tauri::UserAttentionType;
use tauri::{App, AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

const MAIN_MINIMUM_SIZE: PhysicalSize<u32> = PhysicalSize::new(320, 420);
// This includes the native title bar. Keep enough client-area height for the
// 44px pill plus a stable 4px inset on each side.
const MINI_WINDOW_SIZE: PhysicalSize<u32> = PhysicalSize::new(212, 96);

#[derive(Default)]
pub struct WindowModeState {
    previous_main: Mutex<Option<MainWindowSnapshot>>,
}

#[derive(Clone, Copy)]
struct MainWindowSnapshot {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
}

pub fn start(app: &App) {
    app.manage(WindowModeState::default());
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn hide_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn position_top_right(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    position_top_right_for_window(&window)
}

#[tauri::command]
pub async fn set_always_on_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_unread_count(app: AppHandle, count: u32) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    #[cfg(not(target_os = "windows"))]
    window
        .set_badge_count((count > 0).then_some(i64::from(count)))
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    window
        .request_user_attention(if count > 0 {
            Some(UserAttentionType::Informational)
        } else {
            None
        })
        .map_err(|error| error.to_string())?;

    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if count == 0 {
            "KunoChat".to_string()
        } else {
            format!("KunoChat - {count} unread")
        };
        tray.set_tooltip(Some(tooltip))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn set_window_mode(
    app: AppHandle,
    state: State<'_, WindowModeState>,
    mode: String,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    match mode.as_str() {
        "mini" => {
            let current_size = window.inner_size().map_err(|error| error.to_string())?;
            let current_position = window.outer_position().map_err(|error| error.to_string())?;
            if current_size.width > MINI_WINDOW_SIZE.width
                || current_size.height > MINI_WINDOW_SIZE.height
            {
                *state
                    .previous_main
                    .lock()
                    .map_err(|_| "window mode state lock poisoned".to_string())? =
                    Some(MainWindowSnapshot {
                        size: current_size,
                        position: current_position,
                    });
            }
            window
                .set_min_size(Some(MINI_WINDOW_SIZE))
                .map_err(|error| error.to_string())?;
            resize_window_content(&window, MINI_WINDOW_SIZE)?;
            position_top_right_for_window(&window)
        }
        "main" => {
            window
                .set_min_size(Some(MAIN_MINIMUM_SIZE))
                .map_err(|error| error.to_string())?;
            let previous_main = state
                .previous_main
                .lock()
                .map_err(|_| "window mode state lock poisoned".to_string())?
                .take();
            if let Some(previous_main) = previous_main {
                resize_window_content(&window, previous_main.size)?;
                window
                    .set_position(previous_main.position)
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        }
        _ => Err("invalid window mode".to_string()),
    }
}

fn resize_window_content(window: &WebviewWindow, size: PhysicalSize<u32>) -> Result<(), String> {
    window.set_size(size).map_err(|error| error.to_string())?;
    let inner_size = window.inner_size().map_err(|error| error.to_string())?;
    window
        .as_ref()
        .set_size(inner_size)
        .map_err(|error| error.to_string())
}

pub fn position_top_right_for_window(window: &WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(window
            .primary_monitor()
            .map_err(|error| error.to_string())?)
        .ok_or_else(|| "monitor not found".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window.outer_size().map_err(|error| error.to_string())?;
    let margin = 24_i32;

    let x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32 - margin;
    let y = monitor_position.y + margin;

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}
