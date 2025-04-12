import { type MutableRefObject, type RefObject, useEffect } from "react";
import type ReactPlayer from "react-player";

type UseKeyboardShortcutsProps = {
  currentTimeRef: MutableRefObject<number>;
  duration: number;
  fileInputRef: RefObject<HTMLInputElement | null>;
  forceRender: () => void;
  playerRef: null | ReactPlayer;
  setCurrentTime: (v: number) => void;
  setIsPlaying: (v: (prev: boolean) => boolean) => void;
  setMuted: (v: (prev: boolean) => boolean) => void;
  setVolume: (v: number) => void;
  toggleFullscreen: () => void;
  videoUrl: null | string;
  volume: number;
};

const useKeyboardShortcuts = ({
  currentTimeRef,
  duration,
  fileInputRef,
  forceRender,
  playerRef,
  setCurrentTime,
  setIsPlaying,
  setMuted,
  setVolume,
  toggleFullscreen,
  volume,
}: UseKeyboardShortcutsProps): void => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      switch (e.key) {
        case " ":
          e.preventDefault();
          setIsPlaying((prev) => !prev);

          break;
        case "s":
        case "S":
          e.preventDefault();
          setIsPlaying(() => false);
          currentTimeRef.current = 0;
          playerRef?.seekTo(0, "seconds");
          setCurrentTime(0);

          break;
        case "ArrowRight":
          e.preventDefault();

          if (playerRef) {
            const newTime = Math.min(currentTimeRef.current + 5, duration);

            playerRef.seekTo(newTime, "seconds");
            currentTimeRef.current = newTime;
            setCurrentTime(newTime);
            forceRender();
          }

          break;
        case "ArrowLeft":
          e.preventDefault();

          if (playerRef) {
            const newTime = Math.max(currentTimeRef.current - 5, 0);

            playerRef.seekTo(newTime, "seconds");
            currentTimeRef.current = newTime;
            setCurrentTime(newTime);
            forceRender();
          }

          break;
        case "ArrowUp":
          e.preventDefault();

          // eslint-disable-next-line no-case-declarations
          const increasedVol = Math.min(volume + 0.05, 1);

          setVolume(increasedVol);

          break;
        case "ArrowDown":
          e.preventDefault();

          // eslint-disable-next-line no-case-declarations
          const decreasedVol = Math.max(volume - 0.05, 0);

          setVolume(decreasedVol);

          break;
        case "m":
        case "M":
          e.preventDefault();
          setMuted((prev) => !prev);

          break;
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();

          break;
        case "o":
        case "O":
          e.preventDefault();
          fileInputRef.current?.click();

          break;
        default:
          if (e.key >= "0" && e.key <= "9") {
            const percent = parseInt(e.key, 10) * 0.1;
            const newTime = duration * percent;

            playerRef?.seekTo(newTime, "seconds");
            currentTimeRef.current = newTime;
            setCurrentTime(newTime);
            forceRender();
          }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    playerRef,
    duration,
    setIsPlaying,
    setMuted,
    setCurrentTime,
    currentTimeRef,
    fileInputRef,
    forceRender,
    toggleFullscreen,
    setVolume,
    volume,
  ]);
};

export default useKeyboardShortcuts;
