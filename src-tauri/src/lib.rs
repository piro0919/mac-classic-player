// Mac Classic Player - メインアプリケーションロジック
// Tauriプラグインの初期化、メニュー構築、ファイルオープンイベント処理を行う

use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager, RunEvent,
};
use tauri_plugin_updater::UpdaterExt;

// =============================================================================
// アプリ状態の定義
// macOSの「ファイルで開く」イベントで受け取ったファイルパスを一時保存する
// アプリ起動時にフロントエンドがまだ準備できていない場合に使用
// =============================================================================
struct OpenedFiles(Mutex<Vec<String>>);

// =============================================================================
// Tauriコマンド: フロントエンドから呼び出し可能な関数
// =============================================================================

/// フロントエンドの準備完了時に、保留中のファイルパスを取得する
/// フロントエンドのuseEffectから呼び出される
#[tauri::command]
fn get_pending_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
    // 保留中のファイルパスを取得してクリアする
    let mut files = state.0.lock().unwrap();
    let result = files.clone();
    files.clear();
    result
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
    // アプリビルダーの設定
    let app = tauri::Builder::default()
        // --- プラグインの登録 ---
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // ウィンドウの位置・サイズを自動的に保存・復元するプラグイン
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // アップデーターのプラグイン
        .plugin(tauri_plugin_updater::Builder::new().build())
        // --- アプリ状態の管理 ---
        .manage(OpenedFiles(Mutex::new(Vec::new())))
        // --- Tauriコマンドの登録 ---
        .invoke_handler(tauri::generate_handler![get_pending_files])
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
            tauri::async_runtime::spawn(async move {
                if let Ok(updater) = update_handle.updater() {
                    match updater.check().await {
                        Ok(Some(update)) => {
                            println!(
                                "アップデートが見つかりました: v{}",
                                update.version
                            );
                            // ダウンロードとインストールを実行
                            let _ =
                                update.download_and_install(|_, _| {}, || {}).await;
                        }
                        Ok(None) => {
                            println!("最新バージョンです");
                        }
                        Err(e) => {
                            eprintln!("アップデート確認エラー: {}", e);
                        }
                    }
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
