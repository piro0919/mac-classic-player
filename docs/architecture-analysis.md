# Mac Classic Player - リポジトリ解析レポート

作成日: 2026-05-07

## 1. アーキテクチャ概要

### 責務分担

**フロントエンド（React + Vite, `renderer/`）:**
- UI 表示・ユーザー操作（ドラッグ&ドロップ、キーボード、ファイル選択）
- メディア再生状態管理（再生/一時停止、音量、シーク）
- iTunes メタデータ検索とアートワーク取得
- ローカルストレージ管理（最近使ったファイル、音量設定）

**バックエンド（Rust + Tauri v2, `src-tauri/src/lib.rs`）:**
- メニューバー構築・イベント処理（最近使ったファイル、言語対応）
- ネイティブダイアログ（ファイル選択）
- macOS「ファイルで開く」イベント処理
- ローカルストリーミングサーバー（Range request 対応）
- アプリケーション更新管理
- ファイルパス情報の一時保存・取得

### IPC 通信パターン

| 方向 | 用途 | 実装 |
|-----|------|------|
| Rust → React | イベント発火 | `app.emit("open-file", paths)` / `listen()` フック |
| React → Rust | コマンド実行 | `invoke("get_pending_files")` / `invoke("add_recent_files")` |
| React ← Tauri | メニュー操作 | `onDragDropEvent()`, Tauri Event API |

