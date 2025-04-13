import { type IAudioMetadata } from "music-metadata-browser";

export type VideoItem = {
  artworkUrl?: string;
  ext: string; // 例: "mp4", "mp3"
  metadata?: IAudioMetadata;
  name: string; // 拡張子を含まない
  url: string;
};
