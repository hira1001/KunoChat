use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;
use zip::write::FileOptions;

const MAX_READ_CHUNK_BYTES: u64 = 1024 * 1024;
const MAX_TRANSFER_BYTES: u64 = 10 * 1024 * 1024 * 1024;
const MAX_TRANSFER_ID_LENGTH: usize = 128;
const MAX_ZIP_ENTRIES: usize = 10_000;
const MAX_UNZIPPED_BYTES: u64 = 10 * 1024 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    name: String,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    local_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartFilePreparation {
    pub(crate) path: String,
    pub(crate) size: u64,
}

#[tauri::command]
pub async fn ensure_download_dir(save_folder: Option<String>) -> Result<String, String> {
    let dir = resolve_save_dir(save_folder.as_deref())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn unique_save_path(
    filename: String,
    save_folder: Option<String>,
) -> Result<String, String> {
    let dir = resolve_save_dir(save_folder.as_deref())?;

    let candidate = dir.join(sanitize_filename(&filename));
    if !candidate.exists() {
        return Ok(candidate.to_string_lossy().to_string());
    }

    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string();
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

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
        local_path: None,
    })
}

/// Allows the exact user-selected source file through the Tauri fs scope.
/// The frontend then uses the plugin's binary FileHandle IPC instead of a JSON
/// byte array for every transfer chunk.
#[tauri::command]
pub async fn grant_file_read_access(app: AppHandle, path: String) -> Result<String, String> {
    let path = canonical_file_path(&path)?;
    app.fs_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn prepare_part_file(
    app: AppHandle,
    transfer_id: String,
    expected_size: u64,
    save_folder: Option<String>,
) -> Result<PartFilePreparation, String> {
    let (part_path, size) = prepare_part_path(&transfer_id, expected_size, save_folder.as_deref())?;
    let parts_dir = part_path
        .parent()
        .ok_or_else(|| "part directory not found".to_string())?;
    app.fs_scope()
        .allow_directory(parts_dir, true)
        .map_err(|error| error.to_string())?;

    Ok(PartFilePreparation {
        path: part_path.to_string_lossy().to_string(),
        size,
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
pub async fn save_received_file(
    filename: String,
    bytes: Vec<u8>,
    save_folder: Option<String>,
) -> Result<String, String> {
    if bytes.len() as u64 > MAX_TRANSFER_BYTES {
        return Err("received file exceeds the maximum supported size".to_string());
    }
    let save_path = PathBuf::from(unique_save_path(filename, save_folder).await?);
    if let Some(parent) = save_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut file = File::create(&save_path).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(save_path.to_string_lossy().to_string())
}

fn default_downloads_dir() -> Result<PathBuf, String> {
    dirs::download_dir()
        .map(|path| path.join("KunoChat"))
        .ok_or_else(|| "downloads directory not found".to_string())
}

pub(crate) fn resolve_save_dir(save_folder: Option<&str>) -> Result<PathBuf, String> {
    let selected = save_folder
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_home_path)
        .transpose()?
        .unwrap_or(default_downloads_dir()?);
    std::fs::create_dir_all(&selected).map_err(|error| error.to_string())?;
    selected.canonicalize().map_err(|error| error.to_string())
}

fn expand_home_path(value: &str) -> Result<PathBuf, String> {
    if value == "~" {
        return dirs::home_dir().ok_or_else(|| "home directory not found".to_string());
    }
    if let Some(relative) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return dirs::home_dir()
            .map(|home| home.join(relative))
            .ok_or_else(|| "home directory not found".to_string());
    }
    Ok(PathBuf::from(value))
}

pub(crate) fn validate_transfer_id(transfer_id: &str) -> Result<(), String> {
    if transfer_id.is_empty() || transfer_id.len() > MAX_TRANSFER_ID_LENGTH {
        return Err("invalid transfer id".to_string());
    }
    if transfer_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        Ok(())
    } else {
        Err("invalid transfer id".to_string())
    }
}

pub(crate) fn part_path(transfer_id: &str, save_folder: Option<&str>) -> Result<PathBuf, String> {
    validate_transfer_id(transfer_id)?;
    Ok(resolve_save_dir(save_folder)?
        .join(".parts")
        .join(format!("{transfer_id}.part")))
}

pub(crate) fn prepare_part_path(
    transfer_id: &str,
    expected_size: u64,
    save_folder: Option<&str>,
) -> Result<(PathBuf, u64), String> {
    if expected_size > MAX_TRANSFER_BYTES {
        return Err("transfer exceeds the configured size limit".to_string());
    }

    let part_path = part_path(transfer_id, save_folder)?;
    let parts_dir = part_path
        .parent()
        .ok_or_else(|| "part directory not found".to_string())?;
    std::fs::create_dir_all(parts_dir).map_err(|error| error.to_string())?;

    let size = if part_path.exists() {
        let metadata = std::fs::metadata(&part_path).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("part path is not a file".to_string());
        }
        metadata.len()
    } else {
        File::create(&part_path).map_err(|error| error.to_string())?;
        0
    };

    if size > expected_size {
        return Err("existing part file exceeds the declared transfer size".to_string());
    }

    Ok((part_path, size))
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathMetadata {
    name: String,
    size: u64,
    is_dir: bool,
}

#[tauri::command]
pub async fn path_metadata(path: String) -> Result<PathMetadata, String> {
    let path_buf = Path::new(&path);
    let metadata = std::fs::metadata(path_buf).map_err(|error| error.to_string())?;

    Ok(PathMetadata {
        name: path_buf
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_string(),
        size: if metadata.is_dir() { 0 } else { metadata.len() },
        is_dir: metadata.is_dir(),
    })
}

fn zip_dir_recursive<W: Write + Seek>(
    src_dir: &Path,
    current_dir: &Path,
    zip: &mut zip::ZipWriter<W>,
    visited_dirs: &mut HashSet<PathBuf>,
) -> Result<(), String> {
    let canonical_dir = current_dir.canonicalize().map_err(|e| e.to_string())?;
    if !visited_dirs.insert(canonical_dir) {
        return Ok(());
    }

    let entries = std::fs::read_dir(current_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || is_windows_reparse_point(&metadata) {
            continue;
        }

        let name = path
            .strip_prefix(src_dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        if metadata.is_dir() {
            zip.add_directory(&name, FileOptions::default())
                .map_err(|e| e.to_string())?;
            zip_dir_recursive(src_dir, &path, zip, visited_dirs)?;
        } else if metadata.is_file() {
            zip.start_file(&name, FileOptions::default())
                .map_err(|e| e.to_string())?;
            let mut f = File::open(&path).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, zip).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn is_windows_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(target_os = "windows"))]
fn is_windows_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn uuid_hint() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{}_{}", now, rand_hint())
}

fn rand_hint() -> u32 {
    let mut val = 0_u32;
    if let Ok(duration) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        val = duration.subsec_nanos();
    }
    val
}

