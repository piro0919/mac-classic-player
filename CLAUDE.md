# Mac Classic Player

macOS向けのクラシックUIメディアプレイヤー。Tauri v2 + React で構成。

## 技術スタック

- **バックエンド**: Rust (Tauri v2) — `src-tauri/src/lib.rs` に主要ロジック
- **フロントエンド**: React 19 + TypeScript + Vite — `renderer/` 配下
- **パッケージマネージャ**: npm
- **リンター**: ESLint, Prettier, Stylelint, commitlint, secretlint
- **Git hooks**: lefthook

## ビルド（重要）

ビルド時に以下の3つの環境変数が**必須**:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/mac-classic-player.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="tauri" \
APPLE_SIGNING_IDENTITY="-" \
npm run build
```

### APPLE_SIGNING_IDENTITY="-" を忘れると何が起きるか

- GitHubからダウンロードしたDMGが「壊れている」エラーになる
- システム設定の「このまま開く」ボタンも表示されない
- 自動アップデートも失敗する（tar.gz内のアプリも未署名になるため）
- `APPLE_SIGNING_IDENTITY="-"` を付けるとad-hocコード署名され、「未確認の開発元」警告に変わり、システム設定から許可できる
- ビルドログに `Signing with identity "-"` が表示されることを確認すること

## リリース手順

1. `src-tauri/tauri.conf.json` と `package.json` のバージョンを更新
2. 上記の環境変数付きでビルド
3. `npm run release`（GitHub Releaseの作成 + DMG/tar.gz/sig/latest.jsonアップロード）

## 開発

```bash
npm run dev
```

## プロジェクト構成

```
src-tauri/
  src/lib.rs          # Rustバックエンド（メニュー、ストリーミングサーバー、自動更新、最近使ったファイル）
  tauri.conf.json     # Tauri設定
  capabilities/       # パーミッション定義
  Info.plist          # ファイル関連付け
renderer/
  App.tsx             # メインコンポーネント
  components/         # UIコンポーネント
  hooks/              # カスタムフック（useTauriEvents, useMediaFiles等）
  store/              # 状態管理（videoQueueReducer）
  types/              # 型定義
  styles/             # CSS Modules
```

## コーディング規約

- **コメント**: 日本語
- **コミットメッセージ**: 英語、commitlint準拠
  - subject: 72文字以内、小文字の動詞で開始（例: `feat: add recent files menu`）
  - `@commitlint/config-conventional` + `@uphold/commitlint-config` ルール適用
- **CSS**: CSS Modules
- **インポート順**: eslint-plugin-perfectionist による自動ソート

## 主要な設計判断

- **大容量ファイル（>500MB）**: readFile + Blob URLではなく、ローカルHTTPサーバー経由でRange request対応のストリーミング再生
- **最近使ったファイル**: 最大10件、`{app_config_dir}/recent_files.json` に永続化、Rust側のみで完結
- **自動更新**: minisign鍵（`~/.tauri/mac-classic-player.key`）で署名、GitHub Releases経由で配布
- **ドラッグ&ドロップ**: Tauri v2のネイティブイベント（`onDragDropEvent`）を使用、ブラウザのdropイベントではない

## .env

`.env` に `GH_TOKEN` と `APPLE_SIGNING_IDENTITY` が保存されている。secretlintで検出されるため `.gitignore` に含まれている。
