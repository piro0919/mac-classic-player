import { useClickOutside } from "@mantine/hooks";
import {
  Info,
  Keyboard,
  ListVideo,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Settings,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import React, { useState } from "react";
import { type VideoQueueAction } from "../store/videoQueueReducer";
import styles from "../styles/VideoPlayer.module.css";
import { type VideoItem } from "../types/videoTypes";
import {
  DEFAULT_PLAYBACK_RATE,
  formatPlaybackRate,
  PLAYBACK_RATES,
} from "../utils/playbackRate";

type MediaControlsProps = {
  currentIndex: number;
  currentTime: number;
  dispatch: React.Dispatch<VideoQueueAction>;
  duration: number;
  formatTime: (time: number) => string;
  isFullscreen: boolean;
  isPlaying: boolean;
  muted: boolean;
  playbackRate: number;
  seekToTime: (time: number) => void;
  setPlaybackRate: (value: ((prev: number) => number) | number) => void;
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
  setShowInfo: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPlaylist: React.Dispatch<React.SetStateAction<boolean>>;
  setVolume: (value: ((prev: number) => number) | number) => void;
  showPlaylist: boolean;
  toggleFullscreen: () => Promise<void>;
  videoQueue: VideoItem[];
  volume: number;
};

// スライダーの塗りつぶし幅をCSS変数で渡す
const fillStyle = (ratio: number): React.CSSProperties =>
  ({
    "--fill": `${Math.min(100, Math.max(0, ratio * 100))}%`,
  }) as React.CSSProperties;
const MediaControls: React.FC<MediaControlsProps> = ({
  currentIndex,
  currentTime,
  dispatch,
  duration,
  formatTime,
  isFullscreen,
  isPlaying,
  muted,
  playbackRate,
  seekToTime,
  setPlaybackRate,
  setShowHelp,
  setShowInfo,
  setShowPlaylist,
  setVolume,
  showPlaylist,
  toggleFullscreen,
  videoQueue,
  volume,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useClickOutside<HTMLDivElement>(() =>
    setShowSettings(false),
  );
  const hasMedia = videoQueue.length > 0;
  const effectiveVolume = muted ? 0 : volume;
  const VolumeIcon =
    effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2;
  const isDefaultRate = playbackRate === DEFAULT_PLAYBACK_RATE;

  return (
    <div className={styles.controls}>
      {/* シークバー（時間表示を両端に） */}
      <div className={styles.seekRow}>
        <span className={styles.timeInfo}>
          {hasMedia ? formatTime(currentTime) : "--:--"}
        </span>
        <input
          onChange={(e) => {
            const val = Number(e.target.value);

            seekToTime(val);
          }}
          aria-label="Seek"
          aria-valuemax={duration}
          aria-valuemin={0}
          aria-valuenow={currentTime}
          className={`${styles.slider} ${styles.seekSlider}`}
          disabled={!hasMedia}
          max={duration || 0}
          min={0}
          step={0.1}
          style={fillStyle(duration > 0 ? currentTime / duration : 0)}
          type="range"
          value={currentTime}
        />
        <span className={`${styles.timeInfo} ${styles.timeInfoEnd}`}>
          {hasMedia && duration > 0 ? formatTime(duration) : "--:--"}
        </span>
      </div>
      <div className={styles.buttonRow}>
        {/* 左: 音量 */}
        <div className={styles.sideGroup}>
          <div className={styles.volumePill}>
            <button
              aria-label={muted ? "Unmute" : "Mute"}
              className={styles.volumeButton}
              onClick={() => dispatch({ type: "TOGGLE_MUTED" })}
              title={muted ? "Unmute (M)" : "Mute (M)"}
            >
              <VolumeIcon size={16} />
            </button>
            <input
              onChange={(e) => {
                const vol = Number(e.target.value);

                dispatch({ type: "SET_MUTED", value: false });
                setVolume(vol);
              }}
              aria-label="Volume"
              aria-valuemax={1}
              aria-valuemin={0}
              aria-valuenow={effectiveVolume}
              className={`${styles.slider} ${styles.volumeSlider}`}
              max={1}
              min={0}
              step={0.01}
              style={fillStyle(effectiveVolume)}
              type="range"
              value={effectiveVolume}
            />
          </div>
        </div>
        {/* 中央: 前へ / 再生 / 次へ */}
        <div className={styles.transport}>
          <button
            onClick={() => {
              if (currentTime < 5) {
                dispatch({ type: "PREVIOUS" });
              }

              seekToTime(0);
              dispatch({ type: "SET_IS_PLAYING", value: true });
            }}
            aria-label="Previous track"
            className={styles.transportButton}
            disabled={!hasMedia}
            title="Previous (A)"
          >
            <SkipBack fill="currentColor" size={22} />
          </button>
          <button
            onClick={() =>
              dispatch({ type: "SET_IS_PLAYING", value: !isPlaying })
            }
            aria-label={isPlaying ? "Pause" : "Play"}
            className={`${styles.transportButton} ${styles.playButton}`}
            disabled={!hasMedia}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? (
              <Pause fill="currentColor" size={30} />
            ) : (
              <Play fill="currentColor" size={30} />
            )}
          </button>
          <button
            onClick={() => {
              dispatch({ type: "NEXT" });
              seekToTime(0);
              dispatch({ type: "SET_IS_PLAYING", value: true });
            }}
            aria-label="Next track"
            className={styles.transportButton}
            disabled={!hasMedia}
            title="Next (D)"
          >
            <SkipForward fill="currentColor" size={22} />
          </button>
        </div>
        {/* 右: 設定 / プレイリスト / フルスクリーン */}
        <div className={`${styles.sideGroup} ${styles.sideGroupEnd}`}>
          <div className={styles.settingsWrap} ref={settingsRef}>
            <button
              aria-expanded={showSettings}
              aria-haspopup="menu"
              aria-label="Settings"
              className={`${styles.iconButton} ${showSettings ? styles.iconButtonActive : ""}`}
              onClick={() => setShowSettings((v) => !v)}
              title="Settings"
            >
              <Settings size={20} />
              {!isDefaultRate && (
                <span className={styles.rateBadge}>
                  {formatPlaybackRate(playbackRate)}
                </span>
              )}
            </button>
            {showSettings && (
              <div className={styles.settingsMenu} role="menu">
                <p className={styles.menuLabel}>
                  Playback speed
                  <span className={styles.menuHint}>[ / ]</span>
                </p>
                <div className={styles.rateGrid}>
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      className={`${styles.rateChip} ${
                        rate === playbackRate ? styles.rateChipActive : ""
                      }`}
                      aria-checked={rate === playbackRate}
                      key={rate}
                      onClick={() => setPlaybackRate(rate)}
                      role="menuitemradio"
                    >
                      {formatPlaybackRate(rate)}
                    </button>
                  ))}
                </div>
                <hr className={styles.menuDivider} />
                <button
                  onClick={() => {
                    setShowInfo((v) => !v);
                    setShowSettings(false);
                  }}
                  className={styles.menuItem}
                  disabled={!videoQueue[currentIndex]?.metadata}
                  role="menuitem"
                >
                  <Info size={15} />
                  Track info
                  <span className={styles.menuHint}>I</span>
                </button>
                <button
                  onClick={() => {
                    setShowHelp(true);
                    setShowSettings(false);
                  }}
                  className={styles.menuItem}
                  role="menuitem"
                >
                  <Keyboard size={15} />
                  Keyboard shortcuts
                  <span className={styles.menuHint}>?</span>
                </button>
              </div>
            )}
          </div>
          <button
            aria-label={showPlaylist ? "Hide playlist" : "Show playlist"}
            aria-pressed={showPlaylist}
            className={`${styles.iconButton} ${showPlaylist ? styles.iconButtonActive : ""}`}
            onClick={() => setShowPlaylist((v) => !v)}
            title="Playlist (L)"
          >
            <ListVideo size={20} />
          </button>
          <button
            aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            className={styles.iconButton}
            onClick={() => void toggleFullscreen()}
            title="Fullscreen (F)"
          >
            {isFullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MediaControls;
