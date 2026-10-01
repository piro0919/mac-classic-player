// Mac Classic Player - メインアプリケーションロジック
// Tauriプラグインの初期化、メニュー構築、ファイルオープンイベント処理を行う

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager, RunEvent,
};
use tauri_plugin_fs::FsExt;
use tauri_plugin_updater::UpdaterExt;

/// ポイズンしたMutexからも値を取り戻してロックする
///
/// ポイズン＝以前の保持者が更新中にpanicしたということ。ここで守っているのは
/// 開いたファイルのパスと最近使ったファイルの一覧だけなので、もう一度panicして
/// プレイヤーごと落とすより、記録を残して復旧した値で続けるほうが実害が小さい。
fn lock_through_poison<'a, T>(m: &'a Mutex<T>, what: &str) -> std::sync::MutexGuard<'a, T> {
    m.lock().unwrap_or_else(|poisoned| {
        eprintln!("[state] {what} のMutexがポイズンしています。復旧した値で続行します");
        poisoned.into_inner()
    })
}

/// ユーザーが明示的に開いたファイルだけを、fsプラグインとストリーミングサーバーに許可する
///
/// capabilitiesには静的なscopeを置いていない。フロントエンドが読めるのは、
/// ダイアログ・Finderの「このアプリケーションで開く」・最近使ったファイル・
/// ドラッグ&ドロップでユーザーが選んだファイルだけ（ドラッグ&ドロップ分は
/// fsプラグインが自分でscopeに足すので、ここではストリーミング側だけ足す）。
fn allow_opened_paths<R: tauri::Runtime, M: Manager<R>>(manager: &M, paths: &[String]) {
    let scope = manager.fs_scope();
    let stream = manager.try_state::<StreamServer>();
    for p in paths {
        let path = Path::new(p);
        let _ = scope.allow_file(path);
        if let Some(stream) = &stream {
            stream.access.allow(path);
        }
    }
}

// =============================================================================
// アプリ状態の定義
// =============================================================================

/// macOSの「ファイルで開く」イベントで受け取ったファイルパスを一時保存する
struct OpenedFiles(Mutex<Vec<String>>);

/// ローカルストリーミングサーバー
/// 大容量メディアファイルをRange request対応のHTTPで配信する
struct StreamServer {
    port: u16,
    access: Arc<StreamAccess>,
}

/// ストリーミングサーバーへのアクセス制御
///
/// ポートは同じマシン上のどのプロセスやWebページからも叩けるので、
/// 推測できないトークンをURLに含め、ユーザーが開いたファイルだけを配信する。
struct StreamAccess {
    token: String,
    /// 正規化済み（シンボリックリンクと `..` を解決した）パス
    allowed: Mutex<HashSet<PathBuf>>,
}

impl StreamAccess {
    fn new(token: String) -> Self {
        Self {
            token,
            allowed: Mutex::new(HashSet::new()),
        }
    }

    /// 開いたファイルを配信対象に加える。存在しないパスは加えない
    fn allow(&self, path: &Path) {
        if let Ok(canonical) = std::fs::canonicalize(path) {
            lock_through_poison(&self.allowed, "stream_allowed").insert(canonical);
        }
    }

    /// 配信してよいファイルなら正規化済みのパスを返す
    fn resolve(&self, path: &Path) -> Option<PathBuf> {
        let canonical = std::fs::canonicalize(path).ok()?;
        lock_through_poison(&self.allowed, "stream_allowed")
            .contains(&canonical)
            .then_some(canonical)
    }

    /// トークンを比較する。一致までの時間で中身を推測されないよう全バイトを見る
    fn token_matches(&self, candidate: &str) -> bool {
        let (a, b) = (self.token.as_bytes(), candidate.as_bytes());
        if a.len() != b.len() {
            return false;
        }
        a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
    }
}

/// 32バイトの乱数を16進文字列にしたトークンを作る
fn generate_stream_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("乱数の取得に失敗");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// ストリーミング再生用のURLを組み立てる
/// パスは `/` も含めて丸ごとエンコードし、トークンの後ろの1セグメントに収める
fn stream_url(port: u16, token: &str, path: &str) -> String {
    format!(
        "http://127.0.0.1:{port}/{token}/{}",
        urlencoding::encode(path)
    )
}

/// 最近使ったファイルの最大保持数
const MAX_RECENT_FILES: usize = 10;

/// 最近使ったファイルの永続化データ
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct RecentFilesData {
    paths: Vec<String>,
}

/// 最近使ったファイルの一覧に新しいパスを取り込む
///
/// 既にある同じパスは取り除いてから先頭に入れ直すので、開き直したものが常に
/// 一番上に来る。`new_paths` を逆順に回すのは、まとめて渡された並びをそのまま
/// 先頭に再現するため。最後に `MAX_RECENT_FILES` で打ち切る。
fn merge_recent(paths: &mut Vec<String>, new_paths: &[String]) {
    for path in new_paths.iter().rev() {
        paths.retain(|p| p != path);
        paths.insert(0, path.clone());
    }
    paths.truncate(MAX_RECENT_FILES);
}