fn create_temp_zip_file(folder_name: &str) -> Result<(PathBuf, File), String> {
    let safe_folder_name = sanitize_filename(folder_name);
    for attempt in 0..100 {
        let temp_zip_name = format!(
            "KunoChat_Dir_{}_{}_{}.zip",
            safe_folder_name,
            uuid_hint(),
            attempt
        );
        let temp_zip_path = std::env::temp_dir().join(temp_zip_name);
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_zip_path)
        {
            Ok(file) => return Ok((temp_zip_path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("failed to create a unique temporary zip file".to_string())
}

#[tauri::command]
pub async fn zip_directory(dir_path: String) -> Result<FileMetadata, String> {
    let src_dir = Path::new(&dir_path);
    if !src_dir.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let folder_name = src_dir
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("folder")
        .to_string();

    let (temp_zip_path, zip_file) = create_temp_zip_file(&folder_name)?;
    let mut zip = zip::ZipWriter::new(zip_file);

    let mut visited_dirs = HashSet::new();
    zip_dir_recursive(src_dir, src_dir, &mut zip, &mut visited_dirs)?;
    zip.finish().map_err(|e| e.to_string())?;

    let metadata = std::fs::metadata(&temp_zip_path).map_err(|e| e.to_string())?;

    Ok(FileMetadata {
        name: format!("{}.zip", folder_name),
        size: metadata.len(),
        local_path: Some(temp_zip_path.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub async fn unzip_file(zip_path: String, dest_dir: String) -> Result<String, String> {
    let zip_path_buf = PathBuf::from(&zip_path);
    let dest_dir_buf = PathBuf::from(&dest_dir);

    if !zip_path_buf.is_file() {
        return Err("Zip file does not exist".to_string());
    }

    let file = File::open(&zip_path_buf).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    if archive.len() > MAX_ZIP_ENTRIES {
        return Err("archive contains too many entries".to_string());
    }

    let mut extracted_bytes = 0_u64;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        extracted_bytes = extracted_bytes
            .checked_add(file.size())
            .ok_or_else(|| "archive is too large".to_string())?;
        if extracted_bytes > MAX_UNZIPPED_BYTES {
            return Err("archive expands beyond the maximum supported size".to_string());
        }
        let outpath = match file.enclosed_name() {
            Some(path) => dest_dir_buf.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    let _ = std::fs::remove_file(&zip_path_buf);

    Ok(dest_dir_buf.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_part_file_size(
    transfer_id: String,
    save_folder: Option<String>,
) -> Result<u64, String> {
    let part_path = part_path(&transfer_id, save_folder.as_deref())?;
    if part_path.exists() {
        let metadata = std::fs::metadata(&part_path).map_err(|e| e.to_string())?;
        Ok(metadata.len())
    } else {
        Ok(0)
    }
}

#[tauri::command]
pub async fn finalize_part_file(
    transfer_id: String,
    filename: String,
    expected_size: u64,
    sha256: Option<String>,
    save_folder: Option<String>,
) -> Result<String, String> {
    if expected_size > MAX_TRANSFER_BYTES {
        return Err("transfer exceeds the configured size limit".to_string());
    }
    let part_path = part_path(&transfer_id, save_folder.as_deref())?;
    let parts_dir = part_path
        .parent()
        .ok_or_else(|| "part directory not found".to_string())?;
    std::fs::create_dir_all(parts_dir).map_err(|error| error.to_string())?;
    if !part_path.exists() {
        if expected_size == 0 {
            File::create(&part_path).map_err(|error| error.to_string())?;
        } else {
            return Err("part file does not exist".to_string());
        }
    }
    let actual_size = std::fs::metadata(&part_path)
        .map_err(|error| error.to_string())?
        .len();
    if actual_size != expected_size {
        return Err("received file size does not match the declared transfer size".to_string());
    }
    if let Some(expected_hash) = sha256 {
        if !is_sha256(&expected_hash) {
            return Err("invalid sha256 digest".to_string());
        }
        let actual_hash = sha256_for_path(&part_path)?;
        if !actual_hash.eq_ignore_ascii_case(&expected_hash) {
            return Err("file integrity check failed".to_string());
        }
    }

    let dest_path = PathBuf::from(unique_save_path(filename, save_folder).await?);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    std::fs::rename(&part_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn delete_part_file(
    transfer_id: String,
    save_folder: Option<String>,
) -> Result<(), String> {
    let part_path = part_path(&transfer_id, save_folder.as_deref())?;
    if part_path.exists() {
        std::fs::remove_file(&part_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_temporary_zip(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let temp_dir = std::env::temp_dir()
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    let filename = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "temporary zip filename is unavailable".to_string())?;

    if !canonical.starts_with(&temp_dir)
        || !filename.starts_with("KunoChat_Dir_")
        || !filename.ends_with(".zip")
    {
        return Err("refusing to delete an unmanaged temporary file".to_string());
    }

    std::fs::remove_file(canonical).map_err(|error| error.to_string())
}

fn sanitize_filename(filename: &str) -> String {
    let sanitized = filename
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .trim_matches('.')
        .to_string();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "file".to_string()
    } else {
        sanitized
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sha256_for_path(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::{is_sha256, sanitize_filename, validate_transfer_id};

    #[test]
    fn sanitize_filename_replaces_path_separators() {
        assert_eq!(sanitize_filename("../bad/file.txt"), "_bad_file.txt");
    }

    #[test]
    fn sanitize_filename_replaces_windows_reserved_chars() {
        assert_eq!(
            sanitize_filename("a:b*c?d\"e<f>g|h.txt"),
            "a_b_c_d_e_f_g_h.txt"
        );
    }

    #[test]
    fn sanitize_filename_trims_whitespace() {
        assert_eq!(sanitize_filename("  file.txt  "), "file.txt");
    }

    #[test]
    fn sanitize_filename_rejects_dot_only_names() {
        assert_eq!(sanitize_filename(".."), "file");
        assert_eq!(sanitize_filename("."), "file");
    }

    #[test]
    fn transfer_id_rejects_path_characters() {
        assert!(validate_transfer_id("tr_01-asset").is_ok());
        assert!(validate_transfer_id("../escape").is_err());
        assert!(validate_transfer_id("C:\\temp").is_err());
    }

    #[test]
    fn sha256_validation_requires_a_hex_digest() {
        assert!(is_sha256(&"a".repeat(64)));
        assert!(!is_sha256("not-a-hash"));
    }
}
