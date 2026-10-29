// WebView（WKWebView）が直接再生できないコンテナ（MKVなど）を、ffmpegでMP4に変換して再生する
//
// 方針:
// - 映像が H.264(8bit) / HEVC、音声が AAC / MP3 / AC-3 / E-AC-3 / ALAC なら再エンコードせず
//   MP4に詰め替えるだけ（remux）。数秒〜数十秒で終わる
// - それ以外の映像（VP9, AV1, MPEG-2, 10bit H.264 など）は H.264 に変換する。時間がかかる
// - それ以外の音声（DTS, TrueHD, FLAC, Opus, Vorbis など）は AAC に変換する
// - 字幕・添付ファイル（MKVのフォントやカバー画像）は落とす
// - 出力はキャッシュディレクトリに置き、同じファイル（パス・サイズ・更新日時が同じ）なら再利用する

use std::collections::hash_map::DefaultHasher;
use std::ffi::OsString;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

/// キャッシュの形式を変えたら上げる（古いキャッシュを使わないため）
const CACHE_VERSION: u32 = 1;

/// これより古いキャッシュは起動時に消す
pub const CACHE_MAX_AGE: Duration = Duration::from_secs(3 * 24 * 60 * 60);

/// フロントエンドに返すエラーコード
pub const ERR_FFMPEG_MISSING: &str = "ffmpeg-missing";
pub const ERR_CANCELLED: &str = "cancelled";

// =============================================================================
// ffmpeg / ffprobe の場所
// =============================================================================

#[derive(Debug, Clone)]
pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

/// ffmpeg と ffprobe を探す
///
/// Finderから起動したアプリにはシェルのPATHが渡らないので、Homebrew/MacPortsの
/// 定番の場所を先に見る。アプリに同梱した場合に備えて実行ファイルの隣も見る。
pub fn find_tools() -> Option<Tools> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        dirs.push(dir);
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        dirs.push(PathBuf::from(d));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }

    dirs.into_iter().find_map(|dir| {
        let ffmpeg = dir.join("ffmpeg");
        let ffprobe = dir.join("ffprobe");
        (ffmpeg.is_file() && ffprobe.is_file()).then_some(Tools { ffmpeg, ffprobe })
    })
}

// =============================================================================
// ffprobe の結果
// =============================================================================

#[derive(Debug, Clone, PartialEq)]
pub struct StreamInfo {
    pub index: u32,
    pub codec: String,
    pub profile: Option<String>,
    pub pix_fmt: Option<String>,
    pub channels: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MediaInfo {
    pub duration: Option<f64>,
    pub video: Option<StreamInfo>,
    pub audio: Option<StreamInfo>,
}

/// `ffprobe -print_format json -show_format -show_streams` の出力を解釈する
///
/// 映像はカバー画像（attached_pic）を除いた最初のもの、
/// 音声は「デフォルト」指定があればそれ、なければ最初のものを使う。
pub fn parse_probe(json: &str) -> Result<MediaInfo, String> {
    let root: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("ffprobe output: {e}"))?;
    let streams = root["streams"].as_array().cloned().unwrap_or_default();

    let flag = |s: &serde_json::Value, key: &str| s["disposition"][key].as_i64() == Some(1);
    let to_info = |s: &serde_json::Value| StreamInfo {
        index: s["index"].as_u64().unwrap_or(0) as u32,
        codec: s["codec_name"].as_str().unwrap_or("").to_ascii_lowercase(),
        profile: s["profile"].as_str().map(str::to_string),
        pix_fmt: s["pix_fmt"].as_str().map(str::to_string),
        channels: s["channels"].as_u64().map(|c| c as u32),
        height: s["height"].as_u64().map(|h| h as u32),
    };
    let of_type = |t: &str| {
        streams
            .iter()
            .filter(|s| s["codec_type"].as_str() == Some(t))
            .collect::<Vec<_>>()
    };

    let video = of_type("video")
        .into_iter()
        .find(|s| !flag(s, "attached_pic"))
        .map(to_info);
    let audios = of_type("audio");
    let audio = audios
        .iter()
        .find(|s| flag(s, "default"))
        .or_else(|| audios.first())
        .map(|s| to_info(s));

