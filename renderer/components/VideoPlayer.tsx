import { initialState, videoQueueReducer } from "@/store/videoQueueReducer";
import { getCurrentWindow } from "@tauri-apps/api/window";
// VideoPlayer.tsx (メインコンポーネント)
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import ReactPlayer from "react-player";
import useLocalStorageState from "use-local-storage-state";
import placeholderImage from "../assets/video-placeholder.png";
import { useTauriEvents } from "../hooks/useTauriEvents";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
// カスタムフックのインポート
import { useMediaArtwork } from "../hooks/useMediaArtwork";
import { cleanupObjectUrls, useMediaFiles } from "../hooks/useMediaFiles";
import styles from "../styles/VideoPlayer.module.css";
import AudioPlayer from "./AudioPlayer";
import HelpOverlay from "./HelpOverlay";
// コンポーネントのインポート
import MediaControls from "./MediaControls";
import TrackInfoOverlay from "./TrackInfoOverlay";

const VideoPlayer: React.FC = () => {
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentTimeRef = useRef(0);
  const playerRef = useRef<HTMLVideoElement | null>(null);
  // State管理
  const [videoState, dispatch] = useReducer(videoQueueReducer, initialState);
  const [volume, setVolume] = useLocalStorageState("volume", {
    defaultValue: 1,
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const [shouldShowPlayer, setShouldShowPlayer] = useState(true);
  // ステートの解凍
  const {
    currentIndex,
    currentTime,
    duration,
    isPlaying,
    muted,
    queue: videoQueue,
  } = videoState;
  // フルスクリーン状態管理（Tauri Window API使用）
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const current = await win.isFullscreen();

    await win.setFullscreen(!current);
    setIsFullscreen(!current);
  }, []);
  // 現在のビデオURLのメモ化
  const videoUrl = useMemo(
    () => videoQueue[currentIndex]?.url ?? null,
    [videoQueue, currentIndex],
  );
  // 時間フォーマット関数
  const formatTime = useCallback((time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);

    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }, []);
  // シーク関数（react-player v3: HTMLVideoElementのcurrentTimeを直接操作）
  const seekToTime = useCallback((time: number) => {
    if (playerRef.current) {
      playerRef.current.currentTime = time;
    }

    currentTimeRef.current = time;
    dispatch({ time, type: "SET_CURRENT_TIME" });
  }, []);

  // カスタムフックの使用
  useMediaArtwork(videoQueue, dispatch);

  const { shortcuts } = useKeyboardShortcuts({
    currentTime,
    currentTimeRef,
    dispatch,
    duration,
    fileInputRef,
    seekToTime,
    setShowHelp,
    setShowInfo,
    setVolume,
    showHelp,
    toggleFullscreen,
  });
  const { suppressNextOpenFile } = useTauriEvents(
    dispatch,
    seekToTime,
    setShowHelp,
  );
  const { handleDragOver, handleDrop, handleFileChange } = useMediaFiles(
    dispatch,
    seekToTime,
    suppressNextOpenFile,
  );

  // タイトル更新
  useEffect(() => {
    if (videoQueue.length > 0) {
      const { name } = videoQueue[currentIndex];

      dispatch({ time: 0, type: "SET_CURRENT_TIME" });
      document.title = name || "Video Player";
    }
  }, [videoQueue, currentIndex]);

  // オーバーレイの表示/非表示のトランジション
  useEffect(() => {
    if (showInfo) {
      setInfoVisible(true);
    } else {
      const timeout = setTimeout(() => setInfoVisible(false), 300);

      return () => clearTimeout(timeout);
    }
  }, [showInfo]);

  useEffect(() => {
    if (showHelp) {
      setHelpVisible(true);
    } else {
      const timeout = setTimeout(() => setHelpVisible(false), 300);

      return () => clearTimeout(timeout);
    }
  }, [showHelp]);

  useEffect(() => {
    setShouldShowPlayer(false);

    const timeout = setTimeout(() => setShouldShowPlayer(true), 10);

    return () => clearTimeout(timeout);
  }, [videoUrl]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      cleanupObjectUrls();
    };
  }, []);

  return (
    <div className={styles.container} ref={fullscreenRef}>
      {/* ファイル選択インプット */}
      <input
        accept="video/*,audio/*"
        multiple={true}
        onChange={handleFileChange}
        ref={fileInputRef}
        style={{ display: "none" }}
        type="file"
      />
      {videoUrl ? (
        // プレーヤーエリア
        <div
          onClick={() =>
            dispatch({ type: "SET_IS_PLAYING", value: !isPlaying })
          }
          className={styles.playerArea}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* 音声ファイルの場合のプレースホルダー */}
          {videoQueue[currentIndex] && (
            <AudioPlayer currentItem={videoQueue[currentIndex]} />
          )}
          {/* メディアプレーヤー */}
          {shouldShowPlayer && (
            <ReactPlayer
              height="100%"
              key={videoUrl}
              loop={videoQueue.length <= 1}
              muted={muted}
              onDurationChange={(e: React.SyntheticEvent<HTMLVideoElement>) => {
                const dur = e.currentTarget.duration;

                if (Number.isFinite(dur)) {
                  dispatch({ time: dur, type: "SET_DURATION" });
                }
              }}
              onEnded={() => {
                if (videoQueue.length > 1) {
                  dispatch({ type: "NEXT" });
                  seekToTime(0);
                  dispatch({ type: "SET_IS_PLAYING", value: true });
                } else {
                  seekToTime(0);
                  dispatch({ type: "SET_IS_PLAYING", value: true });
                }
              }}
              onPause={() => dispatch({ type: "SET_IS_PLAYING", value: false })}
              onPlay={() => dispatch({ type: "SET_IS_PLAYING", value: true })}
              onTimeUpdate={(e: React.SyntheticEvent<HTMLVideoElement>) => {
                const playedSeconds = e.currentTarget.currentTime;

                if (Math.abs(playedSeconds - currentTimeRef.current) > 0.25) {
                  dispatch({ time: playedSeconds, type: "SET_CURRENT_TIME" });
                  currentTimeRef.current = playedSeconds;
                }
              }}
              playing={isPlaying}
              ref={playerRef}
              src={videoUrl}
              volume={volume}
              width="100%"
            />
          )}
        </div>
      ) : (
        // ドロップゾーン（ファイルがロードされていない場合）
        <div
          aria-label="Drop media files here or click to select"
          className={styles.dropZone}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className={styles.placeholder}>
            <img
              alt="Video placeholder"
              className={styles.placeholderImage}
              src={placeholderImage}
            />
          </div>
        </div>
      )}
      {/* 再生コントロール */}
      <MediaControls
        currentIndex={currentIndex}
        currentTime={currentTime}
        dispatch={dispatch}
        duration={duration}
        formatTime={formatTime}
        isFullscreen={isFullscreen}
        isPlaying={isPlaying}
        muted={muted}
        seekToTime={seekToTime}
        setShowInfo={setShowInfo}
        setVolume={setVolume}
        toggleFullscreen={toggleFullscreen}
        videoQueue={videoQueue}
        volume={volume}
      />
      {/* ヘルプオーバーレイ */}
      <HelpOverlay
        helpVisible={helpVisible}
        setShowHelp={setShowHelp}
        shortcuts={shortcuts}
        showHelp={showHelp}
      />
      {/* トラック情報オーバーレイ */}
      <TrackInfoOverlay
        currentTrack={videoQueue[currentIndex] || null}
        infoVisible={infoVisible}
        setShowInfo={setShowInfo}
        showInfo={showInfo}
      />
    </div>
  );
};

export default VideoPlayer;