/// 最近使ったファイルの状態管理
struct RecentFiles {
    data: Mutex<RecentFilesData>,
    config_path: PathBuf,
    is_japanese: bool,
}

impl RecentFiles {
    /// 設定ディレクトリからJSONを読み込んで初期化する
    fn load(config_dir: &std::path::Path, is_japanese: bool) -> Self {
        let config_path = config_dir.join("recent_files.json");
        let data = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str::<RecentFilesData>(&s).ok())
            .unwrap_or_default();
        Self {
            data: Mutex::new(data),
            config_path,
            is_japanese,
        }
    }

    /// パスを追加（重複は先頭に移動、最大件数でtruncate）
    fn add_paths(&self, new_paths: &[String]) {
        let mut data = lock_through_poison(&self.data, "recent_files");
        merge_recent(&mut data.paths, new_paths);
        self.save_to_disk(&data);
    }

    /// 履歴をクリアする
    fn clear(&self) {
        let mut data = lock_through_poison(&self.data, "recent_files");
        data.paths.clear();
        self.save_to_disk(&data);
    }

    /// 現在のパスリストを取得
    fn get_paths(&self) -> Vec<String> {
        lock_through_poison(&self.data, "recent_files")
            .paths
            .clone()
    }

    /// JSONファイルに保存
    fn save_to_disk(&self, data: &RecentFilesData) {
        if let Some(parent) = self.config_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(data) {
            let _ = std::fs::write(&self.config_path, json);
        }
    }
}

// =============================================================================
// Tauriコマンド: フロントエンドから呼び出し可能な関数
// =============================================================================

/// フロントエンドの準備完了時に、保留中のファイルパスを取得する
#[tauri::command]
fn get_pending_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
    let mut files = lock_through_poison(&state.0, "opened_files");
    let result = files.clone();
    files.clear();
    result
}

/// 開いたファイルのストリーミング用URLを返す
/// ユーザーが開いていないファイルにはURLを発行しない
#[tauri::command]
fn get_stream_url(state: tauri::State<StreamServer>, path: String) -> Result<String, String> {
    if state.access.resolve(Path::new(&path)).is_none() {
        return Err("このファイルは開かれていません".to_string());
    }
    Ok(stream_url(state.port, &state.access.token, &path))
}

/// フロントエンドからファイルパスを最近使ったファイルに追加する
/// （ドラッグ&ドロップなど、Rust側でパスを取得できないケース用）
#[tauri::command]
fn add_recent_files(app: tauri::AppHandle, paths: Vec<String>) {
    if let Some(recent) = app.try_state::<RecentFiles>() {
        recent.add_paths(&paths);
    }
    rebuild_menu(&app);
}

// =============================================================================
// ローカルストリーミングサーバー
// WKWebViewのカスタムスキームは<video>のRange requestを転送しないため、
// 通常のHTTPサーバーで大容量メディアファイルを配信する
// =============================================================================

/// ストリーミングサーバーを起動し、ポート番号を返す
fn start_stream_server(access: Arc<StreamAccess>) -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();

    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let access = Arc::clone(&access);
            std::thread::spawn(move || {
                handle_stream_connection(stream, &access);
            });
        }
    });

    Ok(port)
}

/// 本文なしの応答を返す
fn write_empty_response(stream: &mut std::net::TcpStream, status: &str, extra_headers: &str) {
    let _ = stream.write_all(
        format!("HTTP/1.1 {status}\r\n{extra_headers}Content-Length: 0\r\nConnection: close\r\n\r\n")
            .as_bytes(),
    );
}

/// リクエストターゲット `/{token}/{エンコード済みパス}` を検証し、配信するファイルを決める
///
/// トークンが無い・違うときは 403、開かれていないファイルは 404。
/// 存在しないファイルと許可されていないファイルは区別しない。
fn authorize_target(target: &str, access: &StreamAccess) -> Result<PathBuf, &'static str> {
    let target = target.split('?').next().unwrap_or("");
    let rest = target.strip_prefix('/').ok_or("403 Forbidden")?;
    let (token, encoded_path) = rest.split_once('/').ok_or("403 Forbidden")?;
    if !access.token_matches(token) {
        return Err("403 Forbidden");
    }
    let path = urlencoding::decode(encoded_path).map_err(|_| "404 Not Found")?;
    access
        .resolve(Path::new(path.as_ref()))
        .ok_or("404 Not Found")
}

