use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub async fn notify_message(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn notify_file_received(
    app: AppHandle,
    filename: String,
    size: u64,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title("KunoChat received a file")
        .body(format!("{filename} · {size} bytes"))
        .show()
        .map_err(|error| error.to_string())
}
