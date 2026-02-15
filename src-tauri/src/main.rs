// Mac Classic Player - デスクトップアプリのエントリーポイント
// リリースビルド時にコンソールウィンドウを非表示にする
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mac_classic_player_lib::run()
}
