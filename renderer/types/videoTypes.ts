import { type IAudioMetadata } from "music-metadata-browser";

export type VideoItem = {
  artworkUrl?: string;
  ext: string; // 例: "mp4", "mp3"
  // 読み込むたびに振る番号。同じファイルを開き直したときも再読み込みするために使う
  id: number;
  metadata?: IAudioMetadata;
  name: string; // 拡張子を含まない
  // mpv に渡すファイルのパス
  path: string;
  // 一覧のキーなどに使う識別子（= path）
  url: string;
};
