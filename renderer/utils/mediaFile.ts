// メディアファイル関連の共通ユーティリティ
// useTauriEvents（Tauriファイルシステム経由）とuseMediaFiles（ブラウザFile API経由）の
// 両方から使われるため、ここに集約する

import { parseBuffer, type IAudioMetadata } from "music-metadata-browser";

/// 音声ファイルの拡張子（メタデータ解析対象）
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "flac", "wav"];

/// ファイル名から拡張子とベース名を抽出する
/// 入力はファイル名（パスではなく）。パスを渡す場合は呼び出し側でbasenameを抽出すること
export const parseFileName = (
  fileName: string,
): { baseName: string; ext: string } => {
  const match = fileName.match(/^(.+)\.([^.]+)$/);

  return match
    ? { baseName: match[1], ext: match[2].toLowerCase() }
    : { baseName: fileName, ext: "" };
};

/// 音声バッファからメタデータを解析する
/// 解析失敗時はundefinedを返す（再生には影響しないため握りつぶす）
export const parseAudioMetadata = async (
  buffer: Uint8Array,
  mimeType: string,
): Promise<IAudioMetadata | undefined> => {
  try {
    return await parseBuffer(buffer, { mimeType });
  } catch {
    return undefined;
  }
};