    // durationは文字列で入っている
    let duration = root["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| d.is_finite() && *d > 0.0);

    if video.is_none() && audio.is_none() {
        return Err("no playable video or audio stream".to_string());
    }
    Ok(MediaInfo {
        duration,
        video,
        audio,
    })
}

pub fn probe(tools: &Tools, input: &Path) -> Result<MediaInfo, String> {
    let output = Command::new(&tools.ffprobe)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(input)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("ffprobe: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffprobe: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_probe(&String::from_utf8_lossy(&output.stdout))
}

// =============================================================================
// ffmpeg の引数
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// 詰め替えだけ（速い）
    Remux,
    /// 映像の再エンコードあり（遅い）
    Transcode,
}

/// 10bit以上のH.264はAppleのデコーダーが再生できない
fn is_high_bit_depth(s: &StreamInfo) -> bool {
    let pix = s.pix_fmt.as_deref().unwrap_or("");
    let profile = s.profile.as_deref().unwrap_or("").to_ascii_lowercase();
    pix.contains("10") || pix.contains("12") || profile.contains("high 10")
}

fn video_can_copy(s: &StreamInfo) -> bool {
    match s.codec.as_str() {
        "h264" => !is_high_bit_depth(s),
        "hevc" => true,
        _ => false,
    }
}

fn audio_can_copy(s: &StreamInfo) -> bool {
    matches!(s.codec.as_str(), "aac" | "mp3" | "ac3" | "eac3" | "alac")
}

/// 再エンコード時の映像ビットレート（解像度から決める）
fn video_bitrate(height: Option<u32>) -> &'static str {
    match height.unwrap_or(1080) {
        0..=480 => "2500k",
        481..=720 => "5M",
        721..=1080 => "8M",
        1081..=1440 => "14M",
        _ => "24M",
    }
}

/// 入力の内容に合わせてffmpegの引数を組み立てる
/// 出力はMP4形式で `output` に書く（拡張子に関係なく -f mp4）
pub fn build_args(info: &MediaInfo, input: &Path, output: &Path) -> (Vec<OsString>, Mode) {
    let mut args: Vec<OsString> = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    args.push(input.as_os_str().to_owned());

    let mut push = |items: &[&str]| args.extend(items.iter().map(OsString::from));
    let mut mode = Mode::Remux;

    match &info.video {
        Some(v) => {
            let map = format!("0:{}", v.index);
            push(&["-map", map.as_str()]);
            if video_can_copy(v) {
                push(&["-c:v", "copy"]);
                if v.codec == "hevc" {
                    // QuickTime/Safari は hev1 タグのHEVCを再生しない
                    push(&["-tag:v", "hvc1"]);
                }
            } else {
                mode = Mode::Transcode;
                let bitrate = video_bitrate(v.height);
                if cfg!(target_os = "macos") {
                    // Macのハードウェアエンコーダーを使う（CPUより大幅に速い）
                    push(&[
                        "-c:v",
                        "h264_videotoolbox",
                        "-allow_sw",
                        "1",
                        "-b:v",
                        bitrate,
                    ]);
                } else {
                    push(&["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]);
                }
                push(&["-pix_fmt", "yuv420p"]);
            }
        }
        None => push(&["-vn"]),
    }

    match &info.audio {
        Some(a) => {
            let map = format!("0:{}", a.index);
            push(&["-map", map.as_str()]);
            if audio_can_copy(a) {
                push(&["-c:a", "copy"]);
            } else {
                let channels = a.channels.unwrap_or(2);
                push(&[
                    "-c:a",
                    "aac",
                    "-b:a",
                    if channels > 2 { "384k" } else { "192k" },
                ]);
                if channels > 6 {
                    // 7.1chはAACで扱いにくいので5.1chにまとめる
                    push(&["-ac", "6"]);
                }
            }
        }
        None => push(&["-an"]),
    }

    push(&[
        "-sn",
        "-dn",
        "-map_chapters",
        "-1",
        "-max_muxing_queue_size",
        "4096",
        "-f",
        "mp4",
    ]);
    args.push(output.as_os_str().to_owned());
    (args, mode)
}

/// `-progress` の1行から進み具合（0.0〜1.0）を読み取る
pub fn parse_progress_line(line: &str, duration: Option<f64>) -> Option<f64> {
    let (key, value) = line.trim().split_once('=')?;
    match key {
        "progress" if value == "end" => Some(1.0),
        // out_time_ms も中身はマイクロ秒（ffmpegの歴史的な名前）
        "out_time_us" | "out_time_ms" => {
            let us: f64 = value.parse().ok()?;
            let total = duration?;
            Some((us / 1_000_000.0 / total).clamp(0.0, 1.0))
        }
        _ => None,
    }
}

// =============================================================================
// キャッシュ
// =============================================================================

/// 入力ファイルからキャッシュのファイル名を決める（パス・サイズ・更新日時）
pub fn cache_file_name(input: &Path) -> std::io::Result<String> {
    let meta = std::fs::metadata(input)?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = DefaultHasher::new();
    CACHE_VERSION.hash(&mut hasher);
    input.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    mtime.hash(&mut hasher);
    Ok(format!("{:016x}.mp4", hasher.finish()))
}

/// 書きかけのファイルと古いキャッシュを消す
pub fn prune_cache(dir: &Path, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_partial = path.extension().is_some_and(|e| e == "part");
        let too_old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > max_age);
        if is_partial || too_old {
            let _ = std::fs::remove_file(&path);
        }
    }
}

