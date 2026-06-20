use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use zip::write::FileOptions;

const MAX_READ_CHUNK_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    name: String,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    local_path: Option<String>,
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
        local_path: None,
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
) -> Result<(), String> {
    let entries = std::fs::read_dir(current_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        let name = path.strip_prefix(src_dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(&name, FileOptions::default()).map_err(|e| e.to_string())?;
            zip_dir_recursive(src_dir, &path, zip)?;
        } else if path.is_file() {
            zip.start_file(&name, FileOptions::default()).map_err(|e| e.to_string())?;
            let mut f = File::open(&path).map_err(|e| e.to_string())?;
            let mut buffer = Vec::new();
            f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            zip.write_all(&buffer).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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

    let temp_zip_name = format!("KunoChat_Dir_{}_{}.zip", folder_name, uuid_hint());
    let temp_zip_path = std::env::temp_dir().join(&temp_zip_name);

    let zip_file = File::create(&temp_zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(zip_file);

    zip_dir_recursive(src_dir, src_dir, &mut zip)?;
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

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
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

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                let _ = std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(mode));
            }
        }
    }

    let _ = std::fs::remove_file(&zip_path_buf);

    Ok(dest_dir_buf.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn write_part_chunk(transfer_id: String, bytes: Vec<u8>) -> Result<u64, String> {
    let parts_dir = downloads_dir()?.join(".parts");
    std::fs::create_dir_all(&parts_dir).map_err(|e| e.to_string())?;
    let part_path = parts_dir.join(format!("{}.part", transfer_id));

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(&part_path)
        .map_err(|e| e.to_string())?;

    file.write_all(&bytes).map_err(|e| e.to_string())?;
    let metadata = std::fs::metadata(&part_path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

#[tauri::command]
pub async fn get_part_file_size(transfer_id: String) -> Result<u64, String> {
    let parts_dir = downloads_dir()?.join(".parts");
    let part_path = parts_dir.join(format!("{}.part", transfer_id));
    if part_path.exists() {
        let metadata = std::fs::metadata(&part_path).map_err(|e| e.to_string())?;
        Ok(metadata.len())
    } else {
        Ok(0)
    }
}

#[tauri::command]
pub async fn finalize_part_file(transfer_id: String, filename: String) -> Result<String, String> {
    let parts_dir = downloads_dir()?.join(".parts");
    let part_path = parts_dir.join(format!("{}.part", transfer_id));
    if !part_path.exists() {
        return Err("Part file does not exist".to_string());
    }

    let dest_path = PathBuf::from(unique_save_path(filename).await?);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    std::fs::rename(&part_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn delete_part_file(transfer_id: String) -> Result<(), String> {
    let parts_dir = downloads_dir()?.join(".parts");
    let part_path = parts_dir.join(format!("{}.part", transfer_id));
    if part_path.exists() {
        std::fs::remove_file(&part_path).map_err(|e| e.to_string())?;
    }
    Ok(())
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
