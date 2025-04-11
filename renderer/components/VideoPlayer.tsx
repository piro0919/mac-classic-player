import React, { useEffect, useRef, useState } from "react";
import styles from "../styles/VideoPlayer.module.css";
import ReactPlayer from "react-player";
import {
  Play,
  Pause,
  StopCircle,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
} from "lucide-react";
import placeholderImage from "../assets/video-placeholder.png";

const VideoPlayer: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [playerRef, setPlayerRef] = useState<ReactPlayer | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setCurrentTime(0);
      setDuration(0);
      document.title = file.name;
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    const savedVolume = localStorage.getItem("volume");
    if (savedVolume) {
      const parsed = parseFloat(savedVolume);
      setVolume(parsed);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (
        file &&
        (file.type.startsWith("video/") || file.type.startsWith("audio/"))
      ) {
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
        setCurrentTime(0);
        setDuration(0);
        document.title = file.name;
        setIsPlaying(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    window.addEventListener("drop", handleDrop);
    window.addEventListener("dragover", handleDragOver);

    return () => {
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragover", handleDragOver);
    };
  }, []);

  useEffect(() => {
    if (videoUrl && playerRef) {
      playerRef.seekTo(currentTime, "seconds");
    }
  }, [videoUrl, playerRef]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!videoUrl) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          setIsPlaying((prev) => !prev);
          break;
        case "s":
        case "S":
          e.preventDefault();
          setIsPlaying(false);
          setCurrentTime(0);
          if (playerRef) playerRef.seekTo(0, "seconds");
          break;
        case "ArrowRight":
          e.preventDefault();
          if (playerRef) {
            const newTime = Math.min(currentTime + 5, duration);
            playerRef.seekTo(newTime, "seconds");
            setCurrentTime(newTime);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (playerRef) {
            const newTime = Math.max(currentTime - 5, 0);
            playerRef.seekTo(newTime, "seconds");
            setCurrentTime(newTime);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          const increasedVol = Math.min(volume + 0.1, 1);
          setVolume(increasedVol);
          localStorage.setItem("volume", increasedVol.toString());
          break;
        case "ArrowDown":
          e.preventDefault();
          const decreasedVol = Math.max(volume - 0.1, 0);
          setVolume(decreasedVol);
          localStorage.setItem("volume", decreasedVol.toString());
          break;
        case "m":
        case "M":
          e.preventDefault();
          setMuted((prev) => !prev);
          break;
        case "f":
        case "F":
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else if (containerRef.current?.requestFullscreen) {
            containerRef.current.requestFullscreen();
          }
          break;
        case "o":
        case "O":
          e.preventDefault();
          fileInputRef.current?.click();
          break;
        default:
          // 0-9 number seek
          if (e.key >= "0" && e.key <= "9") {
            const percent = parseInt(e.key, 10) * 0.1;
            const newTime = duration * percent;
            if (playerRef) playerRef.seekTo(newTime, "seconds");
            setCurrentTime(newTime);
          }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [videoUrl, playerRef, currentTime, volume, duration]);

  useEffect(() => {
    const { ipcRenderer } = window.require("electron");
    // @ts-expect-error
    ipcRenderer.on("open-file", (_, filePath) => {
      setVideoUrl(filePath);
      setCurrentTime(0);
      setDuration(0);
      document.title = filePath.split("/").pop() || "Video Player";
      setIsPlaying(true);
    });
  }, []);

  return (
    <div ref={containerRef} className={styles.container}>
      <input
        type="file"
        accept="video/*,audio/*"
        style={{ display: "none" }}
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      {videoUrl ? (
        <div
          className={styles.playerArea}
          onClick={() => setIsPlaying((prev) => !prev)}
        >
          <ReactPlayer
            url={videoUrl}
            ref={(ref) => setPlayerRef(ref)}
            playing={isPlaying}
            volume={volume}
            muted={muted}
            width="100%"
            height="100%"
            onProgress={({ playedSeconds }) => setCurrentTime(playedSeconds)}
            onDuration={(dur) => setDuration(dur)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        </div>
      ) : (
        <div
          className={styles.dropZone}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className={styles.placeholder}>
            <img
              src={placeholderImage}
              alt="Video placeholder"
              className={styles.placeholderImage}
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
          className={styles.controlButton}
          onClick={() => {
            setIsPlaying(false);
            setCurrentTime(0);
            if (playerRef) playerRef.seekTo(0, "seconds");
          }}
        >
          <StopCircle size={18} />
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={currentTime}
          onChange={(e) => {
            const val = Number(e.target.value);
            if (playerRef) playerRef.seekTo(val, "seconds");
            setCurrentTime(val);
          }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => {
            const vol = Number(e.target.value);
            setVolume(vol);
            localStorage.setItem("volume", vol.toString());
          }}
        />
        <button
          className={styles.controlButton}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button
          className={styles.controlButton}
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else if (containerRef.current?.requestFullscreen) {
              containerRef.current.requestFullscreen();
            }
          }}
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
