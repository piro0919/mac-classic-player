import { useEffect } from "react";
import { type ReactPlayerInstance } from "react-player";

type UseKeyboardShortcutsProps = {
  containerRef: React.RefObject<HTMLDivElement>;
  currentTimeRef: React.MutableRefObject<number>;
  duration: number;
  fileInputRef: React.RefObject<HTMLInputElement>;
  forceRender: () => void;
  playerRef: null | ReactPlayerInstance;
  setCurrentTime: (v: number) => void;
  setIsPlaying: (v: (prev: boolean) => boolean) => void;
  setMuted: (v: (prev: boolean) => boolean) => void;
  setVolume: (v: number) => void;
  videoUrl: null | string;
  volume: number;
};

const useKeyboardShortcuts = ({
  containerRef,
  currentTimeRef,
  duration,
  fileInputRef,
  forceRender,
  playerRef,
  setCurrentTime,
  setIsPlaying,
  setMuted,
  setVolume,
  videoUrl,
  volume,
}: UseKeyboardShortcutsProps): void => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
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

          const increasedVol = Math.min(volume + 0.05, 1);

          setVolume(increasedVol);
          localStorage.setItem("volume", increasedVol.toString());

          break;
        case "ArrowDown":
          e.preventDefault();

          const decreasedVol = Math.max(volume - 0.05, 0);

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
    videoUrl,
    playerRef,
    volume,
    duration,
    setVolume,
    setIsPlaying,
    setMuted,
    setCurrentTime,
    currentTimeRef,
    fileInputRef,
    containerRef,
    forceRender,
  ]);
};

export default useKeyboardShortcuts;
