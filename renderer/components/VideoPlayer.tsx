import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen } from "lucide-react";
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
import { initialState, videoQueueReducer } from "@/store/videoQueueReducer";
import placeholderImage from "../assets/video-placeholder.png";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
// カスタムフックのインポート
import { useMediaArtwork } from "../hooks/useMediaArtwork";
import { useMediaConversion } from "../hooks/useMediaConversion";
import { cleanupObjectUrls, useMediaFiles } from "../hooks/useMediaFiles";
import { useTauriEvents } from "../hooks/useTauriEvents";
import styles from "../styles/VideoPlayer.module.css";
import {
  DEFAULT_PLAYBACK_RATE,
  formatPlaybackRate,
  sanitizePlaybackRate,
} from "../utils/playbackRate";
import AudioPlayer from "./AudioPlayer";
import ConversionOverlay from "./ConversionOverlay";
import HelpOverlay from "./HelpOverlay";
// コンポーネントのインポート
import MediaControls from "./MediaControls";
import PlaylistPanel from "./PlaylistPanel";
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
  const [storedPlaybackRate, setStoredPlaybackRate] = useLocalStorageState(
    "playbackRate",
    { defaultValue: DEFAULT_PLAYBACK_RATE },
  );
  const playbackRate = sanitizePlaybackRate(storedPlaybackRate);
  // 保存値が壊れていても常に有効な速度だけを扱う
  const setPlaybackRate = useCallback(
    (value: ((prev: number) => number) | number) => {
      setStoredPlaybackRate((prev) =>
        sanitizePlaybackRate(
          typeof value === "function"
            ? value(sanitizePlaybackRate(prev))
            : value,
        ),
      );
    },
    [setStoredPlaybackRate],
  );
  // 速度変更時に一瞬だけ表示するOSD
  const [rateOsdVisible, setRateOsdVisible] = useState(false);
  const isFirstRateRender = useRef(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const [shouldShowPlayer, setShouldShowPlayer] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
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
  // ファイルを開く: Tauriのネイティブダイアログ（MKVのようにパスが必要な形式も開ける）
  // ブラウザだけで動かしているときは<input type="file">にフォールバックする
  const openFiles = useCallback(() => {
    invoke("open_media_dialog").catch(() => fileInputRef.current?.click());
  }, []);
  // 時間フォーマット関数
  const formatTime = useCallback((time: number): string => {
    const total = Math.max(0, Math.floor(time));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const mmss = `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;

    // 1時間以上の動画は h:mm:ss で表示
    return hours > 0 ? `${hours}:${mmss}` : mmss;
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
    openFiles,
    seekToTime,
    setPlaybackRate,
    setShowHelp,
    setShowInfo,
    setShowPlaylist,
    setVolume,
    showHelp,
    toggleFullscreen,
  });
  const currentItem = videoQueue[currentIndex];
  const { conversion, retry: retryConversion } = useMediaConversion(
    currentItem,
    dispatch,
  );
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

  // 速度が変わったらOSDを表示（初回マウント時は出さない）
  useEffect(() => {
    if (isFirstRateRender.current) {
      isFirstRateRender.current = false;

      return;
    }

    setRateOsdVisible(true);

    const timeout = setTimeout(() => setRateOsdVisible(false), 1200);

    return () => clearTimeout(timeout);
  }, [playbackRate]);

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
        onChange={(e) => void handleFileChange(e)}
        ref={fileInputRef}
        style={{ display: "none" }}
        type="file"
      />
      {/* 映像エリア（OSD・プレイリストはこの上に重ねる） */}
      <div className={styles.stage}>
        {/* 再生速度OSD */}
        <div
          aria-live="polite"
          className={`${styles.rateOsd} ${rateOsdVisible ? styles.rateOsdVisible : ""}`}
        >
          {formatPlaybackRate(playbackRate)}
        </div>
        {videoQueue.length > 0 ? (
          // プレーヤーエリア
          <div
            onClick={() =>
              dispatch({ type: "SET_IS_PLAYING", value: !isPlaying })
            }
            className={styles.playerArea}
            onDragOver={handleDragOver}
            onDrop={(e) => void handleDrop(e)}
          >
            {/* 音声ファイルの場合のプレースホルダー */}
            {videoQueue[currentIndex] && (
              <AudioPlayer currentItem={videoQueue[currentIndex]} />
            )}
            {/* ローディングスピナー */}
            {isBuffering && (
              <div className={styles.loadingOverlay}>
                <div className={styles.spinner} />
              </div>
            )}
            {/* メディアプレーヤー */}
            {/* MKVなどの変換中・変換失敗の表示 */}
            <ConversionOverlay
              fileName={
                currentItem ? `${currentItem.name}.${currentItem.ext}` : ""
              }
              onSkip={() => {
                dispatch({ type: "NEXT" });
                seekToTime(0);
                dispatch({ type: "SET_IS_PLAYING", value: true });
              }}
              conversion={conversion}
              hasNext={videoQueue.length > 1}
              onRetry={retryConversion}
            />
            {shouldShowPlayer && videoUrl && (
              <ReactPlayer
                onDurationChange={(
                  e: React.SyntheticEvent<HTMLVideoElement>,
                ) => {
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
                onLoadedMetadata={(
                  e: React.SyntheticEvent<HTMLVideoElement>,
                ) => {
                  // src読み込み時にplaybackRateがdefaultPlaybackRateへ戻るため両方設定
                  const media = e.currentTarget;

                  media.defaultPlaybackRate = playbackRate;
                  media.playbackRate = playbackRate;
                  media.preservesPitch = true;
                }}
                onPause={() =>
                  dispatch({ type: "SET_IS_PLAYING", value: false })
                }
                onTimeUpdate={(e: React.SyntheticEvent<HTMLVideoElement>) => {
                  const playedSeconds = e.currentTarget.currentTime;

                  if (Math.abs(playedSeconds - currentTimeRef.current) > 0.25) {
                    dispatch({ time: playedSeconds, type: "SET_CURRENT_TIME" });
                    currentTimeRef.current = playedSeconds;
                  }
                }}
                height="100%"
                key={videoUrl}
                loop={videoQueue.length <= 1}
                muted={muted}
                onCanPlayThrough={() => setIsBuffering(false)}
                onPlay={() => dispatch({ type: "SET_IS_PLAYING", value: true })}
                onWaiting={() => setIsBuffering(true)}
                playbackRate={playbackRate}
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
            onClick={openFiles}
            onDragOver={handleDragOver}
            onDrop={(e) => void handleDrop(e)}
          >
            <div className={styles.emptyState}>
              <img
                alt=""
                className={styles.placeholderImage}
                src={placeholderImage}
              />
              <p className={styles.emptyTitle}>
                Drop a video or audio file here
              </p>
              <p className={styles.emptyHint}>
                <FolderOpen size={14} />
                or click to open (O)
              </p>
            </div>
          </div>
        )}
        {/* プレイリスト */}
        <PlaylistPanel
          currentIndex={currentIndex}
          dispatch={dispatch}
          onClose={() => setShowPlaylist(false)}
          seekToTime={seekToTime}
          show={showPlaylist}
          videoQueue={videoQueue}
        />
      </div>
      {/* 再生コントロール */}
      <MediaControls
        currentIndex={currentIndex}
        currentTime={currentTime}
        dispatch={dispatch}
        // 変換待ちのファイルでは前のファイルの長さを出さない
        duration={videoUrl ? duration : 0}
        formatTime={formatTime}
        isFullscreen={isFullscreen}
        isPlaying={isPlaying}
        muted={muted}
        playbackRate={playbackRate}
        seekToTime={seekToTime}
        setPlaybackRate={setPlaybackRate}
        setShowHelp={setShowHelp}
        setShowInfo={setShowInfo}
        setShowPlaylist={setShowPlaylist}
        setVolume={setVolume}
        showPlaylist={showPlaylist}
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