// =============================================================================
// 変換ジョブ（同時に1つだけ）
// =============================================================================

struct Job {
    id: u64,
    input: PathBuf,
    child: Child,
}

/// 変換は同時に1つだけ走らせる。新しい変換を始めると前の変換は止める
/// （プレイリストで次々に切り替えたときに、裏で古い変換が走り続けないように）
#[derive(Default)]
pub struct Converter {
    next_id: AtomicU64,
    current: Mutex<Option<Job>>,
}

impl Converter {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Job>> {
        self.current.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// 走っている変換を止める。`only_for` を指定したら、その入力の変換のときだけ止める
    pub fn cancel(&self, only_for: Option<&Path>) {
        let mut current = self.lock();
        let matches = match (&*current, only_for) {
            (Some(job), Some(p)) => job.input == p,
            (Some(_), None) => true,
            (None, _) => false,
        };
        if matches {
            if let Some(mut job) = current.take() {
                let _ = job.child.kill();
                let _ = job.child.wait();
            }
        }
    }

    /// `input` を変換して `output` に書く
    ///
    /// 書いている間は `output.part` に出し、成功したら名前を変える。
    /// 途中で止められたら `ERR_CANCELLED` を返す。
    pub fn run(
        &self,
        tools: &Tools,
        info: &MediaInfo,
        input: &Path,
        output: &Path,
        mut on_progress: impl FnMut(f64),
    ) -> Result<Mode, String> {
        // 前の変換は止める
        self.cancel(None);

        let partial = output.with_extension("mp4.part");
        let (args, mode) = build_args(info, input, &partial);
        let mut child = Command::new(&tools.ffmpeg)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ffmpeg: {e}"))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        *self.lock() = Some(Job {
            id,
            input: input.to_path_buf(),
            child,
        });

        // stderrはパイプが詰まらないよう別スレッドで読み切る
        let stderr_reader = std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut s) = stderr {
                let _ = s.read_to_string(&mut text);
            }
            text
        });

        let mut last = -1.0_f64;
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(p) = parse_progress_line(&line, info.duration) {
                    // 0.5%刻みで通知すれば十分
                    if p - last >= 0.005 || p >= 1.0 {
                        last = p;
                        on_progress(p);
                    }
                }
            }
        }

        let stderr_text = stderr_reader.join().unwrap_or_default();

        // 終了を待つ。ジョブが差し替わっていたら止められたということ
        let job = {
            let mut current = self.lock();
            match current.take() {
                Some(job) if job.id == id => Some(job),
                other => {
                    *current = other;
                    None
                }
            }
        };
        let Some(mut job) = job else {
            let _ = std::fs::remove_file(&partial);
            return Err(ERR_CANCELLED.to_string());
        };
        let status = job.child.wait().map_err(|e| format!("ffmpeg: {e}"))?;

        if !status.success() {
            let _ = std::fs::remove_file(&partial);
            let detail = stderr_text.lines().last().unwrap_or("").trim().to_string();
            return Err(if detail.is_empty() {
                format!("ffmpeg exited with {status}")
            } else {
                detail
            });
        }
        std::fs::rename(&partial, output).map_err(|e| format!("rename: {e}"))?;
        Ok(mode)
    }
}