参考: [lib.rs:467](../src-tauri/src/lib.rs#L467) - invoke_handler 登録

---

## 2. 主要機能の実装場所

### メディア再生（動画・音声）

- 動画: MP4, MOV / 音声: MP3, M4A, WAV (AAC, FLAC 互換)
- [VideoPlayer.tsx:188](../renderer/components/VideoPlayer.tsx#L188) - `<ReactPlayer>` コンポーネント
- 通常ファイル: Blob URL、大容量ファイル（>500MB）: HTTP サーバー経由でストリーミング
- [useTauriEvents.ts:74](../renderer/hooks/useTauriEvents.ts#L74) / [useMediaFiles.ts:40](../renderer/hooks/useMediaFiles.ts#L40) - `music-metadata-browser` で ID3 タグ抽出

### 最近使ったファイル

- [lib.rs:28-87](../src-tauri/src/lib.rs#L28) - `RecentFiles` 構造体で JSON 永続化
- [lib.rs:330-360](../src-tauri/src/lib.rs#L330) - 最新 10 件を動的メニュー化
- 更新トリガー: メニュークリック、ファイルダイアログ、ドラッグ&ドロップ

### ドラッグ&ドロップ

- [VideoPlayer.tsx:178](../renderer/components/VideoPlayer.tsx#L178) - `handleDrop()`
- [useTauriEvents.ts:192](../renderer/hooks/useTauriEvents.ts#L192) - `onDragDropEvent()` (Tauri v2 ネイティブ)
- `suppressNextOpenFile` フラグで重複防止

### メニューバー

- [lib.rs:260-420](../src-tauri/src/lib.rs#L260) - `build_app_menu()`
- [lib.rs:471](../src-tauri/src/lib.rs#L471) - システムロケールで日本語/英語
- [lib.rs:493](../src-tauri/src/lib.rs#L493) - `on_menu_event()`

### 自動更新

- [lib.rs:570-670](../src-tauri/src/lib.rs#L570) - `updater.check()` → `download()` → `install()`
- [tauri.conf.json:77](../src-tauri/tauri.conf.json#L77) - GitHub リリースエンドポイント

### ストリーミングサーバー（大容量ファイル対応）

- [lib.rs:126](../src-tauri/src/lib.rs#L126) - 起動時にスレッド化
- ポート: 動的割り当て（`127.0.0.1:0`）
- [lib.rs:192-230](../src-tauri/src/lib.rs#L192) - HTTP/1.1 206 Partial Content
- [lib.rs:238](../src-tauri/src/lib.rs#L238) - 64KB チャンク単位
- [useTauriEvents.ts:34](../renderer/hooks/useTauriEvents.ts#L34) - 500MB 超で自動切替
- [lib.rs:183](../src-tauri/src/lib.rs#L183) - 拡張子から MIME 型判定

---

## 3. 状態管理

### 全体構造

```
VideoPlayer (useReducer)
├─ videoState (videoQueueReducer)
│  ├─ queue, currentIndex, currentTime, duration, isPlaying, muted
├─ volume (useLocalStorageState)
└─ UI フラグ (showHelp, showInfo, isBuffering, isFullscreen, ...)
```

参考: [VideoPlayer.tsx:27-54](../renderer/components/VideoPlayer.tsx#L27)

### Reducer

[videoQueueReducer.ts](../renderer/store/videoQueueReducer.ts) / [actionTypes.ts](../renderer/store/actionTypes.ts)

| アクション | 処理内容 |
|-----------|--------|
| `LOAD_FILES` | キューリセット、新ファイル読み込み |
| `SET_INDEX` | 現在トラック切り替え |
| `NEXT` / `PREVIOUS` | トラック遷移（ループ対応） |
| `SET_CURRENT_TIME` / `SET_DURATION` | 再生進捗・長さ |
| `SET_IS_PLAYING` / `SET_MUTED` | 再生状態・音量 |
| `UPDATE_MEDIA_INFO` | メタデータ・アートワーク |

### Hooks

| Hook | 責務 |
|------|------|
| [useTauriEvents](../renderer/hooks/useTauriEvents.ts) | Rust イベント受信、保留中ファイル取得 |
| [useMediaFiles](../renderer/hooks/useMediaFiles.ts) | ファイル選択・D&D 処理 |
| [useMediaArtwork](../renderer/hooks/useMediaArtwork.ts) | iTunes API でアートワーク検索 |
| [useKeyboardShortcuts](../renderer/hooks/useKeyboardShortcuts.ts) | キーボード入力管理 |

---

## 4. コンポーネント構成

| コンポーネント | 責務 | 参照 |
|-----------|------|------|
| VideoPlayer | メイン UI、状態管理、イベント統合 | [VideoPlayer.tsx:27](../renderer/components/VideoPlayer.tsx#L27) |
| MediaControls | 再生ボタン、シークバー、音量スライダー | [MediaControls.tsx:34](../renderer/components/MediaControls.tsx#L34) |
| AudioPlayer | 音声時のプレースホルダー & アートワーク | [AudioPlayer.tsx:10](../renderer/components/AudioPlayer.tsx#L10) |
| HelpOverlay | キーボードショートカット表示 | [HelpOverlay.tsx:11](../renderer/components/HelpOverlay.tsx#L11) |
| TrackInfoOverlay | メタデータ表示ダイアログ | [TrackInfoOverlay.tsx:12](../renderer/components/TrackInfoOverlay.tsx#L12) |

---

## 5. 設定ファイル

### tauri.conf.json

| キー | 値 | 意味 |
|-----|-----|------|
| `app.windows[0].width/height` | 800x450 | 初期サイズ（Retina 注意） |
| `app.security.assetProtocol.scope` | `$HOME/**, /Volumes/**` | ファイルアクセス範囲 |
| `bundle.fileAssociations` | MP4, MOV, MP3, M4A, WAV | Finder 関連付け |
| `bundle.macOS.minimumSystemVersion` | 11.0 | 対応最小 macOS |
| `plugins.updater.endpoints` | GitHub releases URL | 自動更新 |

### capabilities/default.json

`core:default`, `dialog:*`, `fs:allow-read-file`, `fs:allow-stat`, `shell:allow-open`, `updater:default`, `process:default`, `window-state:default`, `core:window:allow-set-fullscreen`

### Info.plist

`CFBundleDocumentTypes` に MP4/MP3/WAV/M4A/movie を登録（Finder ダブルクリック対応）

---

## 6. 気になる点・改善余地

### ⚠️ 技術負債・重複コード

1. **未使用ファイル**: [fileUtils.ts](../renderer/utils/fileUtils.ts) の `extractVideoItemsFromDrop()` がどこからも import されていない（同等ロジックが [useMediaFiles.ts:40](../renderer/hooks/useMediaFiles.ts#L40) に重複）
2. **メタデータ解析の重複**: [useTauriEvents.ts:74](../renderer/hooks/useTauriEvents.ts#L74) と [useMediaFiles.ts:47](../renderer/hooks/useMediaFiles.ts#L47) → 共通関数化可能
3. **ファイルパス解析の重複**: `parseFilePath()` ([useTauriEvents.ts:23](../renderer/hooks/useTauriEvents.ts#L23)) と `parseFileName()` ([useMediaFiles.ts:24](../renderer/hooks/useMediaFiles.ts#L24)) → 統一望ましい（動作差分要確認）

### 📝 アーキテクチャ改善案

4. **Reducer ボイラープレート**: `VideoQueueAction` ユニオン型が長い → Redux Toolkit / 共通ヘルパで削減可能
5. **状態管理の分散**: UI フラグが `VideoPlayer` 内に局所化 → Context / Zustand 検討
6. **Tauri イベント解放**: cleanup は実装済みだが Promise `.then()` 型で race の理論的可能性 ([useTauriEvents.ts:148-169](../renderer/hooks/useTauriEvents.ts#L148))

### 🔍 潜在的な問題

7. **Retina DPI スケーリング**: [lib.rs:448-449](../src-tauri/src/lib.rs#L448) にバグ注釈あり、ドキュメント不足
8. **500MB 閾値ハードコード**: [useTauriEvents.ts:34](../renderer/hooks/useTauriEvents.ts#L34) → 設定化推奨
9. **CORS ワイルドカード**: [lib.rs:225, 212](../src-tauri/src/lib.rs#L225) で `*` 許可（localhost 限定なので実害低）
10. **メニュー言語切替**: 起動時固定 ([lib.rs:471](../src-tauri/src/lib.rs#L471)) → 実行中の OS 言語変更に未対応

### 🧪 リリース・運用

11. **CI/CD**: リリーススクリプト ([package.json:98-101](../package.json#L98)) は手動実行 → GitHub Actions 自動化推奨
