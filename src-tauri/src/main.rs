#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use std::time::UNIX_EPOCH;
use tauri::{Emitter, Manager};

/// 递增代数以停掉旧的 mtime 轮询线程（每次 watch_file / stop_watch 都会 +1）
static WATCH_GEN: AtomicU64 = AtomicU64::new(0);

/// 本次进程要打开的文档路径（命令行参数或二次启动传入）
struct StartupPath(Mutex<Option<String>>);

#[derive(serde::Serialize)]
struct FileData {
    text: String,
    mtime: u64,
}

fn mtime_secs(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// UTF-8 失败时按 GBK 解码，兼容中文环境的历史文档
fn decode_text(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes.clone()) {
        Ok(s) => s,
        Err(_) => {
            let (s, _, _) = encoding_rs::GBK.decode(&bytes);
            s.into_owned()
        }
    }
}

#[tauri::command]
fn read_file(path: String) -> Result<FileData, String> {
    let p = Path::new(&path);
    let meta = fs::metadata(p).map_err(|e| format!("无法读取文件信息: {e}"))?;
    if !meta.is_file() {
        return Err("不是普通文件".into());
    }
    if meta.len() > 20 * 1024 * 1024 {
        return Err("文件超过 20MB，请拆分后查看".into());
    }
    let bytes = fs::read(p).map_err(|e| format!("读取失败: {e}"))?;
    Ok(FileData {
        text: decode_text(bytes),
        mtime: mtime_secs(p),
    })
}

#[tauri::command]
fn write_file(path: String, text: String) -> Result<(), String> {
    fs::write(&path, text).map_err(|e| format!("写入失败: {e}"))
}

#[tauri::command]
fn dialog_open_file() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("打开 Markdown 文件")
        .add_filter("Markdown / 文本", &["md", "markdown", "mdown", "mkd", "txt"])
        .add_filter("所有文件", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_export(default_name: String, content: String) -> Option<String> {
    let target = rfd::FileDialog::new()
        .set_title("导出为 HTML")
        .set_file_name(&default_name)
        .add_filter("HTML 文件", &["html"])
        .save_file()?;
    fs::write(&target, content).ok()?;
    Some(target.to_string_lossy().into_owned())
}

/// 把 href 安全地拼到 base 目录下：只接受相对路径，逐段消解 `..`
fn sanitize_join(base: &Path, href: &str) -> Option<PathBuf> {
    let href = href.split(['#', '?']).next()?.trim();
    if href.is_empty() || href.contains(':') {
        return None;
    }
    let mut p = base.to_path_buf();
    for part in href.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => p = p.parent()?.to_path_buf(),
            s => p.push(s),
        }
    }
    Some(p)
}

/// 解析文档内相对链接（如 [next](./ch2.md)），文件存在则返回绝对路径
#[tauri::command]
fn resolve_link(current_file: String, href: String) -> Option<String> {
    let base = Path::new(&current_file).parent()?;
    let joined = sanitize_join(base, &href)?;
    let joined = joined.canonicalize().ok()?;
    if joined.is_file() {
        // Windows canonicalize 会带 \\?\ 前缀，去掉以便传给前端/资源协议
        let s = joined.to_string_lossy();
        let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
        Some(s)
    } else {
        None
    }
}

/// 轮询 mtime 实现磁盘文件变更监听（500ms），跨平台零依赖
#[tauri::command]
fn watch_file(app: tauri::AppHandle, path: String, mtime: u64) {
    let gen = WATCH_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let mut last = mtime;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            if WATCH_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            let now = mtime_secs(Path::new(&path));
            if now != last {
                last = now;
                let _ = app.emit("file-changed", path.clone());
            }
        }
    });
}

#[tauri::command]
fn stop_watch() {
    WATCH_GEN.fetch_add(1, Ordering::SeqCst);
}

/// 仅允许 http/https 外链，交给系统默认浏览器打开
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("仅允许打开 http/https 链接: {url}"));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 在系统文件管理器中显示当前文件
#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(dir) = Path::new(&path).parent() {
            std::process::Command::new("xdg-open")
                .arg(dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 取出（并清空）待打开的文档路径；规避单实例回调早于前端监听的竞态
#[tauri::command]
fn take_startup_file(state: tauri::State<'_, StartupPath>) -> Option<String> {
    state.0.lock().unwrap().take()
}

fn md_from_argv<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    const EXTS: [&str; 5] = ["md", "markdown", "mdown", "mkd", "txt"];
    args.into_iter().skip(1).find(|a| {
        let ext = Path::new(a)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        EXTS.contains(&ext.as_str()) && Path::new(a).is_file()
    })
}

fn main() {
    let startup = md_from_argv(std::env::args());

    tauri::Builder::default()
        .manage(StartupPath(Mutex::new(startup)))
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(p) = md_from_argv(argv.iter().cloned()) {
                *app.state::<StartupPath>().0.lock().unwrap() = Some(p);
            }
            let _ = app.emit("open-path", ());
        }))
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            dialog_open_file,
            save_export,
            resolve_link,
            watch_file,
            stop_watch,
            open_external,
            reveal_in_folder,
            take_startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running MDLite");
}
