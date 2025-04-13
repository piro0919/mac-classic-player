import { useCallback, useEffect } from "react";
import { type VideoQueueAction } from "../store/videoQueueReducer";

type KeyboardShortcutsProps = {
  currentTime: number;
  currentTimeRef: React.MutableRefObject<number>;
  dispatch: React.Dispatch<VideoQueueAction>;
  duration: number;
  fileInputRef: React.RefObject<HTMLInputElement>;
  seekToTime: (time: number) => void;
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
  setShowInfo: React.Dispatch<React.SetStateAction<boolean>>;
  setVolume: (value: ((prev: number) => number) | number) => void;
  showHelp: boolean;
  toggleFullscreen: () => Promise<void>;
};

export const useKeyboardShortcuts = ({
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
}: KeyboardShortcutsProps) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 0-9キー: 再生位置を0-90%に
      if (e.code.startsWith("Digit") && e.code.length === 6) {
        const num = Number(e.code[5]);

        if (!isNaN(num)) {
          e.preventDefault();
          seekToTime(duration * num * 0.1);

          return;
        }
      }

      // ?キー: ヘルプ表示トグル
      if (e.code === "Slash" && e.shiftKey) {
        e.preventDefault();
        setShowHelp((prev) => !prev);

        return;
      }

      // Escキー: ヘルプを閉じる
      if (e.code === "Escape" && showHelp) {
        e.preventDefault();
        setShowHelp(false);

        return;
      }

      // その他のショートカット
      switch (e.code) {
        case "Space": // 再生/一時停止
          e.preventDefault();
          dispatch({ type: "TOGGLE_PLAY" });

          break;
        case "ArrowRight": // 5秒進む
          e.preventDefault();
          seekToTime(Math.min(currentTime + 5, duration));

          break;
        case "ArrowLeft": // 5秒戻る
          e.preventDefault();
          seekToTime(Math.max(currentTime - 5, 0));

          break;
        case "ArrowUp": // 音量増加
          e.preventDefault();
          setVolume((prev) =>
            Math.min(1, Math.round((prev + 0.05) * 100) / 100),
          );

          break;
        case "ArrowDown": // 音量減少
          e.preventDefault();
          setVolume((prev) =>
            Math.max(0, Math.round((prev - 0.05) * 100) / 100),
          );

          break;
        case "KeyS": // 停止
          e.preventDefault();
          dispatch({ type: "STOP" });
          seekToTime(0);

          break;
        case "KeyA":
          e.preventDefault();

          if (currentTimeRef.current < 5) {
            dispatch({ type: "PREVIOUS" });
            seekToTime(0);
            dispatch({ type: "SET_IS_PLAYING", value: true });
          } else {
            // 5秒以上なら曲の先頭に戻るだけ
            seekToTime(0);
          }

          break;
        case "KeyD": // 次の曲
          e.preventDefault();
          dispatch({ type: "NEXT" });
          seekToTime(0);
          dispatch({ type: "SET_IS_PLAYING", value: true });

          break;
        case "KeyM": // ミュートトグル
          e.preventDefault();
          dispatch({ type: "TOGGLE_MUTED" });

          break;
        case "KeyF": // フルスクリーントグル
          e.preventDefault();
          void toggleFullscreen();

          break;
        case "KeyO": // ファイル選択ダイアログを開く
          e.preventDefault();
          fileInputRef.current?.click();

          break;
        case "KeyI": // トラック情報表示トグル
          e.preventDefault();
          setShowInfo((prev) => !prev);

          break;
      }
    },
    [
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
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  // ショートカットリスト
  const shortcuts = [
    ["Space", "Play / Pause"],
    ["S", "Stop"],
    ["A / D", "Previous / Next file"],
    ["← / →", "Seek -/+5s"],
    ["↑ / ↓", "Volume -/+"],
    ["M", "Mute / Unmute"],
    ["F", "Toggle Fullscreen"],
    ["O", "Open file dialog"],
    ["0 〜 9", "Seek to % position"],
    ["I", "Toggle track info"],
    ["?", "Show Shortcuts help"],
    ["Esc", "Close this help"],
  ];

  return { shortcuts };
};
