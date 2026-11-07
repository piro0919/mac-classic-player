// ウィンドウの位置と大きさの保存・復元
//
// tauri-plugin-window-state は位置を物理ピクセルで保存し、復元するときは
// 「ウィンドウがその時点でいる画面」の倍率で論理座標に戻す。
// Retina（2倍）と外部画面（1倍）を併用していると、保存時と復元時で倍率が食い違い、
// 起動のたびに座標が2倍・半分になって、最後は画面の外へ出てしまう。
// そこで位置と大きさは倍率に左右されない論理座標で保存し、
// ウィンドウを作るときに最初から指定する。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Monitor, Runtime, WebviewWindow};

const FILE_NAME: &str = "window-geometry.json";

/// タイトルバーとみなす高さ（論理ピクセル）。ここが画面に乗っていればドラッグで動かせる
const TITLE_BAR_HEIGHT: f64 = 28.0;
/// 画面に乗っている必要がある最小の横幅（論理ピクセル）
const MIN_VISIBLE_WIDTH: f64 = 100.0;

/// 論理座標で表したウィンドウの外枠の位置と、中身の大きさ
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct WindowGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 論理座標で表した画面の範囲
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScreenRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ScreenRect {
    fn from_monitor(monitor: &Monitor) -> Self {
        let scale = monitor.scale_factor();
        let position = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        Self {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }
    }
}

/// 起動時にウィンドウへ指定する位置と大きさ。None の項目は既定のまま
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    pub position: Option<(f64, f64)>,
    pub size: Option<(f64, f64)>,
}

impl WindowGeometry {
    /// タイトルバーがどこかの画面に十分乗っていて、つかんで動かせる位置か
    pub fn is_reachable_on(&self, screens: &[ScreenRect]) -> bool {
        if !(self.width > 0.0 && self.height > 0.0) {
            return false;
        }
        screens.iter().any(|s| {
            let overlap = (self.x + self.width).min(s.x + s.width) - self.x.max(s.x);
            let title_bar_on_screen = self.y >= s.y && self.y + TITLE_BAR_HEIGHT <= s.y + s.height;
            overlap >= MIN_VISIBLE_WIDTH.min(self.width) && title_bar_on_screen
        })
    }

    /// 今つながっている画面に合わせて、指定する位置と大きさを決める
    ///
    /// 大きさは一番大きい画面に収まるよう縮める。画面より大きいと右下の角をつかめないため。
    /// 位置はタイトルバーが画面に乗るときだけ使う。乗らないときも大きさは引き継ぐ。
    pub fn placement_on(&self, screens: &[ScreenRect]) -> Placement {
        if screens.is_empty() || !(self.width > 0.0 && self.height > 0.0) {
            return Placement {
                position: None,
                size: None,
            };
        }
        let max_width = screens.iter().map(|s| s.width).fold(0.0, f64::max);
        let max_height = screens.iter().map(|s| s.height).fold(0.0, f64::max);
        let fitted = WindowGeometry {
            width: self.width.min(max_width),
            height: self.height.min(max_height),
            ..*self
        };
        Placement {
            position: fitted
                .is_reachable_on(screens)
                .then_some((fitted.x, fitted.y)),
            size: Some((fitted.width, fitted.height)),
        }
    }
}

/// 最後に見た「普通の状態」のウィンドウの位置と大きさ
///
/// 最大化・フルスクリーンのまま終了しても、その直前の位置で保存できるよう、
/// 移動と大きさの変更のたびに覚えておく。
#[derive(Default)]
pub struct LastGeometry(Mutex<Option<WindowGeometry>>);

fn file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// 保存してある位置と大きさを読む。読めない・壊れているときは None
pub fn load(config_dir: &Path) -> Option<WindowGeometry> {
    let text = std::fs::read_to_string(file_path(config_dir)).ok()?;
    serde_json::from_str(&text).ok()
}

/// 保存してある位置と大きさを、今つながっている画面に合わせて返す
pub fn load_placement<R: Runtime>(app: &AppHandle<R>) -> Option<Placement> {
    let config_dir = app.path().app_config_dir().ok()?;
    let geometry = load(&config_dir)?;
    let screens: Vec<ScreenRect> = app
        .available_monitors()
        .ok()?
        .iter()
        .map(ScreenRect::from_monitor)
        .collect();
    Some(geometry.placement_on(&screens))
}