/// `Range:` ヘッダーの値を、配信するファイルのサイズに突き合わせて解決する
///
/// 返すのは送信すべき範囲（両端を含む）。満たせない要求のときは `None` を返し、
/// 呼び出し側が 416 を返す。ブラウザが実際に送ってくる3つの形に対応する。
///
/// - `bytes=START-END` — END がファイル末尾を超えていれば末尾に丸める
/// - `bytes=START-` — START から末尾まで
/// - `bytes=-N` — 末尾 N バイト
///
/// 空のファイル、末尾を越えた START、START より小さい END は満たせないので
/// `None`。ここを素通しにすると `end - start + 1` や `file_size - 1` が u64 の
/// 引き算で破綻する。
fn resolve_range(range_str: &str, file_size: u64) -> Option<(u64, u64)> {
    if file_size == 0 {
        return None;
    }
    let last = file_size - 1;
    let spec = range_str.trim().strip_prefix("bytes=")?;
    // 複数範囲の要求は先頭の1つだけを配信する
    let spec = spec.split(',').next()?.trim();
    let (start_str, end_str) = spec.split_once('-')?;
    let (start_str, end_str) = (start_str.trim(), end_str.trim());

    // 末尾から数える形
    if start_str.is_empty() {
        let n: u64 = end_str.parse().ok()?;
        if n == 0 {
            return None;
        }
        return Some((file_size.saturating_sub(n), last));
    }

    let start: u64 = start_str.parse().ok()?;
    if start > last {
        return None;
    }
    let end = if end_str.is_empty() {
        last
    } else {
        end_str.parse::<u64>().ok()?.min(last)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

/// HTTP接続を処理してファイルをストリーミング配信する
///
/// `<video>` は crossorigin なしで読み込むのでCORSヘッダーは付けない。
/// 付けると他のオリジンのページからも中身を読めてしまう。
fn handle_stream_connection(mut stream: std::net::TcpStream, access: &StreamAccess) {
    let reader_stream = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut reader = BufReader::new(reader_stream);

    // リクエスト行を読み取る (例: GET /{token}/{path} HTTP/1.1)
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        write_empty_response(&mut stream, "400 Bad Request", "");
        return;
    }

    // ヘッダーを読み取り、Range headerを探す
    let mut range_header = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        if line.to_lowercase().starts_with("range:") {
            range_header = Some(line.split_once(':').unwrap_or(("", "")).1.trim().to_string());
        }
    }

    if parts[0] != "GET" {
        write_empty_response(&mut stream, "405 Method Not Allowed", "Allow: GET\r\n");
        return;
    }

    let path = match authorize_target(parts[1], access) {
        Ok(p) => p,
        Err(status) => {
            write_empty_response(&mut stream, status, "");
            return;
        }
    };

    // ファイルを開く
    let mut file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => {
            write_empty_response(&mut stream, "404 Not Found", "");
            return;
        }
    };
    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);

    // MIMEタイプを拡張子から判定
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let content_type = match ext.as_str() {
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };

    if let Some(range_str) = range_header {
        // Range requestの処理 (例: bytes=0-1048575)
        let Some((start, end)) = resolve_range(&range_str, file_size) else {
            write_empty_response(
                &mut stream,
                "416 Range Not Satisfiable",
                &format!("Content-Range: bytes */{file_size}\r\n"),
            );
            return;
        };
        let length = end - start + 1;

        let _ = file.seek(SeekFrom::Start(start));
        let header = format!(
            "HTTP/1.1 206 Partial Content\r\n\
             Content-Type: {content_type}\r\n\
             Content-Range: bytes {start}-{end}/{file_size}\r\n\
             Content-Length: {length}\r\n\
             Accept-Ranges: bytes\r\n\
             Connection: close\r\n\
             \r\n"
        );
        let _ = stream.write_all(header.as_bytes());
        stream_file_bytes(&mut file, &mut stream, length);
    } else {
        // Range headerなし: ファイル全体を配信
        let header = format!(
            "HTTP/1.1 200 OK\r\n\
             Content-Type: {content_type}\r\n\
             Content-Length: {file_size}\r\n\
             Accept-Ranges: bytes\r\n\
             Connection: close\r\n\
             \r\n"
        );
        let _ = stream.write_all(header.as_bytes());
        stream_file_bytes(&mut file, &mut stream, file_size);
    }
}

/// ファイルを64KBチャンクでストリーミング送信する（メモリ効率が良い）
fn stream_file_bytes(
    file: &mut std::fs::File,
    stream: &mut std::net::TcpStream,
    mut remaining: u64,
) {
    let mut buf = [0u8; 65536];
    while remaining > 0 {
        let to_read = std::cmp::min(remaining as usize, buf.len());
        match file.read(&mut buf[..to_read]) {
            Ok(0) => break,
            Ok(n) => {
                if stream.write_all(&buf[..n]).is_err() {
                    break;
                }
                remaining -= n as u64;
            }
            Err(_) => break,
        }
    }
}

// =============================================================================
// メニュー構築
// システムの言語設定に応じて日本語/英語のメニューを構築する
// =============================================================================

