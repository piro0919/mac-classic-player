import { parseBuffer } from "music-metadata-browser";
import { useCallback, useEffect, useState } from "react";
import type { VideoQueueAction } from "../store/videoQueueReducer";
import type { VideoItem } from "../types/videoTypes";

const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "flac", "wav"];

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

// FileオブジェクトからVideoItemを作成する（音声ファイルはメタデータも解析）
const fileToVideoItem = async (file: File): Promise<VideoItem> => {
  const [baseName, ext] = parseFileName(file.name);
  const url = createAndTrackObjectURL(file);
  const item: VideoItem = { ext, name: baseName, url: `${url}#.${ext}` };

  // 音声ファイルの場合、ArrayBufferからメタデータを解析
  // （WKWebViewではBlob.stream()が正常に動作しないため、parseBufferを使う）
  if (AUDIO_EXTENSIONS.includes(ext)) {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());

      item.metadata = await parseBuffer(buffer, { mimeType: file.type });
    } catch {
      // メタデータ解析に失敗しても再生には影響しない
    }
  }

  return item;
};

export const useMediaFiles = (
  dispatch: React.Dispatch<VideoQueueAction>,
  seekToTime: (time: number) => void,
  suppressNextOpenFile?: () => void,
) => {
  const [shouldShowPlayer, setShouldShowPlayer] = useState(true);

  useEffect(() => {
    setShouldShowPlayer(false);

    const timeout = setTimeout(() => setShouldShowPlayer(true), 10);

    return () => clearTimeout(timeout);
  }, []);

  // ファイル選択からのファイルロード
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const files = Array.from(e.target.files || []).filter(
        (file) =>
          file.type.startsWith("video/") || file.type.startsWith("audio/"),
      );
      const urls = await Promise.all(files.map(fileToVideoItem));

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

      suppressNextOpenFile?.();

      const files = Array.from(e.dataTransfer.files).filter(
        (file) =>
          file.type.startsWith("video/") || file.type.startsWith("audio/"),
      );
      const items = await Promise.all(files.map(fileToVideoItem));

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
    [dispatch, seekToTime, suppressNextOpenFile],
  );

  return {
    handleDragOver,
    handleDrop,
    handleFileChange,
    shouldShowPlayer,
  };
};
