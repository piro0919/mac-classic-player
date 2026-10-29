// libmpv と ffmpeg が入っている環境でだけ動く、実ファイルを使ったテスト
// （どちらかが無ければ何もせずに通る）

use super::render::RenderContext;
use super::*;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn have_tools() -> bool {
    ffi::api().is_ok()
        && Command::new("ffmpeg")
            .arg("-version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

/// 音声2本（英語・スペイン語）と字幕2本（SRT・ASS）入りのMKVを作る
fn make_sample(dir: &Path) -> PathBuf {
    let srt = dir.join("en.srt");
    std::fs::write(&srt, "1\n00:00:00,000 --> 00:00:05,000\nHello\n").unwrap();
    let ass = dir.join("es.ass");
    std::fs::write(
        &ass,
        "[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Hola\n",
    )
    .unwrap();
    let out = dir.join("sample.mkv");
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y"])
        .args([
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x120:rate=24:duration=3",
        ])
        .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=3"])
        .args(["-f", "lavfi", "-i", "sine=frequency=660:duration=3"])
        .arg("-i")
        .arg(&srt)
        .arg("-i")
        .arg(&ass)
        .args([
            "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-map", "4:s",
        ])
        .args([
            "-c:v", "libx264", "-c:a", "aac", "-c:s:0", "srt", "-c:s:1", "ass",
        ])
        .args([
            "-metadata:s:a:0",
            "language=eng",
            "-metadata:s:a:1",
            "language=spa",
        ])
        .args([
            "-metadata:s:s:0",
            "language=eng",
            "-metadata:s:s:1",
            "language=spa",
        ])
        .args(["-metadata:s:a:1", "title=Doblaje"])
        .arg(&out)
        .status()
        .unwrap();
    assert!(status.success());
    out
}

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mcp-mpv-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 条件を満たすイベントが来るまで待つ。来なければ panic
fn wait_for(player: &Player, what: &str, mut pred: impl FnMut(&Event) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if let Some(ev) = player.wait_event(0.2) {
            if let Event::EndFile {
                reason: EndReason::Error,
                error,
            } = &ev
            {
                panic!("playback error while waiting for {what}: {error:?}");
            }
            if pred(&ev) {
                return;
            }
        }
    }
    panic!("timed out waiting for {what}");
}

fn wait_property(player: &Player, name: &str, expected: Value) {
    let what = format!("{name}={expected}");
    wait_for(
        player,
        &what,
        |ev| matches!(ev, Event::PropertyChange { name: n, value } if n == name && *value == expected),
    );
}

#[test]
fn tracks_can_be_listed_and_switched() {
    if !have_tools() {
        eprintln!("libmpv or ffmpeg missing; skipping");
        return;
    }
    let dir = temp_dir("tracks");
    let file = make_sample(&dir);
    let player = Player::new(&[
        ("vo", "null"),
        ("ao", "null"),
        ("idle", "yes"),
        ("keep-open", "yes"),
        ("pause", "yes"),
        ("config", "no"),
        ("terminal", "no"),
        ("alang", "spa"),
        ("slang", "spa"),
    ])
    .unwrap();
    for p in [
        "track-list",
        "aid",
        "sid",
        "speed",
        "duration",
        "eof-reached",
    ] {
        player.observe(p).unwrap();
    }
    player
        .command(&["loadfile", file.to_str().unwrap()])
        .unwrap();
    wait_for(&player, "file-loaded", |ev| *ev == Event::FileLoaded);

    let tracks = player.get_property("track-list").unwrap();
    let tracks = tracks.as_array().unwrap();
    let count = |t: &str| tracks.iter().filter(|x| x["type"] == t).count();
    assert_eq!((count("video"), count("audio"), count("sub")), (1, 2, 2));
    let spanish_audio = tracks
        .iter()
        .find(|x| x["type"] == "audio" && x["lang"] == "spa")
        .unwrap();
    assert_eq!(spanish_audio["title"], "Doblaje");

    // alang/slang=spa なのでスペイン語が選ばれている
    assert_eq!(player.get_property("aid").unwrap(), Value::from(2));
    assert_eq!(player.get_property("sid").unwrap(), Value::from(2));

    // 切り替え
    player.set_property("aid", "1").unwrap();
    wait_property(&player, "aid", Value::from(1));
    player.set_property("sid", "no").unwrap();
    wait_property(&player, "sid", Value::Bool(false));
    player.set_property("speed", "1.5").unwrap();
    wait_property(&player, "speed", serde_json::json!(1.5));

    // 外部字幕を追加して選ぶ
    let extra = dir.join("extra.srt");
    std::fs::write(&extra, "1\n00:00:00,000 --> 00:00:02,000\nExtra\n").unwrap();
    player
        .command(&["sub-add", extra.to_str().unwrap(), "select"])
        .unwrap();
    wait_property(&player, "sid", Value::from(3));

    // 最後までシークすると keep-open なので eof-reached になる
    player.set_property("pause", "no").unwrap();
    player.command(&["seek", "2.9", "absolute"]).unwrap();
    wait_property(&player, "eof-reached", Value::Bool(true));

    drop(player);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_broken_file_reports_an_error() {
    if !have_tools() {
        return;
    }
    let dir = temp_dir("broken");
    let file = dir.join("broken.mkv");
    std::fs::write(&file, b"this is not a video").unwrap();
    let player = Player::new(&[
        ("vo", "null"),
        ("ao", "null"),
        ("idle", "yes"),
        ("config", "no"),
        ("terminal", "no"),
    ])
    .unwrap();
    player
        .command(&["loadfile", file.to_str().unwrap()])
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut got = None;
    while Instant::now() < deadline && got.is_none() {
        if let Some(Event::EndFile { reason, error }) = player.wait_event(0.2) {
            got = Some((reason, error));
        }
    }
    let (reason, error) = got.expect("no end-file event");
    assert_eq!(reason, EndReason::Error);
    assert!(error.is_some());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn frames_are_rendered_through_the_render_api() {
    if !have_tools() {
        return;
    }
    let dir = temp_dir("render");
    let file = make_sample(&dir);
    let player = Player::new(&[
        ("vo", "libmpv"),
        ("ao", "null"),
        ("idle", "yes"),
        ("config", "no"),
        ("terminal", "no"),
        ("sid", "no"),
    ])
    .unwrap();
    let mut ctx = RenderContext::new_software(Arc::clone(&player)).unwrap();
    let (tx, rx) = mpsc::channel::<()>();
    let tx = std::sync::Mutex::new(tx);
    ctx.set_update_callback(move || {
        let _ = tx.lock().unwrap().send(());
    });
    player
        .command(&["loadfile", file.to_str().unwrap()])
        .unwrap();

    // イベントは別スレッドで捨てる（mpv のイベントキューを詰まらせない）
    let p = Arc::clone(&player);
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop2 = Arc::clone(&stop);
    let events = std::thread::spawn(move || {
        while !stop2.load(std::sync::atomic::Ordering::Relaxed) {
            p.wait_event(0.1);
        }
    });

    let (w, h) = (64, 48);
    let mut buffer = vec![0u8; w * h * 4];
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut rendered = false;
    while Instant::now() < deadline && !rendered {
        if rx.recv_timeout(Duration::from_millis(200)).is_ok() && ctx.needs_frame() {
            ctx.render_software(w as i32, h as i32, &mut buffer)
                .unwrap();
            ctx.report_swap();
            // testsrc2 はカラフルなので、黒以外の画素があれば描けている
            rendered = buffer
                .chunks(4)
                .any(|px| px[0] > 40 || px[1] > 40 || px[2] > 40);
        }
    }
    assert!(rendered, "no video frame was rendered");

    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    player.wakeup();
    events.join().unwrap();
    drop(ctx);
    drop(player);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn json_values_become_mpv_property_strings() {
    assert_eq!(
        json_to_property_string(&Value::Bool(true)).as_deref(),
        Some("yes")
    );
    assert_eq!(
        json_to_property_string(&serde_json::json!(1.25)).as_deref(),
        Some("1.25")
    );
    assert_eq!(
        json_to_property_string(&serde_json::json!(3)).as_deref(),
        Some("3")
    );
    assert_eq!(
        json_to_property_string(&Value::from("no")).as_deref(),
        Some("no")
    );
    assert_eq!(json_to_property_string(&Value::Null), None);
}
