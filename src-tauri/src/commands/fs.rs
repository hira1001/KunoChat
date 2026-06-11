use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

const MAX_READ_CHUNK_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    name: String,
    size: u64,
}

#[tauri::command]
pub async fn ensure_download_dir() -> Result<String, String> {
    let dir = downloads_dir()?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn unique_save_path(filename: String) -> Result<String, String> {
    let dir = downloads_dir()?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let candidate = dir.join(sanitize_filename(&filename));
    if !candidate.exists() {
        return Ok(candidate.to_string_lossy().to_string());
    }

    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string();
    let extension = candidate.extension().and_then(|value| value.to_str()).unwrap_or("");

    for index in 2..1000 {
        let next_name = if extension.is_empty() {
            format!("{stem} {index}")
        } else {
            format!("{stem} {index}.{extension}")
        };
        let next = dir.join(next_name);
        if !next.exists() {
            return Ok(next.to_string_lossy().to_string());
        }
    }

    Err("could not create unique path".to_string())
}

#[tauri::command]
pub async fn file_metadata(path: String) -> Result<FileMetadata, String> {
    let path = canonical_file_path(&path)?;
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("selected path is not a file".to_string());
    }

    Ok(FileMetadata {
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_string(),
        size: metadata.len(),
    })
}

#[tauri::command]
pub async fn read_file_chunk(path: String, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    let path = canonical_file_path(&path)?;
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("selected path is not a file".to_string());
    }
    if offset > metadata.len() {
        return Err("read offset is beyond end of file".to_string());
    }

    let bounded_length = length.min(MAX_READ_CHUNK_BYTES);
    let mut file = File::open(&path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;

    let mut buffer = vec![0; bounded_length as usize];
    let bytes_read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    buffer.truncate(bytes_read);
    Ok(buffer)
}

#[tauri::command]
pub async fn file_sha256(path: String) -> Result<String, String> {
    let path = canonical_file_path(&path)?;
    let mut file = File::open(&path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];

    loop {
        let bytes_read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn save_received_file(filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let save_path = PathBuf::from(unique_save_path(filename).await?);
    if let Some(parent) = save_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut file = File::create(&save_path).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(save_path.to_string_lossy().to_string())
}

fn downloads_dir() -> Result<PathBuf, String> {
    dirs::download_dir()
        .map(|path| path.join("KunoChat"))
        .ok_or_else(|| "downloads directory not found".to_string())
}

fn canonical_file_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if canonical.is_file() {
        Ok(canonical)
    } else {
        Err("path is not a file".to_string())
    }
}

fn sanitize_filename(filename: &str) -> String {
    filename
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::sanitize_filename;

    #[test]
    fn sanitize_filename_replaces_path_separators() {
        assert_eq!(sanitize_filename("../bad/file.txt"), ".._bad_file.txt");
    }

    #[test]
    fn sanitize_filename_replaces_windows_reserved_chars() {
        assert_eq!(sanitize_filename("a:b*c?d\"e<f>g|h.txt"), "a_b_c_d_e_f_g_h.txt");
    }

    #[test]
    fn sanitize_filename_trims_whitespace() {
        assert_eq!(sanitize_filename("  file.txt  "), "file.txt");
    }
}
