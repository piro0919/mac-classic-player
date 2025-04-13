import {
  Info,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StopCircle,
  Volume2,
  VolumeX,
} from "lucide-react";
import React from "react";
import { type VideoQueueAction } from "../store/videoQueueReducer";
import styles from "../styles/VideoPlayer.module.css";

type MediaControlsProps = {
  currentIndex: number;
  currentTime: number;
  dispatch: React.Dispatch<VideoQueueAction>;
  duration: number;
  formatTime: (time: number) => string;
  isFullscreen: boolean;
  isPlaying: boolean;
  muted: boolean;
  seekToTime: (time: number) => void;
  setShowInfo: React.Dispatch<React.SetStateAction<boolean>>;
  setVolume: (value: ((prev: number) => number) | number) => void;
  toggleFullscreen: () => Promise<void>;
  videoQueue: any[];
  volume: number;
};

const MediaControls: React.FC<MediaControlsProps> = ({
  currentIndex,
  currentTime,
  dispatch,
  duration,
  formatTime,
  isFullscreen,
  isPlaying,
  muted,
  seekToTime,
  setShowInfo,
  setVolume,
  toggleFullscreen,
  videoQueue,
  volume,
}) => {
  return (
    <div className={styles.controls}>
      {/* 再生/一時停止ボタン */}
      <button
        aria-label={isPlaying ? "Pause" : "Play"}
        className={styles.controlButton}
        onClick={() => dispatch({ type: "SET_IS_PLAYING", value: !isPlaying })}
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>
      {/* 停止ボタン */}
      <button
        onClick={() => {
          dispatch({ type: "STOP" });
          seekToTime(0);
        }}
        aria-label="Stop"
        className={styles.controlButton}
      >
        <StopCircle size={18} />
      </button>
      {/* 前の曲ボタン */}
      <button
        onClick={() => {
          if (currentTime < 5) {
            dispatch({ type: "PREVIOUS" });
          }

          seekToTime(0);
          dispatch({ type: "SET_IS_PLAYING", value: true });
        }}
        aria-label="Previous track"
        className={styles.controlButton}
        disabled={videoQueue.length === 0}
        title="Previous"
      >
        <SkipBack size={18} />
      </button>
      {/* 次の曲ボタン */}
      <button
        onClick={() => {
          dispatch({ type: "NEXT" });
          seekToTime(0);
          dispatch({ type: "SET_IS_PLAYING", value: true });
        }}
        aria-label="Next track"
        className={styles.controlButton}
        title="Next"
      >
        <SkipForward size={18} />
      </button>
      {/* シークバー */}
      <input
        onChange={(e) => {
          const val = Number(e.target.value);

          seekToTime(val);
        }}
        aria-label="Seek"
        aria-valuemax={duration}
        aria-valuemin={0}
        aria-valuenow={currentTime}
        className={styles.input}
        max={duration}
        min={0}
        step={0.1}
        type="range"
        value={currentTime}
      />
      {/* 時間表示 */}
      <p className={styles.timeInfo}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </p>
      {/* 音量スライダー */}
      <input
        onChange={(e) => {
          const vol = Number(e.target.value);

          dispatch({ type: "SET_MUTED", value: false });
          setVolume(vol);
        }}
        aria-label="Volume"
        aria-valuemax={1}
        aria-valuemin={0}
        aria-valuenow={volume}
        className={styles.input}
        max={1}
        min={0}
        step={0.01}
        type="range"
        value={volume}
      />
      {/* ミュートボタン */}
      <button
        aria-label={muted ? "Unmute" : "Mute"}
        className={styles.controlButton}
        onClick={() => dispatch({ type: "TOGGLE_MUTED" })}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      {/* トラック情報ボタン */}
      <button
        aria-label="Track Information"
        className={styles.controlButton}
        disabled={!videoQueue[currentIndex]?.metadata}
        onClick={() => setShowInfo((v) => !v)}
        title="Track Info"
      >
        <Info size={18} />
      </button>
      {/* フルスクリーンボタン */}
      <button
        onClick={async () => {
          await toggleFullscreen();
        }}
        aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        className={styles.controlButton}
      >
        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>
    </div>
  );
};

export default MediaControls;
