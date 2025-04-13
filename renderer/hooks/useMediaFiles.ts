import { useCallback, useEffect, useState } from "react";
import { type VideoQueueAction } from "../store/videoQueueReducer";
import { type VideoItem } from "../types/videoTypes";

// URL.createObjectURLで作成したオブジェクトを追跡
const createdObjectUrls: string[] = [];

// コンポーネントがアンマウントされたときに呼び出される関数
export const cleanupObjectUrls = () => {
  createdObjectUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to revoke object URL:", error);
    }
  });
  createdObjectUrls.length = 0;
};

export const useMediaFiles = (
  dispatch: React.Dispatch<VideoQueueAction>,
  seekToTime: (time: number) => void,
) => {
  const [shouldShowPlayer, setShouldShowPlayer] = useState(true);

  useEffect(() => {
    setShouldShowPlayer(false);

    const timeout = setTimeout(() => setShouldShowPlayer(true), 10);

    return () => clearTimeout(timeout);
  }, []);

  // ファイル名から拡張子とベース名を抽出
  const parseFileName = (fileName: string): [string, string] => {
    const match = fileName.match(/^(.+)\.([^.]+)$/);

    return match ? [match[1], match[2].toLowerCase()] : [fileName, ""];
  };
  // BlobからオブジェクトURLを作成し、追跡
  const createAndTrackObjectURL = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);

    createdObjectUrls.push(url);

    return url;
  };
  // ファイル選択からのファイルロード
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const files = Array.from(e.target.files || []);
      const urls = files
        .filter(
          (file) =>
            file.type.startsWith("video/") || file.type.startsWith("audio/"),
        )
        .map((file): VideoItem => {
          const [baseName, ext] = parseFileName(file.name);
          const url = createAndTrackObjectURL(file);

          return { ext, name: baseName, url };
        });

      if (urls.length > 0) {
        dispatch({ files: urls, type: "LOAD_FILES" });
        dispatch({ time: 0, type: "SET_CURRENT_TIME" });
        dispatch({ time: 0, type: "SET_DURATION" });
        document.title = urls[0].name || "Video Player";
        setTimeout(() => {
          dispatch({ type: "SET_IS_PLAYING", value: true });
        }, 0);
      }
    },
    [dispatch],
  );
  // ドラッグ&ドロップの処理
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
    },
    [],
  );
  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
      e.preventDefault();

      window.require("electron").ipcRenderer.send("suppress-next-open-file");

      const files = Array.from(e.dataTransfer.files);
      const items = files
        .filter(
          (file) =>
            file.type.startsWith("video/") || file.type.startsWith("audio/"),
        )
        .map((file): VideoItem => {
          const [baseName, ext] = parseFileName(file.name);
          const url = createAndTrackObjectURL(file);

          return { ext, name: baseName, url };
        });

      if (items.length > 0) {
        dispatch({ type: "STOP" }); // 再生中のメディアを停止
        dispatch({ files: items, type: "LOAD_FILES" });
        seekToTime(0);
        dispatch({ time: 0, type: "SET_DURATION" });
        document.title = items[0].name || "Video Player";
        setTimeout(() => {
          dispatch({ type: "SET_IS_PLAYING", value: true });
        }, 0);
      }
    },
    [dispatch, seekToTime],
  );

  return {
    handleDragOver,
    handleDrop,
    handleFileChange,
    shouldShowPlayer,
  };
};