/// アプリケーションのメニューバーを構築する
fn build_app_menu(
    app: &tauri::AppHandle,
    is_japanese: bool,
    recent_paths: &[String],
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // --- アプリメニュー ---
    let quit_text = if is_japanese {
        "Mac Classic Player を終了"
    } else {
        "Quit Mac Classic Player"
    };
    let version = app.package_info().version.to_string();
    let about_metadata = AboutMetadata {
        name: Some("Mac Classic Player".to_string()),
        version: Some(version),
        ..Default::default()
    };
    let about_text = if is_japanese {
        "Mac Classic Player について"
    } else {
        "About Mac Classic Player"
    };
    let services_text = if is_japanese {
        "サービス"
    } else {
        "Services"
    };
    let hide_text = if is_japanese {
        "Mac Classic Player を隠す"
    } else {
        "Hide Mac Classic Player"
    };
    let hide_others_text = if is_japanese {
        "その他を隠す"
    } else {
        "Hide Others"
    };
    let show_all_text = if is_japanese {
        "すべて表示"
    } else {
        "Show All"
    };
    let app_menu = SubmenuBuilder::new(app, "Mac Classic Player")
        .item(&PredefinedMenuItem::about(app, Some(about_text), Some(about_metadata))?)
        .separator()
        .item(
            &SubmenuBuilder::new(app, services_text)
                .services()
                .build()?,
        )
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(hide_text))?)
        .item(&PredefinedMenuItem::hide_others(app, Some(hide_others_text))?)
        .item(&PredefinedMenuItem::show_all(app, Some(show_all_text))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(quit_text))?)
        .build()?;

    // --- ファイルメニュー ---
    let file_label = if is_japanese { "ファイル" } else { "File" };
    let open_label = if is_japanese {
        "ファイルを開く…"
    } else {
        "Open File…"
    };
    let open_item = MenuItemBuilder::with_id("open_file", open_label)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    // 「最近使ったファイル」サブメニュー
    let recent_label = if is_japanese {
        "最近使ったファイル"
    } else {
        "Recent Files"
    };
    let mut recent_submenu = SubmenuBuilder::new(app, recent_label);
    if recent_paths.is_empty() {
        let empty_label = if is_japanese { "(なし)" } else { "(None)" };
        let empty_item = MenuItemBuilder::with_id("recent_empty", empty_label)
            .enabled(false)
            .build(app)?;
        recent_submenu = recent_submenu.item(&empty_item);
    } else {
        for (i, path) in recent_paths.iter().enumerate() {
            let label = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path);
            let item = MenuItemBuilder::with_id(format!("recent_{}", i), label).build(app)?;
            recent_submenu = recent_submenu.item(&item);
        }
        let clear_label = if is_japanese {
            "履歴をクリア"
        } else {
            "Clear History"
        };
        let clear_item = MenuItemBuilder::with_id("clear_recent", clear_label).build(app)?;
        recent_submenu = recent_submenu.separator().item(&clear_item);
    }
    let recent_menu = recent_submenu.build()?;

    let close_text = if is_japanese {
        "ウインドウを閉じる"
    } else {
        "Close Window"
    };
    let file_menu = SubmenuBuilder::new(app, file_label)
        .item(&open_item)
        .item(&recent_menu)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some(close_text))?)
        .build()?;

    // --- ウインドウメニュー ---
    let window_label = if is_japanese {
        "ウインドウ"
    } else {
        "Window"
    };
    let minimize_text = if is_japanese { "しまう" } else { "Minimize" };
    let zoom_text = if is_japanese {
        "拡大/縮小"
    } else {
        "Zoom"
    };
    let fullscreen_text = if is_japanese {
        "フルスクリーンにする"
    } else {
        "Enter Full Screen"
    };
    let window_menu = SubmenuBuilder::new(app, window_label)
        .item(&PredefinedMenuItem::minimize(app, Some(minimize_text))?)
        .item(&PredefinedMenuItem::maximize(app, Some(zoom_text))?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some(fullscreen_text))?)
        .build()?;

    // --- ヘルプメニュー ---
    let help_label = if is_japanese { "ヘルプ" } else { "Help" };
    let shortcuts_label = if is_japanese {
        "ショートカット一覧を表示"
    } else {
        "Show Shortcuts Help"
    };
    let shortcuts_item = MenuItemBuilder::with_id("toggle_help", shortcuts_label)
        .accelerator("?")
        .build(app)?;
    let github_item = MenuItemBuilder::with_id("open_github", "GitHub").build(app)?;

    let help_menu = SubmenuBuilder::new(app, help_label)
        .item(&shortcuts_item)
        .separator()
        .item(&github_item)
        .build()?;

    // --- メニューバー全体を構築 ---
    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &window_menu, &help_menu])
        .build()
}

/// RecentFilesの状態からメニューを再構築してセットする
fn rebuild_menu(app_handle: &tauri::AppHandle) {
    if let Some(recent) = app_handle.try_state::<RecentFiles>() {
        let paths = recent.get_paths();
        if let Ok(menu) = build_app_menu(app_handle, recent.is_japanese, &paths) {
            let _ = app_handle.set_menu(menu);
        }
    }
}

