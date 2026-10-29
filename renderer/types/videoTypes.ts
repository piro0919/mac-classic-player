import { type IAudioMetadata } from "music-metadata-browser";

export type VideoItem = {
  artworkUrl?: string;
  ext: string; // 例: "mp4", "mp3"
  metadata?: IAudioMetadata;
  name: string; // 拡張子を含まない
  // MKVなど変換が必要なファイル: 変換元のパス。変換が終わるまで url は空文字
  needsConversion?: boolean;
  sourcePath?: string;
  url: string;
};
