// mpv をアプリに組み込む部分: 起動、Tauriコマンド、フロントエンドへのイベント送信
//
// フロントエンドとのやりとり:
// - コマンド: mpv_start / mpv_load / mpv_set / mpv_seek / mpv_stop /
//             mpv_open_subtitle_dialog / mpv_set_video_rect
// - イベント "mpv": { type: "property", name, value } | { type: "file-loaded" } |
//                   { type: "end-file", reason, error }

use crate::mpv::{json_to_property_string, EndReason, Event, Player};
use serde_json::Value;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// フロントエンドへのエラーコード: libmpv が見つからない
pub const ERR_MPV_MISSING: &str = "mpv-missing";

/// フロントエンドが変化を受け取るプロパティ
const OBSERVED: &[&str] = &[
    "pause",
    "time-pos",
    "duration",
    "eof-reached",
    "track-list",
    "aid",
    "sid",
    "speed",
    "volume",
    "mute",
    "paused-for-cache",
    "seeking",
];

/// フロントエンドから変更してよいプロパティ
const SETTABLE: &[&str] = &[
    "pause",
    "speed",
    "volume",
    "mute",
    "aid",
    "sid",
    "loop-file",
    "sub-delay",
    "audio-delay",
    "sub-visibility",
];

#[derive(Default)]
pub struct PlayerState {
    player: Mutex<Option<Arc<Player>>>,
}

