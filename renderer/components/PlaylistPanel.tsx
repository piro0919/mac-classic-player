import { FileMusic, Film, X } from "lucide-react";
import React from "react";
import { type VideoQueueAction } from "../store/videoQueueReducer";
import styles from "../styles/VideoPlayer.module.css";
import { type VideoItem } from "../types/videoTypes";
import { AUDIO_EXTENSIONS } from "../utils/mediaFile";

type PlaylistPanelProps = {
  currentIndex: number;
  dispatch: React.Dispatch<VideoQueueAction>;
  onClose: () => void;
  seekToTime: (time: number) => void;
  show: boolean;
  videoQueue: VideoItem[];
};

// 右側からスライドインするプレイリスト
const PlaylistPanel: React.FC<PlaylistPanelProps> = ({
  currentIndex,
  dispatch,
  onClose,
  seekToTime,
  show,
  videoQueue,
}) => {
  return (
    <aside
      aria-hidden={!show}
      aria-label="Playlist"
      className={`${styles.playlist} ${show ? styles.playlistOpen : ""}`}
    >
      <header className={styles.playlistHeader}>
        <h2>Playlist</h2>
        <span className={styles.playlistCount}>{videoQueue.length}</span>
        <button
          aria-label="Close playlist"
          className={styles.iconButton}
          onClick={onClose}
          tabIndex={show ? 0 : -1}
        >
          <X size={16} />
        </button>
      </header>
      {videoQueue.length === 0 ? (
        <p className={styles.playlistEmpty}>No files yet</p>
      ) : (
        <ol className={styles.playlistItems}>
          {videoQueue.map((item, index) => {
            const isCurrent = index === currentIndex;
            const Icon = AUDIO_EXTENSIONS.includes(item.ext) ? FileMusic : Film;

            return (
              <li key={`${item.url}-${index}`}>
                <button
                  className={`${styles.playlistItem} ${
                    isCurrent ? styles.playlistItemCurrent : ""
                  }`}
                  onClick={() => {
                    dispatch({ index, type: "SET_INDEX" });
                    seekToTime(0);
                    dispatch({ type: "SET_IS_PLAYING", value: true });
                  }}
                  aria-current={isCurrent ? "true" : undefined}
                  tabIndex={show ? 0 : -1}
                  title={`${item.name}.${item.ext}`}
                >
                  <Icon className={styles.playlistIcon} size={14} />
                  <span className={styles.playlistName}>{item.name}</span>
                  <span className={styles.playlistExt}>{item.ext}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
};

export default PlaylistPanel;
