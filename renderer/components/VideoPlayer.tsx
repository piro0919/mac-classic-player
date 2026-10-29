import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen } from "lucide-react";
// VideoPlayer.tsx (メインコンポーネント)
import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import useLocalStorageState from "use-local-storage-state";
import { initialState, videoQueueReducer } from "@/store/videoQueueReducer";
import placeholderImage from "../assets/video-placeholder.png";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
// カスタムフックのインポート
import { useMediaArtwork } from "../hooks/useMediaArtwork";
import { useMpvPlayer, useVideoRect } from "../hooks/useMpvPlayer";
import { useTauriEvents } from "../hooks/useTauriEvents";
import styles from "../styles/VideoPlayer.module.css";
import { AUDIO_EXTENSIONS } from "../utils/mediaFile";
import {
  DEFAULT_PLAYBACK_RATE,
  formatPlaybackRate,
  sanitizePlaybackRate,
} from "../utils/playbackRate";
import AudioPlayer from "./AudioPlayer";
import HelpOverlay from "./HelpOverlay";
// コンポーネントのインポート
import MediaControls from "./MediaControls";
import PlayerNotice, { type Notice } from "./PlayerNotice";
import PlaylistPanel from "./PlaylistPanel";
import TrackInfoOverlay from "./TrackInfoOverlay";
import TrackMenu from "./TrackMenu";

const VideoPlayer: React.FC = () => {
  // Refs
  const currentTimeRef = useRef(0);
  // 映像エリア（ここにネイティブの映像ビューを合わせる）
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
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
  const currentItem = videoQueue[currentIndex];
  // ファイルを開く（Tauriのネイティブダイアログ）
  const openFiles = useCallback(() => {
    invoke("open_media_dialog").catch(() => {});
  }, []);
  // 再生が終わったら次のファイルへ（1つだけのときは mpv 側で繰り返す）
  const handleEnded = useCallback(() => {
    if (videoQueue.length > 1) {
      dispatch({ type: "NEXT" });
      dispatch({ type: "SET_IS_PLAYING", value: true });
    }
  }, [videoQueue.length]);
  const mpv = useMpvPlayer({
    currentItem,
    dispatch,
    isPlaying,
    loopSingle: videoQueue.length <= 1,
    muted,
    onEnded: handleEnded,
    playbackRate,
    volume,
  });
  const { seek: mpvSeek } = mpv;
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
  // シーク（mpv に送り、表示はすぐに更新する）
  const seekToTime = useCallback(
    (time: number) => {
      mpvSeek(time);
      currentTimeRef.current = time;
      dispatch({ time, type: "SET_CURRENT_TIME" });
    },
    [mpvSeek],
  );
  // 音声・字幕トラックを順番に切り替える
  const cycleTrack = useCallback(
    (type: "audio" | "sub") => {
      const ids = mpv.tracks.filter((t) => t.type === type).map((t) => t.id);
      const current = type === "audio" ? mpv.audioId : mpv.subtitleId;
      // 字幕は「オフ」も順番に含める
      const order: ("no" | number)[] = type === "sub" ? ["no", ...ids] : ids;

      if (order.length === 0) return;

      const next = order[(order.indexOf(current) + 1) % order.length];

      if (type === "audio") mpv.selectAudio(next);
      else mpv.selectSubtitle(next);
    },
    [mpv],
  );

  // カスタムフックの使用
  useMediaArtwork(videoQueue, dispatch);

  const { shortcuts } = useKeyboardShortcuts({
    currentTime,
    currentTimeRef,
    cycleAudio: () => cycleTrack("audio"),
    cycleSubtitle: () => cycleTrack("sub"),
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

  useTauriEvents(dispatch, seekToTime, setShowHelp);

  // 映像があるファイルか（トラック一覧が届くまでは拡張子で判断）
  const hasVideo =
    mpv.tracks.length > 0
      ? mpv.tracks.some((t) => t.type === "video" && !t.albumart)
      : !!currentItem && !AUDIO_EXTENSIONS.includes(currentItem.ext);
  // 案内を出すとき（エンジンが無い・再生できない）は映像を隠す
  const notice: Notice | null =
    mpv.status.kind === "missing"
      ? { kind: "mpv-missing" }
      : mpv.status.kind === "error"
        ? { kind: "engine-error", message: mpv.status.message }
        : currentItem && mpv.playbackError
          ? {
              fileName: `${currentItem.name}.${currentItem.ext}`,
              kind: "playback-error",
              message: mpv.playbackError,
            }
          : null;
  const showVideo =
    mpv.status.kind === "ready" && !!currentItem && hasVideo && !notice;

  useVideoRect(stageElement, showVideo);

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

  return (
    <div className={styles.container} ref={fullscreenRef}>
      {/* 映像エリア（ネイティブの映像はこの下に描かれる。OSD・プレイリストは上に重ねる） */}
      <div
        className={`${styles.stage} ${showVideo ? styles.stageVideo : ""}`}
        ref={setStageElement}
      >
        {/* 再生速度OSD */}
        <div
          aria-live="polite"
          className={`${styles.rateOsd} ${rateOsdVisible ? styles.rateOsdVisible : ""}`}
        >
          {formatPlaybackRate(playbackRate)}
        </div>
        {videoQueue.length > 0 || notice ? (
          // プレーヤーエリア（クリックで再生/一時停止）
          <div
            onClick={() =>
              dispatch({ type: "SET_IS_PLAYING", value: !isPlaying })
            }
            className={styles.playerArea}
          >
            {/* 音声ファイルのジャケット */}
            {currentItem && !hasVideo && (
              <AudioPlayer currentItem={currentItem} />
            )}
            {/* 読み込み中 */}
            {mpv.buffering && !notice && (
              <div className={styles.loadingOverlay}>
                <div className={styles.spinner} />
              </div>
            )}
            <PlayerNotice
              onRetry={() => {
                if (notice?.kind === "playback-error") mpv.reloadFile();
                else mpv.retryEngine();
              }}
              onSkip={() => {
                dispatch({ type: "NEXT" });
                dispatch({ type: "SET_IS_PLAYING", value: true });
              }}
              hasNext={videoQueue.length > 1}
              notice={notice}
            />
          </div>
        ) : (
          // ドロップゾーン（ファイルがロードされていない場合）
          // ファイルのドロップは Tauri のネイティブイベントで受け取る（useTauriEvents）
          <div
            aria-label="Drop media files here or click to select"
            className={styles.dropZone}
            onClick={openFiles}
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
        trackMenu={
          <TrackMenu
            audioId={mpv.audioId}
            disabled={mpv.status.kind !== "ready" || !currentItem}
            onOpenSubtitleFile={mpv.openSubtitleFile}
            onSelectAudio={mpv.selectAudio}
            onSelectSubtitle={mpv.selectSubtitle}
            subtitleId={mpv.subtitleId}
            tracks={mpv.tracks}
          />
        }
        currentIndex={currentIndex}
        currentTime={currentTime}
        dispatch={dispatch}
        // 再生できないファイルでは前のファイルの長さを出さない
        duration={notice ? 0 : duration}
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
