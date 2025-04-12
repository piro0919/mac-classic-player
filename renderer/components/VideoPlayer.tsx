import { initialState, videoQueueReducer } from "@/store/videoQueueReducer";
import { extractVideoItemsFromDrop } from "@/utils/fileUtils";
import { useFullscreen } from "@mantine/hooks";
import {
  FileMusic,
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
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import ReactPlayer from "react-player";
import useLocalStorageState from "use-local-storage-state";
import placeholderImage from "../assets/video-placeholder.png";
import styles from "../styles/VideoPlayer.module.css";

const VideoPlayer: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentTimeRef = useRef(0);
  const playerRef = useRef<null | ReactPlayer>(null);
  const [videoState, dispatch] = useReducer(videoQueueReducer, initialState);
  const [volume, setVolume] = useLocalStorageState("volume", {
    defaultValue: 1,
  });
  const {
    currentIndex,
    currentTime,
    duration,
    isPlaying,
    muted,
    queue: videoQueue,
  } = videoState;
  const {
    fullscreen: isFullscreen,
    ref: fullscreenRef,
    toggle: toggleFullscreen,
  } = useFullscreen();
  const videoUrl = useMemo(
    () => videoQueue[currentIndex]?.url ?? null,
    [videoQueue, currentIndex],
  );
  const formatTime = useCallback((time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);

    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, []);
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const files = Array.from(e.target.files || []);
      const urls = files
        .filter(
          (file) =>
            file.type.startsWith("video/") || file.type.startsWith("audio/"),
        )
        .map((file) => {
          const [baseName, ext] = file.name.split(/\.(?=[^.]+$)/); // 最後のドットで分割
          const url = URL.createObjectURL(file);

          return { ext, name: baseName, url };
        });

      if (urls.length > 0) {
        dispatch({ files: urls, type: "LOAD_FILES" });
        dispatch({ time: 0, type: "SET_CURRENT_TIME" });
        dispatch({ time: 0, type: "SET_DURATION" });
        document.title = urls[0].name || "Video Player";
        dispatch({ type: "SET_IS_PLAYING", value: true });
      }
    },
    [],
  );
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
    },
    [],
  );
  const seekToTime = useCallback((time: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(time, "seconds");
    }

    currentTimeRef.current = time;
    dispatch({ time, type: "SET_CURRENT_TIME" });
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      const items = extractVideoItemsFromDrop(e);

      if (items.length > 0) {
        dispatch({ files: items, type: "LOAD_FILES" });
        seekToTime(0);
        dispatch({ time: 0, type: "SET_DURATION" });
        document.title = items[0].name || "Video Player";
        dispatch({ type: "SET_IS_PLAYING", value: true });
      }
    },
    [dispatch, seekToTime],
  );

  useEffect(() => {
    if (videoQueue.length > 0) {
      const { name } = videoQueue[currentIndex];

      dispatch({ time: 0, type: "SET_CURRENT_TIME" });
      document.title = name || "Video Player";
    }
  }, [videoQueue, currentIndex]);

  useEffect(() => {
    const { ipcRenderer } = window.require("electron");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleOpenFile = (_: any, filePaths: string[]) => {
      const fs = window.require("fs");
      const items = filePaths
        .map((filePath) => {
          const fileName = filePath.split("/").pop() || "Video Player";
          const [baseName, ext] = fileName.split(/\.(?=[^.]+$)/);
          const buffer = fs.readFileSync(filePath);
          const mime =
            ext === "mp3" || ext === "m4a" || ext === "wav"
              ? "audio/" + ext
              : "video/" + ext;
          const blob = new Blob([buffer], { type: mime });
          const url = URL.createObjectURL(blob);

          return { ext, name: baseName, url };
        })
        .filter(Boolean);

      if (items.length > 0) {
        document.title = items[0].name || "Video Player";
        dispatch({ files: items, type: "LOAD_FILES" });
        dispatch({ time: 0, type: "SET_CURRENT_TIME" });
        dispatch({ time: 0, type: "SET_DURATION" });
        dispatch({ type: "SET_IS_PLAYING", value: true });
      }
    };

    ipcRenderer.on("open-file", handleOpenFile);

    return () => {
      ipcRenderer.removeListener("open-file", handleOpenFile);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^Digit[0-9]$/.test(e.code)) {
        e.preventDefault();

        const num = Number(e.code.replace("Digit", ""));

        seekToTime(duration * num * 0.1);

        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          dispatch({ type: "TOGGLE_PLAY" });

          break;
        case "ArrowRight":
          e.preventDefault();
          seekToTime(Math.min(currentTime + 5, duration));

          break;
        case "ArrowLeft":
          e.preventDefault();
          seekToTime(Math.max(currentTime - 5, 0));

          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((prev) =>
            Math.min(1, Math.round((prev + 0.05) * 100) / 100),
          );

          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((prev) =>
            Math.max(0, Math.round((prev - 0.05) * 100) / 100),
          );

          break;
        case "KeyS":
          e.preventDefault();
          dispatch({ type: "STOP" });
          seekToTime(0);

          break;
        case "KeyA":
          e.preventDefault();

          if (currentTimeRef.current < 5) {
            dispatch({ type: "PREVIOUS" });
          }

          seekToTime(0);
          dispatch({ type: "SET_IS_PLAYING", value: true });

          break;
        case "KeyD":
          e.preventDefault();
          dispatch({ type: "NEXT" });
          seekToTime(0);
          dispatch({ type: "SET_IS_PLAYING", value: true });

          break;
        case "KeyM":
          e.preventDefault();
          dispatch({ type: "TOGGLE_MUTED" });

          break;
        case "KeyF":
          e.preventDefault();
          toggleFullscreen();

          break;
        case "KeyO":
          e.preventDefault();
          fileInputRef.current?.click();

          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    currentTime,
    duration,
    dispatch,
    seekToTime,
    setVolume,
    toggleFullscreen,
  ]);

  return (
    <div className={styles.container} ref={fullscreenRef}>
      <input
        accept="video/*,audio/*"
        multiple={true}
        onChange={handleFileChange}
        ref={fileInputRef}
        style={{ display: "none" }}
        type="file"
      />
      {videoUrl ? (
        <div
          onClick={() =>
            dispatch({ type: "SET_IS_PLAYING", value: !isPlaying })
          }
          className={styles.playerArea}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {videoQueue[currentIndex] &&
            ["mp3", "wav", "m4a", "flac", "aac"].includes(
              videoQueue[currentIndex].ext,
            ) && (
              <div className={styles.placeholder}>
                <FileMusic className={styles.fileMusicIcon} size={120} />
              </div>
            )}
          <ReactPlayer
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
            onProgress={({ playedSeconds }) => {
              if (Math.abs(playedSeconds - currentTimeRef.current) > 0.25) {
                dispatch({ time: playedSeconds, type: "SET_CURRENT_TIME" });
              }
            }}
            height="100%"
            key={videoUrl}
            loop={videoQueue.length <= 1}
            muted={muted}
            onDuration={(dur) => dispatch({ time: dur, type: "SET_DURATION" })}
            onPause={() => dispatch({ type: "SET_IS_PLAYING", value: false })}
            onPlay={() => dispatch({ type: "SET_IS_PLAYING", value: true })}
            playing={isPlaying}
            ref={playerRef}
            url={videoUrl}
            volume={volume}
            width="100%"
          />
        </div>
      ) : (
        <div
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
      <div className={styles.controls}>
        <button
          onClick={() =>
            dispatch({ type: "SET_IS_PLAYING", value: !isPlaying })
          }
          className={styles.controlButton}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          onClick={() => {
            dispatch({ type: "STOP" });
            seekToTime(0);
          }}
          className={styles.controlButton}
        >
          <StopCircle size={18} />
        </button>
        <button
          onClick={() => {
            if (currentTimeRef.current < 5) {
              dispatch({ type: "PREVIOUS" });
            }

            seekToTime(0);
            dispatch({ type: "SET_IS_PLAYING", value: true });
          }}
          className={styles.controlButton}
          disabled={videoQueue.length === 0}
          title="Previous"
        >
          <SkipBack size={18} />
        </button>
        <button
          onClick={() => {
            dispatch({ type: "NEXT" });
            seekToTime(0);
            dispatch({ type: "SET_IS_PLAYING", value: true });
          }}
          className={styles.controlButton}
          title="Next"
        >
          <SkipForward size={18} />
        </button>
        <input
          onChange={(e) => {
            const val = Number(e.target.value);

            seekToTime(val);
          }}
          className={styles.input}
          max={duration}
          min={0}
          step={0.1}
          type="range"
          value={currentTime}
        />
        <input
          onChange={(e) => {
            const vol = Number(e.target.value);

            dispatch({ type: "SET_MUTED", value: false });
            setVolume(vol);
          }}
          className={styles.input}
          max={1}
          min={0}
          step={0.01}
          type="range"
          value={volume}
        />
        <button
          className={styles.controlButton}
          onClick={() => dispatch({ type: "TOGGLE_MUTED" })}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={async () => {
            await toggleFullscreen();
          }}
          className={styles.controlButton}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <p className={styles.timeInfo}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </p>
      </div>
    </div>
  );
};

export default VideoPlayer;
