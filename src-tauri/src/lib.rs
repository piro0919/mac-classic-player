// Mac Classic Player - メインアプリケーションロジック
// Tauriプラグインの初期化、メニュー構築、ファイルオープンイベント処理を行う

use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager, RunEvent,
};
use tauri_plugin_updater::UpdaterExt;

// =============================================================================
// アプリ状態の定義
// =============================================================================

/// macOSの「ファイルで開く」イベントで受け取ったファイルパスを一時保存する
struct OpenedFiles(Mutex<Vec<String>>);

/// ローカルストリーミングサーバーのポート番号
/// 大容量メディアファイルをRange request対応のHTTPで配信する
struct StreamServerPort(u16);

// =============================================================================
// Tauriコマンド: フロントエンドから呼び出し可能な関数
// =============================================================================

/// フロントエンドの準備完了時に、保留中のファイルパスを取得する
#[tauri::command]
fn get_pending_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
    let mut files = state.0.lock().unwrap();
    let result = files.clone();
    files.clear();
    result
}

/// ストリーミングサーバーのポート番号を返す
#[tauri::command]
fn get_stream_port(state: tauri::State<StreamServerPort>) -> u16 {
    state.0
}

// =============================================================================
// ローカルストリーミングサーバー
// WKWebViewのカスタムスキームは<video>のRange requestを転送しないため、
// 通常のHTTPサーバーで大容量メディアファイルを配信する
// =============================================================================

/// ストリーミングサーバーを起動し、ポート番号を返す
fn start_stream_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("ストリーミングサーバーの起動に失敗");
    let port = listener.local_addr().unwrap().port();

    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                handle_stream_connection(stream);
            });
        }
    });

    port
}

/// HTTP接続を処理してファイルをストリーミング配信する
fn handle_stream_connection(mut stream: std::net::TcpStream) {
    let reader_stream = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut reader = BufReader::new(reader_stream);

    // リクエスト行を読み取る (例: GET /path/to/file HTTP/1.1)
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 || parts[0] != "GET" {
        return;
    }
    let path = urlencoding::decode(parts[1]).unwrap_or_default().to_string();

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

    // ファイルを開く
    let mut file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            return;
        }
    };
    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);

    // MIMEタイプを拡張子から判定
    let content_type = match path.rsplit('.').next().unwrap_or("") {
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };

    if let Some(range_str) = range_header {
        // Range requestの処理 (例: bytes=0-1048575)
        let range = range_str.strip_prefix("bytes=").unwrap_or("");
        let range_parts: Vec<&str> = range.splitn(2, '-').collect();
        let start: u64 = range_parts[0].parse().unwrap_or(0);
        let end: u64 = if range_parts.len() > 1 && !range_parts[1].is_empty() {
            range_parts[1].parse().unwrap_or(file_size - 1)
        } else {
            file_size - 1
        };
        let length = end - start + 1;

        let _ = file.seek(SeekFrom::Start(start));
        let header = format!(
            "HTTP/1.1 206 Partial Content\r\n\
             Content-Type: {content_type}\r\n\
             Content-Range: bytes {start}-{end}/{file_size}\r\n\
             Content-Length: {length}\r\n\
             Accept-Ranges: bytes\r\n\
             Access-Control-Allow-Origin: *\r\n\
             Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
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
             Access-Control-Allow-Origin: *\r\n\
             Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
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
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // --- アプリメニュー (macOSでは最初のサブメニューがアプリ名メニューになる) ---
    let quit_text = if is_japanese {
        "Mac Classic Player を終了"
    } else {
        "Quit Mac Classic Player"
    };
    let app_menu = SubmenuBuilder::new(app, "Mac Classic Player")
        .item(&PredefinedMenuItem::quit(app, Some(quit_text))?)
        .build()?;

    // --- ファイルメニュー ---
    let file_label = if is_japanese { "ファイル" } else { "File" };
    let open_label = if is_japanese {
        "ファイルを開く…"
    } else {
        "Open File…"
    };
    // 「ファイルを開く」メニュー項目（ショートカットキー: O）
    let open_item = MenuItemBuilder::with_id("open_file", open_label)
        .accelerator("O")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, file_label)
        .item(&open_item)
        .build()?;

    // --- ヘルプメニュー ---
    let help_label = if is_japanese { "ヘルプ" } else { "Help" };
    let shortcuts_label = if is_japanese {
        "ショートカット一覧を表示"
    } else {
        "Show Shortcuts Help"
    };
    let version_label = if is_japanese {
        "バージョン情報"
    } else {
        "About Version"
    };

    let shortcuts_item = MenuItemBuilder::with_id("toggle_help", shortcuts_label)
        .accelerator("?")
        .build(app)?;
    let version_item =
        MenuItemBuilder::with_id("about_version", version_label).build(app)?;
    let github_item = MenuItemBuilder::with_id("open_github", "GitHub").build(app)?;

    let help_menu = SubmenuBuilder::new(app, help_label)
        .item(&shortcuts_item)
        .separator()
        .item(&version_item)
        .separator()
        .item(&github_item)
        .build()?;

    // --- メニューバー全体を構築 ---
    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &help_menu])
        .build()
}

// =============================================================================
// メインのrun関数
// アプリケーションの初期化と実行を行う
// =============================================================================
pub fn run() {
    // ストリーミングサーバーを起動
    let stream_port = start_stream_server();

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
        .manage(StreamServerPort(stream_port))
        // --- Tauriコマンドの登録 ---
        .invoke_handler(tauri::generate_handler![get_pending_files, get_stream_port])
        // --- アプリのセットアップ ---
        .setup(|app| {
            // システムの言語設定を取得して日本語かどうか判定
            let locale = sys_locale::get_locale().unwrap_or_else(|| "en".to_string());
            let is_japanese = locale.starts_with("ja");

            // メニューの構築と設定
            let menu = build_app_menu(app.handle(), is_japanese)?;
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
                                    // フロントエンドにファイルパスを送信
                                    let _ = handle.emit("open-file", &paths);
                                }
                            }
                        });
                    }
                    "toggle_help" => {
                        // ヘルプ表示のトグルをフロントエンドに送信
                        let _ = app_handle.emit("toggle-help", ());
                    }
                    "about_version" => {
                        // バージョン情報ダイアログを表示
                        use tauri_plugin_dialog::DialogExt;
                        let version = app_handle.package_info().version.to_string();
                        app_handle
                            .dialog()
                            .message(format!("Mac Classic Player\nv{}", version))
                            .title("Version")
                            .blocking_show();
                    }
                    "open_github" => {
                        // GitHubページを外部ブラウザで開く
                        let _ = tauri_plugin_opener::OpenerExt::opener(&app_handle)
                            .open_url(
                                "https://github.com/piro0919/mac-classic-player",
                                None::<&str>,
                            );
                    }
                    _ => {}
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

                // ダウンロードとインストールを実行
                if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
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
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("アプリケーションの構築に失敗しました");

    // --- アプリケーションの実行とイベントハンドリング ---
    app.run(|app_handle, event| {
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

            // メインウィンドウが存在するか確認
            if let Some(window) = app_handle.get_webview_window("main") {
                // ウィンドウが存在する場合、直接フロントエンドにイベントを送信
                let _ = window.emit("open-file", &paths);
            } else {
                // ウィンドウがまだ準備できていない場合、保留リストに追加
                if let Some(state) = app_handle.try_state::<OpenedFiles>() {
                    let mut files = state.0.lock().unwrap();
                    files.extend(paths);
                }
            }
        }
    });
}