/// 今のウィンドウの位置と大きさを論理座標で読む
///
/// フルスクリーン・最大化・最小化の間は、戻したときの位置ではないので None。
/// 物理座標から論理座標へ戻すときは、物理座標にしたときと同じ
/// 「今いる画面の倍率」で割るので、どの画面にいても正確に戻る。
fn capture<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowGeometry> {
    let abnormal = window.is_fullscreen().unwrap_or(true)
        || window.is_maximized().unwrap_or(true)
        || window.is_minimized().unwrap_or(true);
    if abnormal {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// 移動・大きさの変更のたびに呼び、普通の状態なら覚えておく
pub fn track<R: Runtime>(window: &WebviewWindow<R>) {
    if let Some(geometry) = capture(window) {
        if let Some(last) = window.try_state::<LastGeometry>() {
            *crate::lock_through_poison(&last.0, "last_geometry") = Some(geometry);
        }
    }
}

/// 終了時に、覚えておいた位置と大きさをファイルに書く
pub fn save<R: Runtime>(window: &WebviewWindow<R>) {
    track(window);
    let Some(geometry) = window
        .try_state::<LastGeometry>()
        .and_then(|last| *crate::lock_through_poison(&last.0, "last_geometry"))
    else {
        return;
    };
    let Ok(config_dir) = window.path().app_config_dir() else {
        return;
    };
    if let Err(e) = write(&config_dir, &geometry) {
        eprintln!("[window] 位置と大きさの保存に失敗しました: {e}");
    }
}

/// 一時ファイルに書いてから置き換える。書いている途中で落ちても前の内容が残る
fn write(config_dir: &Path, geometry: &WindowGeometry) -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir)?;
    let json = serde_json::to_vec_pretty(geometry)?;
    let tmp = config_dir.join(format!("{FILE_NAME}.tmp"));
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, file_path(config_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 手元の構成と同じ並び: 本体（2倍、1800x1169）と、その左に外部画面（1倍、1600x1200）
    const MAIN: ScreenRect = ScreenRect {
        x: 0.0,
        y: 0.0,
        width: 1800.0,
        height: 1169.0,
    };
    const EXTERNAL: ScreenRect = ScreenRect {
        x: -1600.0,
        y: 0.0,
        width: 1600.0,
        height: 1200.0,
    };

    fn geometry(x: f64, y: f64) -> WindowGeometry {
        WindowGeometry {
            x,
            y,
            width: 800.0,
            height: 450.0,
        }
    }

    #[test]
    fn a_window_inside_the_main_screen_is_reachable() {
        assert!(geometry(200.0, 150.0).is_reachable_on(&[MAIN, EXTERNAL]));
    }

    #[test]
    fn a_window_on_the_external_screen_is_reachable() {
        assert!(geometry(-1200.0, 200.0).is_reachable_on(&[MAIN, EXTERNAL]));
    }

    #[test]
    fn a_window_only_a_corner_of_which_is_on_screen_is_not_reachable() {
        // 不具合で実際に保存されていた位置。右下の角が40x32だけ見えていた
        assert!(!geometry(1760.0, 1137.0).is_reachable_on(&[MAIN, EXTERNAL]));
    }

    #[test]
    fn a_window_beyond_every_screen_is_not_reachable() {
        assert!(!geometry(3520.0, 2274.0).is_reachable_on(&[MAIN, EXTERNAL]));
        // 外部画面のさらに左。幅800なので右端も外部画面に届かない
        assert!(!geometry(-2500.0, 95.0).is_reachable_on(&[MAIN, EXTERNAL]));
    }

    #[test]
    fn a_window_left_on_a_disconnected_screen_is_not_reachable() {
        assert!(!geometry(-1200.0, 200.0).is_reachable_on(&[MAIN]));
    }

    #[test]
    fn a_title_bar_above_the_screen_is_not_reachable() {
        assert!(!geometry(200.0, -20.0).is_reachable_on(&[MAIN]));
    }

    #[test]
    fn a_zero_size_is_not_reachable() {
        let g = WindowGeometry {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        };
        assert!(!g.is_reachable_on(&[MAIN]));
    }

    // --- 起動時に指定する位置と大きさ ---

    #[test]
    fn a_reachable_window_keeps_its_position_and_size() {
        assert_eq!(
            geometry(200.0, 150.0).placement_on(&[MAIN, EXTERNAL]),
            Placement {
                position: Some((200.0, 150.0)),
                size: Some((800.0, 450.0)),
            }
        );
    }

    #[test]
    fn an_unreachable_window_keeps_its_size_but_not_its_position() {
        // 外部画面を外したあと。位置は既定に任せ、大きさは引き継ぐ
        assert_eq!(
            geometry(-1200.0, 200.0).placement_on(&[MAIN]),
            Placement {
                position: None,
                size: Some((800.0, 450.0)),
            }
        );
    }

    #[test]
    fn a_size_larger_than_every_screen_is_shrunk_to_fit() {
        let huge = WindowGeometry {
            x: 0.0,
            y: 30.0,
            width: 20000.0,
            height: 20000.0,
        };
        assert_eq!(
            huge.placement_on(&[MAIN, EXTERNAL]),
            Placement {
                position: Some((0.0, 30.0)),
                size: Some((1800.0, 1200.0)),
            }
        );
    }

    #[test]
    fn nothing_is_placed_without_screens_or_with_a_zero_size() {
        let none = Placement {
            position: None,
            size: None,
        };
        assert_eq!(geometry(200.0, 150.0).placement_on(&[]), none);
        let zero = WindowGeometry {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        };
        assert_eq!(zero.placement_on(&[MAIN]), none);
    }

    // --- ファイル ---

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mcp-geometry-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_broken_file_is_ignored() {
        let dir = temp_dir("broken");
        std::fs::write(file_path(&dir), "{not json").unwrap();
        assert_eq!(load(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_written_geometry_reads_back_and_leaves_no_temp_file() {
        let dir = temp_dir("roundtrip");
        let g = WindowGeometry {
            x: -1200.5,
            y: 20.0,
            width: 640.0,
            height: 360.0,
        };
        write(&dir, &g).unwrap();
        assert_eq!(load(&dir), Some(g));
        assert!(!dir.join(format!("{FILE_NAME}.tmp")).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