// =============================================================================
// メインのrun関数
// アプリケーションの初期化と実行を行う
// =============================================================================
pub fn run() {
    // ストリーミングサーバーを起動
    let stream_access = Arc::new(StreamAccess::new(generate_stream_token()));
    let stream_port =
        start_stream_server(Arc::clone(&stream_access)).expect("ストリーミングサーバーの起動に失敗");

    // アプリビルダーの設定
    let app = tauri::Builder::default()
        // --- プラグインの登録 ---
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // ウィンドウの位置を自動的に保存・復元するプラグイン
        // SIZE はRetinaで2倍になるバグがあるためJSで手動管理する
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::VISIBLE
                        | tauri_plugin_window_state::StateFlags::DECORATIONS
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        // アップデーターのプラグイン
        .plugin(tauri_plugin_updater::Builder::new().build())
        // --- アプリ状態の管理 ---
        .manage(OpenedFiles(Mutex::new(Vec::new())))
        .manage(StreamServer {
            port: stream_port,
            access: stream_access,
        })
        // --- Tauriコマンドの登録 ---
        .invoke_handler(tauri::generate_handler![get_pending_files, get_stream_url, add_recent_files])
        // --- アプリのセットアップ ---
        .setup(|app| {
            // システムの言語設定を取得して日本語かどうか判定
            let locale = sys_locale::get_locale().unwrap_or_else(|| "en".to_string());
            let is_japanese = locale.starts_with("ja");

            // 最近使ったファイルの読み込みと状態登録
            let config_dir = app.path().app_config_dir()?;
            let recent_files = RecentFiles::load(&config_dir, is_japanese);
            let recent_paths = recent_files.get_paths();
            app.manage(recent_files);

            // メニューの構築と設定
            let menu = build_app_menu(app.handle(), is_japanese, &recent_paths)?;
            app.set_menu(menu)?;

            // ファイルダイアログ用のフィルター名を事前に用意
            let filter_name = if is_japanese {
                "メディアファイル"
            } else {
                "Media Files"
            };
            let filter_name = filter_name.to_string();

            // メニューイベントのハンドラー
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().0.as_str();
                match id {
                    "open_file" => {
                        // ファイルダイアログを開く
                        let handle = app_handle.clone();
                        let filter = filter_name.clone();
                        tauri::async_runtime::spawn(async move {
                            use tauri_plugin_dialog::DialogExt;
                            let file_response = handle
                                .dialog()
                                .file()
                                .add_filter(
                                    &filter,
                                    &["mp4", "mp3", "mov", "m4a", "wav"],
                                )
                                .blocking_pick_files();

                            if let Some(files) = file_response {
                                let paths: Vec<String> = files
                                    .iter()
                                    .filter_map(|f| {
                                        f.as_path()
                                            .and_then(|p| p.to_str().map(|s| s.to_string()))
                                    })
                                    .collect();
                                if !paths.is_empty() {
                                    allow_opened_paths(&handle, &paths);
                                    // フロントエンドにファイルパスを送信
                                    let _ = handle.emit("open-file", &paths);
                                    // 最近使ったファイルに追加
                                    if let Some(recent) = handle.try_state::<RecentFiles>() {
                                        recent.add_paths(&paths);
                                    }
                                    rebuild_menu(&handle);
                                }
                            }
                        });
                    }
                    "clear_recent" => {
                        // 最近使ったファイルの履歴をクリア
                        if let Some(recent) = app_handle.try_state::<RecentFiles>() {
                            recent.clear();
                        }
                        rebuild_menu(&app_handle);
                    }
                    "toggle_help" => {
                        // ヘルプ表示のトグルをフロントエンドに送信
                        let _ = app_handle.emit("toggle-help", ());
                    }
                    "open_github" => {
                        // GitHubページを外部ブラウザで開く
                        let _ = tauri_plugin_opener::OpenerExt::opener(&app_handle)
                            .open_url(
                                "https://github.com/piro0919/mac-classic-player",
                                None::<&str>,
                            );
                    }
                    _ => {
                        // 最近使ったファイルのクリックハンドラ (recent_0, recent_1, ...)
                        if let Some(index_str) = id.strip_prefix("recent_") {
                            if let Ok(index) = index_str.parse::<usize>() {
                                if let Some(recent) = app_handle.try_state::<RecentFiles>() {
                                    let paths = recent.get_paths();
                                    if let Some(path) = paths.get(index) {
                                        let path_vec = vec![path.clone()];
                                        allow_opened_paths(&app_handle, &path_vec);
                                        let _ = app_handle.emit("open-file", &path_vec);
                                        recent.add_paths(&path_vec);
                                        rebuild_menu(&app_handle);
                                    }
                                }
                            }
                        }
                    }
                }
            });

            // アップデートの確認（バックグラウンドで実行）
            let update_handle = app.handle().clone();
            let is_ja = is_japanese;
            tauri::async_runtime::spawn(async move {
                let updater = match update_handle.updater() {
                    Ok(u) => u,
                    Err(_) => return,
                };
                let update = match updater.check().await {
                    Ok(Some(u)) => u,
                    _ => return,
                };

                // ユーザーにアップデートを確認するダイアログを表示
                use tauri_plugin_dialog::DialogExt;
                let msg = if is_ja {
                    format!(
                        "新しいバージョン v{} が利用可能です。\nアップデートしますか？",
                        update.version
                    )
                } else {
                    format!(
                        "Version v{} is available.\nWould you like to update?",
                        update.version
                    )
                };
                let title = if is_ja { "アップデート" } else { "Update" };
                use tauri_plugin_dialog::MessageDialogButtons;
                let cancel_label = if is_ja { "キャンセル" } else { "Cancel" };
                let confirmed = update_handle
                    .dialog()
                    .message(msg)
                    .title(title)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "OK".to_string(),
                        cancel_label.to_string(),
                    ))
                    .blocking_show();

                if !confirmed {
                    return;
                }

                // ダウンロードを実行（インストールと分離してエラーを特定しやすくする）
                eprintln!("[updater] ダウンロード開始: v{}", update.version);
                let bytes = match update.download(|chunk_len, total| {
                    eprintln!("[updater] ダウンロード中: {} / {:?} bytes", chunk_len, total);
                }, || {
                    eprintln!("[updater] ダウンロード完了");
                }).await {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[updater] ダウンロードエラー: {}", e);
                        let err_msg = if is_ja {
                            format!("ダウンロードに失敗しました。\n{}", e)
                        } else {
                            format!("Download failed.\n{}", e)
                        };
                        update_handle
                            .dialog()
                            .message(err_msg)
                            .title(title)
                            .blocking_show();
                        return;
                    }
                };

                // インストールを実行
                eprintln!("[updater] インストール開始 ({} bytes)", bytes.len());
                match update.install(bytes) {
                    Ok(_) => {
                        eprintln!("[updater] インストール成功");
                        // インストール完了を通知し、アプリを終了する
                        // （macOSではAppHandle::restart()が正常に動作しないため手動再起動）
                        let done_msg = if is_ja {
                            "アップデートが完了しました。\nアプリを再起動してください。"
                        } else {
                            "Update complete.\nPlease restart the app."
                        };
                        update_handle
                            .dialog()
                            .message(done_msg)
                            .title(title)
                            .blocking_show();
                        update_handle.exit(0);
                    }
                    Err(e) => {
                        eprintln!("[updater] インストールエラー: {}", e);
                        let err_msg = if is_ja {
                            format!("インストールに失敗しました。\n{}", e)
                        } else {
                            format!("Installation failed.\n{}", e)
                        };
                        update_handle
                            .dialog()
                            .message(err_msg)
                            .title(title)
                            .blocking_show();
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("アプリケーションの構築に失敗しました");

    // --- アプリケーションの実行とイベントハンドリング ---
    app.run(|app_handle, event| {
        // ドラッグ&ドロップされたファイルもストリーミング配信の対象にする
        // （fsプラグイン側のscopeはプラグイン自身が追加する）
        if let RunEvent::WindowEvent {
            event: tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }),
            ..
        } = &event
        {
            if let Some(stream) = app_handle.try_state::<StreamServer>() {
                for path in paths {
                    stream.access.allow(path);
                }
            }
            return;
        }

        if let RunEvent::Opened { urls } = event {
            // macOSの「ファイルで開く」イベント
            // Finderからのダブルクリックや「このアプリケーションで開く」で発火する
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter_map(|p| p.to_str().map(|s| s.to_string()))
                .collect();

            if paths.is_empty() {
                return;
            }

            allow_opened_paths(app_handle, &paths);

            // 最近使ったファイルに追加
            if let Some(recent) = app_handle.try_state::<RecentFiles>() {
                recent.add_paths(&paths);
            }
            rebuild_menu(app_handle);

            // メインウィンドウが存在するか確認
            if let Some(window) = app_handle.get_webview_window("main") {
                // ウィンドウが存在する場合、直接フロントエンドにイベントを送信
                let _ = window.emit("open-file", &paths);
            } else {
                // ウィンドウがまだ準備できていない場合、保留リストに追加
                if let Some(state) = app_handle.try_state::<OpenedFiles>() {
                    let mut files = lock_through_poison(&state.0, "opened_files");
                    files.extend(paths);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Range ヘッダーの解決 ---

    #[test]
    fn a_plain_range_passes_through() {
        assert_eq!(resolve_range("bytes=0-1023", 4096), Some((0, 1023)));
        assert_eq!(resolve_range("bytes=1024-2047", 4096), Some((1024, 2047)));
    }

    #[test]
    fn an_open_ended_range_runs_to_the_last_byte() {
        assert_eq!(resolve_range("bytes=1000-", 4096), Some((1000, 4095)));
    }

    #[test]
    fn an_end_past_eof_is_clamped() {
        // シーク中のプレイヤーが大きめの終端を投げてくることがある。
        // 丸めないとContent-Lengthと実データが食い違う。
        assert_eq!(resolve_range("bytes=0-999999", 4096), Some((0, 4095)));
    }

    #[test]
    fn a_suffix_range_counts_back_from_the_end() {
        assert_eq!(resolve_range("bytes=-500", 4096), Some((3596, 4095)));
    }

    #[test]
    fn a_suffix_larger_than_the_file_covers_all_of_it() {
        assert_eq!(resolve_range("bytes=-99999", 4096), Some((0, 4095)));
    }

    #[test]
    fn an_empty_file_satisfies_no_range() {
        // ここを素通しにすると file_size - 1 が u64 で破綻する
        assert_eq!(resolve_range("bytes=0-", 0), None);
        assert_eq!(resolve_range("bytes=0-100", 0), None);
    }

    #[test]
    fn a_start_past_eof_is_unsatisfiable() {
        assert_eq!(resolve_range("bytes=4096-5000", 4096), None);
    }

    #[test]
    fn an_end_below_the_start_is_unsatisfiable() {
        // ここを素通しにすると end - start + 1 が u64 で破綻する
        assert_eq!(resolve_range("bytes=100-50", 4096), None);
    }

    #[test]
    fn malformed_headers_are_rejected() {
        for spec in [
            "",
            "bytes=",
            "items=0-10",
            "bytes=abc-def",
            "bytes=0",
            "bytes=-0",
        ] {
            assert_eq!(resolve_range(spec, 4096), None, "{spec} は拒否されるべき");
        }
    }

    #[test]
    fn only_the_first_of_a_multi_range_request_is_served() {
        assert_eq!(resolve_range("bytes=0-99, 200-299", 4096), Some((0, 99)));
    }

    #[test]
    fn surrounding_whitespace_is_ignored() {
        assert_eq!(resolve_range("  bytes= 10 - 20 ", 4096), Some((10, 20)));
    }

    #[test]
    fn a_one_byte_file_can_be_requested_whole() {
        assert_eq!(resolve_range("bytes=0-0", 1), Some((0, 0)));
    }

    // --- ストリーミングサーバーのアクセス制御 ---

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    /// テストごとに別名の一時ファイルを作る（0..=255 の繰り返し）
    fn temp_media(name: &str, len: usize) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mcp-stream-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let bytes: Vec<u8> = (0..len).map(|i| (i % 256) as u8).collect();
        std::fs::write(&path, bytes).unwrap();
        path
    }

    /// サーバーを立ち上げ、`allowed` だけを開いた状態にする
    fn serve(allowed: &[&Path]) -> u16 {
        let access = Arc::new(StreamAccess::new(TOKEN.to_string()));
        for p in allowed {
            access.allow(p);
        }
        start_stream_server(access).unwrap()
    }

    /// 生のリクエストを送り、ヘッダーと本文に分けて返す
    fn send(port: u16, request: &str) -> (String, Vec<u8>) {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        let split = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&raw[..split]).to_string();
        (head, raw[split + 4..].to_vec())
    }

    fn get(port: u16, target: &str, range: Option<&str>) -> (String, Vec<u8>) {
        let range = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
        send(
            port,
            &format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n{range}\r\n"),
        )
    }

    fn target(token: &str, path: &Path) -> String {
        format!("/{token}/{}", urlencoding::encode(path.to_str().unwrap()))
    }

    #[test]
    fn an_opened_file_is_served_with_range() {
        let file = temp_media("opened.mp4", 4096);
        let port = serve(&[&file]);
        let (head, body) = get(port, &target(TOKEN, &file), Some("bytes=10-19"));
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
        assert!(head.contains("Content-Range: bytes 10-19/4096"), "{head}");
        assert!(head.contains("Content-Type: video/mp4"), "{head}");
        assert_eq!(body, (10u8..20).collect::<Vec<u8>>());
        // どのオリジンからでも読めるようにするヘッダーは付けない
        assert!(!head.to_lowercase().contains("access-control-allow-origin"), "{head}");
    }

    #[test]
    fn an_opened_file_is_served_whole_without_range() {
        let file = temp_media("whole.mp3", 300);
        let port = serve(&[&file]);
        let (head, body) = get(port, &target(TOKEN, &file), None);
        assert!(head.starts_with("HTTP/1.1 200"), "{head}");
        assert_eq!(body.len(), 300);
    }

    #[test]
    fn the_url_built_for_the_frontend_is_accepted() {
        let file = temp_media("名前 に 空白 #1.mov", 64);
        let port = serve(&[&file]);
        let url = stream_url(port, TOKEN, file.to_str().unwrap());
        let path_part = url.split_once(&format!("127.0.0.1:{port}")).unwrap().1;
        let (head, _) = get(port, path_part, Some("bytes=0-"));
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
    }

    #[test]
    fn a_file_that_was_not_opened_is_rejected() {
        let opened = temp_media("allowed.mp4", 64);
        let other = temp_media("secret.mp4", 64);
        let port = serve(&[&opened]);
        let (head, body) = get(port, &target(TOKEN, &other), None);
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
        assert!(body.is_empty());
        let (head, _) = get(port, &target(TOKEN, Path::new("/etc/passwd")), None);
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
    }

    #[test]
    fn dot_dot_cannot_escape_an_opened_file() {
        let opened = temp_media("trav.mp4", 64);
        let other = temp_media("trav-secret.mp4", 64);
        let port = serve(&[&opened]);
        // allowed のディレクトリを経由して別ファイルを指す
        let sneaky = opened
            .parent()
            .unwrap()
            .join("..")
            .join(other.parent().unwrap().file_name().unwrap())
            .join("trav-secret.mp4");
        let (head, _) = get(port, &target(TOKEN, &sneaky), None);
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
    }

    #[test]
    fn a_missing_token_is_rejected() {
        let file = temp_media("notoken.mp4", 64);
        let port = serve(&[&file]);
        let encoded = urlencoding::encode(file.to_str().unwrap()).to_string();
        // 以前の形式（パスを直接置く）も、トークンが空のものも通さない
        for t in [
            file.to_str().unwrap().to_string(),
            format!("/{encoded}"),
            format!("//{encoded}"),
            "/".to_string(),
        ] {
            let (head, _) = get(port, &t, Some("bytes=0-9"));
            assert!(head.starts_with("HTTP/1.1 403"), "{t}: {head}");
        }
    }

    #[test]
    fn a_wrong_token_is_rejected() {
        let file = temp_media("wrongtoken.mp4", 64);
        let port = serve(&[&file]);
        let wrong = TOKEN.replace('0', "1");
        let (head, _) = get(port, &target(&wrong, &file), Some("bytes=0-9"));
        assert!(head.starts_with("HTTP/1.1 403"), "{head}");
        let (head, _) = get(port, &target(&TOKEN[..10], &file), None);
        assert!(head.starts_with("HTTP/1.1 403"), "{head}");
    }

    #[test]
    fn methods_other_than_get_are_rejected() {
        let file = temp_media("post.mp4", 64);
        let port = serve(&[&file]);
        for method in ["POST", "PUT", "DELETE", "OPTIONS"] {
            let (head, body) = send(
                port,
                &format!("{method} {} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n", target(TOKEN, &file)),
            );
            assert!(head.starts_with("HTTP/1.1 405"), "{method}: {head}");
            assert!(body.is_empty());
        }
    }

    #[test]
    fn an_unsatisfiable_range_gets_416() {
        let file = temp_media("range416.mp4", 64);
        let port = serve(&[&file]);
        let (head, _) = get(port, &target(TOKEN, &file), Some("bytes=100-200"));
        assert!(head.starts_with("HTTP/1.1 416"), "{head}");
        assert!(head.contains("Content-Range: bytes */64"), "{head}");
    }

    #[test]
    fn generated_tokens_are_long_and_distinct() {
        let (a, b) = (generate_stream_token(), generate_stream_token());
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    // --- 最近使ったファイル ---

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_newly_opened_file_goes_to_the_front() {
        let mut paths = v(&["a.mp4"]);
        merge_recent(&mut paths, &v(&["b.mp4"]));
        assert_eq!(paths, v(&["b.mp4", "a.mp4"]));
    }

    #[test]
    fn reopening_a_file_moves_it_up_without_duplicating() {
        let mut paths = v(&["a.mp4", "b.mp4", "c.mp4"]);
        merge_recent(&mut paths, &v(&["c.mp4"]));
        assert_eq!(paths, v(&["c.mp4", "a.mp4", "b.mp4"]));
    }

    #[test]
    fn a_batch_keeps_its_order_at_the_front() {
        let mut paths = v(&["old.mp4"]);
        merge_recent(&mut paths, &v(&["1.mp4", "2.mp4", "3.mp4"]));
        assert_eq!(paths, v(&["1.mp4", "2.mp4", "3.mp4", "old.mp4"]));
    }

    #[test]
    fn the_oldest_entry_falls_off_at_the_cap() {
        let mut paths: Vec<String> = (0..MAX_RECENT_FILES).map(|i| format!("{i}.mp4")).collect();
        merge_recent(&mut paths, &v(&["new.mp4"]));
        assert_eq!(paths.len(), MAX_RECENT_FILES);
        assert_eq!(paths[0], "new.mp4");
        let last = format!("{}.mp4", MAX_RECENT_FILES - 1);
        assert!(!paths.contains(&last), "一番古いものが残っている");
    }

    #[test]
    fn an_empty_batch_leaves_the_list_alone() {
        let mut paths = v(&["a.mp4", "b.mp4"]);
        merge_recent(&mut paths, &[]);
        assert_eq!(paths, v(&["a.mp4", "b.mp4"]));
    }
}
