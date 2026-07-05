use futures_util::StreamExt;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerDownloadResult {
    path: String,
}

#[tauri::command]
pub async fn download_and_open_installer(
    app: AppHandle,
    url: String,
    file_name: String,
) -> Result<InstallerDownloadResult, String> {
    if !is_allowed_release_url(&url) {
        return Err("Unsupported installer URL.".to_string());
    }

    let safe_name = sanitize_file_name(&file_name)?;
    let target_dir = installer_download_dir(&app)?;
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|error| error.to_string())?;
    let target_path = target_dir.join(safe_name);

    let client = reqwest::Client::builder()
        .user_agent("KunoChat updater")
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Installer download failed: {}", response.status()));
    }

    let mut file = tokio::fs::File::create(&target_path)
        .await
        .map_err(|error| error.to_string())?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|error| error.to_string())?;

    open::that(&target_path).map_err(|error| error.to_string())?;

    Ok(InstallerDownloadResult {
        path: target_path.to_string_lossy().to_string(),
    })
}

fn is_allowed_release_url(url: &str) -> bool {
    url.starts_with("https://github.com/hira1001/KunoChat/releases/download/")
}

fn sanitize_file_name(file_name: &str) -> Result<String, String> {
    let cleaned: String = file_name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' '))
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Invalid installer file name.".to_string());
    }
    Ok(trimmed.to_string())
}

fn installer_download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().download_dir().unwrap_or_else(|_| std::env::temp_dir());
    Ok(base.join("KunoChat").join("Installers"))
}
