import { FileMusic } from "lucide-react";
import React from "react";
import styles from "../styles/VideoPlayer.module.css";
import { type VideoItem } from "../types/videoTypes";

type AudioPlayerProps = {
  currentItem: VideoItem;
};

const AudioPlayer: React.FC<AudioPlayerProps> = ({ currentItem }) => {
  const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "flac", "aac"];

  // オーディオファイルではない場合は何も表示しない
  if (!AUDIO_EXTENSIONS.includes(currentItem.ext)) {
    return null;
  }

  return (
    <div className={styles.placeholder}>
      <FileMusic className={styles.fileMusicIcon} size={120} />
      {currentItem.artworkUrl && (
        <img
          alt={currentItem.name}
          className={styles.albumArt}
          src={currentItem.artworkUrl}
        />
      )}
    </div>
  );
};

export default AudioPlayer;
