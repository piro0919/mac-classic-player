import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readFile } from "@tauri-apps/plugin-fs";
import { parseBuffer } from "music-metadata-browser";
import { useEffect, useRef } from "react";
import type { VideoQueueAction } from "../store/videoQueueReducer";
import type { VideoItem } from "../types/videoTypes";

// MIMEタイプのマッピング
const MIME_MAP: Record<string, string> = {
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  wav: "audio/wav",
};

const MEDIA_EXTENSIONS = ["mp4", "mov", "mp3", "m4a", "wav"];
const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "flac", "wav"];

// ファイルパスから拡張子とベース名を抽出するヘルパー関数
const parseFilePath = (filePath: string): { baseName: string; ext: string } => {
  const fileName = filePath.split("/").pop() || "";
  const match = fileName.match(/^(.+)\.([^.]+)$/);

  return match
    ? { baseName: match[1], ext: match[2].toLowerCase() }
    : { baseName: fileName, ext: "" };
};

// ファイルパスからBlob URLを作成する
// macOS WKWebViewではasset://プロトコルが<video>要素で動作しないため、
// readFileでバイナリを読み込み、Blob URLに変換する
// 音声ファイルの場合はメタデータも同時に解析する
const filePathToBlobUrl = async (filePath: string): Promise<VideoItem> => {
  const { baseName, ext } = parseFilePath(filePath);
  const contents = await readFile(filePath);
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);

  // 音声ファイルの場合、Uint8Arrayから直接メタデータを解析する
  // （WKWebViewではBlob.stream()が正常に動作しないため、parseBufferを使う）
  const item: VideoItem = { ext, name: baseName, url: `${url}#.${ext}` };

  if (AUDIO_EXTENSIONS.includes(ext)) {
    try {
      item.metadata = await parseBuffer(contents, { mimeType: mime });
    } catch {
      // メタデータ解析に失敗しても再生には影響しない
    }
  }

  return item;
};

// 複数のファイルパスからVideoItemの配列を作成する
const filePathsToVideoItems = async (
  filePaths: string[],
): Promise<VideoItem[]> => {
  const items = await Promise.all(filePaths.map(filePathToBlobUrl));

  return items;
};

// ファイルをロードして再生を開始する共通処理
const loadAndPlayFiles = async (
  filePaths: string[],
  dispatch: React.Dispatch<VideoQueueAction>,
  seekToTime: (time: number) => void,
) => {
  try {
    const items = await filePathsToVideoItems(filePaths);

    if (items.length > 0) {
      dispatch({ type: "STOP" });
      dispatch({ files: items, type: "LOAD_FILES" });

      setTimeout(() => {
        dispatch({ type: "SET_IS_PLAYING", value: true });
      }, 100);

      dispatch({ time: 0, type: "SET_CURRENT_TIME" });
      seekToTime(0);
    }
  } catch (error) {
    console.error("ファイル読み込みエラー:", error);
  }
};

export const useTauriEvents = (
  dispatch: React.Dispatch<VideoQueueAction>,
  seekToTime: (time: number) => void,
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  const ignoreNextOpenFileRef = useRef(false);

  // アプリ起動時に保留中のファイルを取得する
  // （macOSの「ファイルで開く」でアプリが起動された場合）
  useEffect(() => {
    const fetchPendingFiles = async () => {
      try {
        const pendingFiles = await invoke<string[]>("get_pending_files");

        if (pendingFiles.length > 0) {
          await loadAndPlayFiles(pendingFiles, dispatch, seekToTime);
        }
      } catch (error) {
        console.error("保留中のファイル取得エラー:", error);
      }
    };

    fetchPendingFiles();
  }, [dispatch, seekToTime]);

  // Rustバックエンドからの「open-file」イベントを受信する
  // メニューの「ファイルを開く」や、macOSの「ファイルで開く」で発火
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<string[]>("open-file", (event) => {
      if (ignoreNextOpenFileRef.current) {
        ignoreNextOpenFileRef.current = false;

        return;
      }

      const filePaths = event.payload;

      if (!filePaths || filePaths.length === 0) return;

      loadAndPlayFiles(filePaths, dispatch, seekToTime);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [dispatch, seekToTime]);

  // Rustバックエンドからの「toggle-help」イベントを受信する
  // メニューの「ショートカット一覧を表示」で発火
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen("toggle-help", () => {
      setShowHelp((prev) => !prev);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [setShowHelp]);

  // Tauriのネイティブドラッグ&ドロップイベントを処理する
  // Tauri v2ではブラウザのdropイベントではなく、ネイティブイベントでファイルパスが渡される
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event: { payload: { paths?: string[]; type: string } }) => {
        if (event.payload.type !== "drop") return;

        const mediaPaths = (event.payload.paths ?? []).filter((p: string) => {
          const ext = p.split(".").pop()?.toLowerCase() || "";

          return MEDIA_EXTENSIONS.includes(ext);
        });

        if (mediaPaths.length === 0) return;

        loadAndPlayFiles(mediaPaths, dispatch, seekToTime);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [dispatch, seekToTime]);

  // ドラッグ&ドロップ時のopen-file抑制フラグを設定する関数を返す
  const suppressNextOpenFile = () => {
    ignoreNextOpenFileRef.current = true;
  };

  return { suppressNextOpenFile };
};
