// eslint-disable-next-line filenames/match-regex
import {
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
import React, { useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player";
import placeholderImage from "../assets/video-placeholder.png";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import styles from "../styles/VideoPlayer.module.css";

type VideoItem = {
  name: string;
  url: string;
};

const VideoPlayer: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoQueue, setVideoQueue] = useState<VideoItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState<null | string>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentTimeRef = useRef(0);
  const [, forceRender] = useState({});
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [playerRef, setPlayerRef] = useState<null | ReactPlayer>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const isAudioFile = (filename: string): boolean =>
    /\.(mp3|wav|m4a|flac|aac)$/i.test(filename);
  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);

    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || []);
    const urls = files
      .filter(
        (file) =>
          file.type.startsWith("video/") || file.type.startsWith("audio/"),
      )
      .map((file) => {
        const url = URL.createObjectURL(file);

        return { name: file.name, url };
      });

    if (urls.length > 0) {
      setVideoQueue(urls);
      setCurrentIndex(0);
      currentTimeRef.current = 0;
      setDuration(0);
      document.title = urls[0].name.replace(/\.[^/.]+$/, "");
      setIsPlaying(true);
    }
  };
  const handleNext = (): void => {
    if (videoQueue.length > 0) {
      setCurrentIndex((prev) => {
        const nextIndex =
          videoQueue.length === 1 ? 0 : (prev + 1) % videoQueue.length;

        return nextIndex;
      });
      currentTimeRef.current = 0;
      setCurrentTime(0);
      if (playerRef) playerRef.seekTo(0, "seconds");
      setDuration(0);
      setIsPlaying(true);
    }
  };
  const handlePrevious = (): void => {
    if (videoQueue.length === 1) return;

    if (currentTimeRef.current > 5) {
      currentTimeRef.current = 0;
      setCurrentTime(0);
      playerRef?.seekTo(0, "seconds");
      setDuration(0);
      setIsPlaying(true);
    } else if (videoQueue.length > 1) {
      setCurrentIndex((prev) => {
        const prevIndex =
          videoQueue.length === 1
            ? 0
            : (prev - 1 + videoQueue.length) % videoQueue.length;

        return prevIndex;
      });
      currentTimeRef.current = 0;
      setCurrentTime(0);
      playerRef?.seekTo(0, "seconds");
      setDuration(0);
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (videoQueue.length > 0) {
      const { name, url } = videoQueue[currentIndex];

      setVideoUrl(url);
      setCurrentTime(0);
      document.title = name.replace(/\.[^/.]+$/, "") || "Video Player";
    }
  }, [videoQueue, currentIndex]);

  useEffect(() => {
    const savedVolume = localStorage.getItem("volume");

    if (savedVolume) {
      const parsed = parseFloat(savedVolume);

      setVolume(parsed);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return (): void => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const handleDrop = (e: DragEvent): void => {
      e.preventDefault();

      const files = Array.from(e.dataTransfer?.files || []);
      const urls = files
        .filter(
          (file) =>
            file.type.startsWith("video/") || file.type.startsWith("audio/"),
        )
        .map((file) => {
          const url = URL.createObjectURL(file);

          return { name: file.name, url };
        });

      if (urls.length > 0) {
        setVideoQueue(urls);
        setCurrentIndex(0);
        currentTimeRef.current = 0;
        setDuration(0);
        document.title = urls[0].name.replace(/\.[^/.]+$/, "");
        setIsPlaying(true);
      }
    };
    const handleDragOver = (e: DragEvent): void => {
      e.preventDefault();
    };

    window.addEventListener("drop", handleDrop);
    window.addEventListener("dragover", handleDragOver);

    return (): void => {
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragover", handleDragOver);
    };
  }, []);

  useEffect(() => {
    if (videoUrl && playerRef) {
      currentTimeRef.current = 0;
      playerRef.seekTo(0, "seconds");
    }
  }, [videoUrl, playerRef]);

  useKeyboardShortcuts({
    containerRef,
    currentTimeRef,
    duration,
    fileInputRef,
    forceRender: () => forceRender({}),
    playerRef,
    setCurrentTime,
    setIsPlaying,
    setMuted,
    setVolume,
    videoUrl,
    volume,
  });

  useEffect(() => {
    const { ipcRenderer } = window.require("electron");
    const handleOpenFile = (_: any, filePaths: string[]) => {
      const fs = window.require("fs");
      const path = window.require("path");
      const items = filePaths
        .map((filePath) => {
          const ext = path.extname(filePath).toLowerCase();
          const mime =
            ext === ".mp3" || ext === ".m4a" || ext === ".wav"
              ? "audio/" + ext.slice(1)
              : "video/" + ext.slice(1);
          const buffer = fs.readFileSync(filePath);
          const blob = new Blob([buffer], { type: mime });
          const url = URL.createObjectURL(blob);
          const fileName =
            filePath
              .split("/")
              .pop()
              ?.replace(/\.[^/.]+$/, "") || "Video Player";

          return { name: fileName, url };
        })
        .filter(Boolean);

      if (items.length > 0) {
        document.title = items[0].name;
        setVideoQueue(items);
        setCurrentIndex(0);
        currentTimeRef.current = 0;
        setDuration(0);
        setIsPlaying(true);
      }
    };

    ipcRenderer.on("open-file", handleOpenFile);

    return () => {
      ipcRenderer.removeListener("open-file", handleOpenFile);
    };
  }, []);

  return (
    <div className={styles.container} ref={containerRef}>
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
          className={styles.playerArea}
          onClick={() => setIsPlaying((prev) => !prev)}
        >
          {videoQueue[currentIndex] &&
            isAudioFile(videoQueue[currentIndex].name) && (
              <div className={styles.placeholder}>
                <img
                  alt="placeholder"
                  className={styles.placeholderImage}
                  src={placeholderImage}
                />
              </div>
            )}
          <ReactPlayer
            onEnded={() => {
              if (videoQueue.length > 1) {
                setCurrentIndex((prev) => (prev + 1) % videoQueue.length);
                setIsPlaying(true);
              }
            }}
            onProgress={({ playedSeconds }) => {
              currentTimeRef.current = playedSeconds;
              setCurrentTime(playedSeconds);
              forceRender({});
            }}
            height="100%"
            key={videoUrl}
            loop={videoQueue.length <= 1}
            muted={muted}
            onDuration={(dur) => setDuration(dur)}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            playing={isPlaying}
            ref={(ref) => setPlayerRef(ref)}
            url={videoUrl}
            volume={volume}
            width="100%"
          />
        </div>
      ) : (
        <div
          className={styles.dropZone}
          onClick={() => fileInputRef.current?.click()}
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
          className={styles.controlButton}
          onClick={() => setIsPlaying((p) => !p)}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          onClick={() => {
            setIsPlaying(false);
            currentTimeRef.current = 0;
            if (playerRef) playerRef.seekTo(0, "seconds");
            forceRender({});
          }}
          className={styles.controlButton}
        >
          <StopCircle size={18} />
        </button>
        <button
          className={styles.controlButton}
          disabled={videoQueue.length === 1}
          onClick={handlePrevious}
          title="Previous"
        >
          <SkipBack size={18} />
        </button>
        <button
          className={styles.controlButton}
          onClick={handleNext}
          title="Next"
        >
          <SkipForward size={18} />
        </button>
        <input
          onChange={(e) => {
            const val = Number(e.target.value);

            currentTimeRef.current = val;
            setCurrentTime(val);
            playerRef?.seekTo(val, "seconds");
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

            setMuted(false);
            setVolume(vol);
            localStorage.setItem("volume", vol.toString());
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
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else if (containerRef.current?.requestFullscreen) {
              containerRef.current.requestFullscreen();
            }
          }}
          className={styles.controlButton}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <p className={styles.timeInfo}>
          {formatTime(currentTimeRef.current)} / {formatTime(duration)}
        </p>
      </div>
    </div>
  );
};

export default VideoPlayer;