// =============================================================================
// テスト
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(codec: &str) -> StreamInfo {
        StreamInfo {
            index: 0,
            codec: codec.to_string(),
            profile: None,
            pix_fmt: Some("yuv420p".to_string()),
            channels: Some(2),
            height: Some(1080),
        }
    }

    fn info(video: Option<StreamInfo>, audio: Option<StreamInfo>) -> MediaInfo {
        MediaInfo {
            duration: Some(10.0),
            video,
            audio,
        }
    }

    fn args_of(i: &MediaInfo) -> (String, Mode) {
        let (args, mode) = build_args(i, Path::new("in.mkv"), Path::new("out.part"));
        let joined = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" ");
        (joined, mode)
    }

    #[test]
    fn h264_and_aac_are_only_remuxed() {
        let (a, mode) = args_of(&info(Some(stream("h264")), Some(stream("aac"))));
        assert_eq!(mode, Mode::Remux);
        assert!(a.contains("-c:v copy") && a.contains("-c:a copy"), "{a}");
    }

    #[test]
    fn hevc_is_copied_with_the_hvc1_tag() {
        let (a, mode) = args_of(&info(Some(stream("hevc")), None));
        assert_eq!(mode, Mode::Remux);
        assert!(a.contains("-tag:v hvc1") && a.contains("-an"), "{a}");
    }

    #[test]
    fn ten_bit_h264_is_transcoded() {
        let mut v = stream("h264");
        v.pix_fmt = Some("yuv420p10le".to_string());
        let (a, mode) = args_of(&info(Some(v), Some(stream("aac"))));
        assert_eq!(mode, Mode::Transcode);
        assert!(!a.contains("-c:v copy"), "{a}");
    }

    #[test]
    fn vp9_is_transcoded_and_dts_becomes_aac() {
        let mut audio = stream("dts");
        audio.channels = Some(8);
        let (a, mode) = args_of(&info(Some(stream("vp9")), Some(audio)));
        assert_eq!(mode, Mode::Transcode);
        assert!(a.contains("-c:a aac -b:a 384k -ac 6"), "{a}");
    }

    #[test]
    fn subtitles_and_attachments_are_dropped_and_output_is_mp4() {
        let (a, _) = args_of(&info(Some(stream("h264")), None));
        assert!(
            a.contains("-sn -dn") && a.ends_with("-f mp4 out.part"),
            "{a}"
        );
    }

    #[test]
    fn probe_skips_cover_art_and_prefers_the_default_audio() {
        let json = r#"{
          "streams": [
            {"index": 0, "codec_type": "video", "codec_name": "mjpeg", "disposition": {"attached_pic": 1}},
            {"index": 1, "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p", "height": 720, "disposition": {"attached_pic": 0}},
            {"index": 2, "codec_type": "audio", "codec_name": "aac", "channels": 2, "disposition": {"default": 0}},
            {"index": 3, "codec_type": "audio", "codec_name": "ac3", "channels": 6, "disposition": {"default": 1}},
            {"index": 4, "codec_type": "subtitle", "codec_name": "ass"}
          ],
          "format": {"duration": "1325.400000"}
        }"#;
        let i = parse_probe(json).unwrap();
        assert_eq!(i.video.as_ref().map(|v| v.index), Some(1));
        assert_eq!(
            i.audio.as_ref().map(|a| (a.index, a.codec.as_str())),
            Some((3, "ac3"))
        );
        assert_eq!(i.duration, Some(1325.4));
    }

    #[test]
    fn probe_without_streams_is_an_error() {
        assert!(parse_probe(r#"{"streams": [], "format": {}}"#).is_err());
    }

    #[test]
    fn progress_lines_are_read_as_fractions() {
        assert_eq!(
            parse_progress_line("out_time_us=5000000", Some(10.0)),
            Some(0.5)
        );
        assert_eq!(
            parse_progress_line("out_time_ms=20000000", Some(10.0)),
            Some(1.0)
        );
        assert_eq!(parse_progress_line("progress=end", None), Some(1.0));
        assert_eq!(parse_progress_line("progress=continue", Some(10.0)), None);
        assert_eq!(parse_progress_line("out_time_us=N/A", Some(10.0)), None);
        assert_eq!(parse_progress_line("out_time_us=5000000", None), None);
    }

    #[test]
    fn cache_name_changes_when_the_file_changes() {
        let dir = std::env::temp_dir().join(format!("mcp-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.mkv");
        std::fs::write(&f, b"one").unwrap();
        let first = cache_file_name(&f).unwrap();
        assert_eq!(first, cache_file_name(&f).unwrap());
        std::fs::write(&f, b"three").unwrap();
        assert_ne!(first, cache_file_name(&f).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_removes_partial_files_but_keeps_fresh_ones() {
        let dir = std::env::temp_dir().join(format!("mcp-prune-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("x.mp4.part"), b"").unwrap();
        std::fs::write(dir.join("y.mp4"), b"").unwrap();
        prune_cache(&dir, CACHE_MAX_AGE);
        assert!(!dir.join("x.mp4.part").exists());
        assert!(dir.join("y.mp4").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// テスト用のMKVをffmpegで作る
    fn make_mkv(tools: &Tools, dir: &Path, name: &str, codecs: &[&str]) -> PathBuf {
        let out = dir.join(name);
        let status = Command::new(&tools.ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x240:rate=24:duration=3",
            ])
            .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=3"])
            .args(codecs)
            .arg(&out)
            .status()
            .unwrap();
        assert!(status.success(), "failed to create {name}");
        out
    }

    /// ffmpegが入っている環境でだけ、実際に変換して中身を確かめる
    #[test]
    fn real_files_are_converted_to_playable_mp4() {
        let Some(tools) = find_tools() else {
            eprintln!("ffmpeg not found; skipping");
            return;
        };
        let dir = std::env::temp_dir().join(format!("mcp-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let converter = Converter::default();

        let cases: [(&str, &[&str], Mode, &str, &str); 3] = [
            (
                "h264.mkv",
                &["-c:v", "libx264", "-c:a", "aac"],
                Mode::Remux,
                "h264",
                "aac",
            ),
            (
                "vp9.mkv",
                &["-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus"],
                Mode::Transcode,
                "h264",
                "aac",
            ),
            (
                "hevc.mkv",
                &[
                    "-c:v",
                    "libx265",
                    "-x265-params",
                    "log-level=error",
                    "-c:a",
                    "ac3",
                ],
                Mode::Remux,
                "hevc",
                "ac3",
            ),
        ];
        for (name, codecs, expected_mode, vcodec, acodec) in cases {
            let input = make_mkv(&tools, &dir, name, codecs);
            let info = probe(&tools, &input).unwrap();
            let output = dir.join(cache_file_name(&input).unwrap());
            let mut last = 0.0;
            let mode = converter
                .run(&tools, &info, &input, &output, |p| last = p)
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(mode, expected_mode, "{name}");
            assert_eq!(last, 1.0, "{name}: progress should finish at 100%");
            assert!(!output.with_extension("mp4.part").exists());

            let out_info = probe(&tools, &output).unwrap();
            assert_eq!(out_info.video.as_ref().unwrap().codec, vcodec, "{name}");
            assert_eq!(out_info.audio.as_ref().unwrap().codec, acodec, "{name}");
            assert!((out_info.duration.unwrap() - 3.0).abs() < 0.3, "{name}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_job_cancels_the_running_one() {
        let Some(tools) = find_tools() else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("mcp-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = make_mkv(
            &tools,
            &dir,
            "slow.mkv",
            &["-c:v", "libvpx-vp9", "-c:a", "libopus"],
        );
        let info = probe(&tools, &input).unwrap();
        let converter = std::sync::Arc::new(Converter::default());
        let output = dir.join("slow.mp4");

        let c = std::sync::Arc::clone(&converter);
        let (t, i, inp, out) = (tools.clone(), info.clone(), input.clone(), output.clone());
        let handle = std::thread::spawn(move || c.run(&t, &i, &inp, &out, |_| {}));
        // 起動を待ってから止める
        std::thread::sleep(Duration::from_millis(150));
        converter.cancel(Some(&input));
        let result = handle.join().unwrap();
        // 速いマシンでは止める前に終わることもある
        if let Err(e) = result {
            assert_eq!(e, ERR_CANCELLED);
            assert!(!output.exists() && !output.with_extension("mp4.part").exists());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