impl PlayerState {
    fn get(&self) -> Result<Arc<Player>, String> {
        self.player
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
            .ok_or_else(|| "mpv is not started".to_string())
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum MpvMessage {
    Property {
        name: String,
        value: Value,
    },
    FileLoaded,
    EndFile {
        reason: EndReason,
        error: Option<String>,
    },
}

/// システムの言語から、優先する音声・字幕の言語リストを作る（mpv の alang / slang 用）
fn preferred_languages() -> String {
    let locale = sys_locale::get_locale().unwrap_or_else(|| "en".to_string());
    let primary = locale
        .split(['-', '_'])
        .next()
        .unwrap_or("en")
        .to_ascii_lowercase();
    // 2文字コードと、MKVでよく使われる3文字コード（ISO 639-2）の両方を並べる
    let three = match primary.as_str() {
        "es" => "spa",
        "en" => "eng",
        "ja" => "jpn",
        "pt" => "por",
        "fr" => "fre,fra",
        "de" => "ger,deu",
        "it" => "ita",
        "zh" => "chi,zho",
        "ko" => "kor",
        "ru" => "rus",
        _ => "",
    };
    let mut list = vec![primary.clone()];
    if !three.is_empty() {
        list.push(three.to_string());
    }
    if primary != "en" {
        list.push("en".to_string());
        list.push("eng".to_string());
    }
    list.join(",")
}

fn create_player() -> Result<Arc<Player>, String> {
    // macOS は映像を自前のレイヤーに描かせる。他のOS（開発用）は映像なしで音だけ
    let vo = if cfg!(target_os = "macos") {
        "libmpv"
    } else {
        "null"
    };
    let langs = preferred_languages();
    let player = Player::new(&[
        ("vo", vo),
        ("hwdec", "auto-safe"),
        ("idle", "yes"),
        ("keep-open", "yes"),
        ("pause", "yes"),
        ("config", "no"),
        ("terminal", "no"),
        ("input-default-bindings", "no"),
        ("input-vo-keyboard", "no"),
        ("osc", "no"),
        ("osd-level", "0"),
        ("ytdl", "no"),
        // 音楽ファイルのジャケット画像は映像として扱わない（UIで表示する）
        ("audio-display", "no"),
        // 同じフォルダの同名の字幕ファイルも読み込む
        ("sub-auto", "fuzzy"),
        ("alang", &langs),
        ("slang", &langs),
        ("volume-max", "100"),
    ])
    .map_err(|e| {
        if e.contains("libmpv not found") {
            format!("{ERR_MPV_MISSING}: {e}")
        } else {
            e
        }
    })?;
    for name in OBSERVED {
        player.observe(name)?;
    }
    let _ = player.request_log_messages("warn");
    Ok(player)
}

/// mpv のイベントを受け取ってフロントエンドに送り続ける
fn spawn_event_loop(app: tauri::AppHandle, player: Arc<Player>) {
    std::thread::spawn(move || {
        // time-pos は毎フレーム変わるので、送る頻度を抑える
        let mut last_time_emit = Instant::now() - Duration::from_secs(1);
        let mut last_time = f64::NAN;
        loop {
            let Some(event) = player.wait_event(-1.0) else {
                continue;
            };
            let message = match event {
                Event::Shutdown => break,
                Event::FileLoaded => MpvMessage::FileLoaded,
                Event::EndFile { reason, error } => MpvMessage::EndFile { reason, error },
                Event::PropertyChange { name, value } => {
                    if name == "time-pos" {
                        let t = value.as_f64().unwrap_or(f64::NAN);
                        let jumped =
                            (t - last_time).abs() > 1.0 || t.is_nan() != last_time.is_nan();
                        if !jumped && last_time_emit.elapsed() < Duration::from_millis(200) {
                            continue;
                        }
                        last_time_emit = Instant::now();
                        last_time = t;
                    }
                    MpvMessage::Property { name, value }
                }
                Event::Log {
                    level,
                    prefix,
                    text,
                } => {
                    eprintln!("[mpv:{level}] {prefix}: {text}");
                    continue;
                }
                Event::StartFile | Event::Other => continue,
            };
            let _ = app.emit("mpv", message);
        }
    });
}

/// mpv を起動する（2回目以降は何もしない）
#[tauri::command]
pub fn mpv_start(app: tauri::AppHandle, state: tauri::State<PlayerState>) -> Result<(), String> {
    let mut slot = state.player.lock().unwrap_or_else(|p| p.into_inner());
    if slot.is_some() {
        return Ok(());
    }
    let player = create_player()?;

    #[cfg(target_os = "macos")]
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        let for_layer = Arc::clone(&player);
        window
            .with_webview(move |webview| {
                // with_webview のクロージャはメインスレッドで動く
                if let Err(e) =
                    unsafe { crate::video_layer_macos::attach(webview.inner(), for_layer) }
                {
                    eprintln!("[video] {e}");
                }
            })
            .map_err(|e| e.to_string())?;
    }

    spawn_event_loop(app.clone(), Arc::clone(&player));
    *slot = Some(player);
    Ok(())
}

/// ファイルを開いて再生する。ユーザーが開いたファイルだけを受け付ける
#[tauri::command]
pub fn mpv_load(
    app: tauri::AppHandle,
    state: tauri::State<PlayerState>,
    path: String,
) -> Result<(), String> {
    let player = state.get()?;
    let allowed = app
        .try_state::<crate::StreamServer>()
        .and_then(|s| s.access.resolve(Path::new(&path)))
        .ok_or_else(|| "このファイルは開かれていません".to_string())?;
    let path = allowed.to_string_lossy();
    player.command(&["loadfile", &path, "replace"])
}

#[tauri::command]
pub fn mpv_set(state: tauri::State<PlayerState>, name: String, value: Value) -> Result<(), String> {
    if !SETTABLE.contains(&name.as_str()) {
        return Err(format!("property {name} cannot be set"));
    }
    let value =
        json_to_property_string(&value).ok_or_else(|| format!("invalid value for {name}"))?;
    state.get()?.set_property(&name, &value)
}

#[tauri::command]
pub fn mpv_seek(state: tauri::State<PlayerState>, seconds: f64) -> Result<(), String> {
    if !seconds.is_finite() {
        return Err("invalid position".to_string());
    }
    let target = format!("{:.3}", seconds.max(0.0));
    state.get()?.command(&["seek", &target, "absolute"])
}

#[tauri::command]
pub fn mpv_stop(state: tauri::State<PlayerState>) -> Result<(), String> {
    state.get()?.command(&["stop"])
}

/// 字幕ファイルを選んで読み込み、そのまま選択する
#[tauri::command]
pub fn mpv_open_subtitle_dialog(
    app: tauri::AppHandle,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let player = state.get()?;
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_dialog::DialogExt;
        let picked = app
            .dialog()
            .file()
            .add_filter(
                "Subtitles",
                &["srt", "ass", "ssa", "vtt", "sub", "idx", "sup", "smi"],
            )
            .blocking_pick_file();
        if let Some(path) = picked.and_then(|f| f.as_path().map(|p| p.to_path_buf())) {
            if let Err(e) = player.command(&["sub-add", &path.to_string_lossy(), "select"]) {
                eprintln!("[mpv] sub-add: {e}");
            }
        }
    });
    Ok(())
}

/// 映像を出す位置（WebView 内の CSS ピクセル）を設定する
#[tauri::command]
pub fn mpv_set_video_rect(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(move || unsafe {
            crate::video_layer_macos::set_rect(x, y, width, height, visible);
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, x, y, width, height, visible);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_whitelisted_properties_are_settable() {
        assert!(SETTABLE.contains(&"aid"));
        assert!(SETTABLE.contains(&"speed"));
        // 任意のコマンド実行やファイル読み込みにつながるものは入れない
        for dangerous in ["input-commands", "script", "stream-open-filename", "run"] {
            assert!(!SETTABLE.contains(&dangerous));
        }
    }

    #[test]
    fn languages_include_english_as_fallback() {
        let langs = preferred_languages();
        assert!(langs.contains("en"), "{langs}");
    }
}
