import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readFile, stat } from "@tauri-apps/plugin-fs";
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

// Blob URLでメモリに読み込む上限（500MB）
// これを超えるファイルはローカルHTTPサーバー経由でストリーミング再生する
const MAX_BLOB_SIZE = 500 * 1024 * 1024;

// ストリーミングサーバーのポート番号をキャッシュする
let streamPortCache: number | null = null;

const getStreamPort = async (): Promise<number> => {
  if (streamPortCache === null) {
    streamPortCache = await invoke<number>("get_stream_port");
  }

  return streamPortCache;
};

// ファイルパスからVideoItemを作成する
// 通常はreadFile + Blob URLで再生する
// 大容量ファイルはローカルHTTPサーバー経由でRange request対応のストリーミング再生する
const filePathToVideoItem = async (filePath: string): Promise<VideoItem> => {
  const { baseName, ext } = parseFilePath(filePath);
  const mime = MIME_MAP[ext] || "application/octet-stream";

  // ファイルサイズをチェックして読み込み方法を決定する
  const fileInfo = await stat(filePath);
  const isLargeFile = fileInfo.size > MAX_BLOB_SIZE;

  let url: string;
  let metadata: VideoItem["metadata"];

  if (isLargeFile) {
    // 大容量ファイル: ローカルHTTPサーバー経由でストリーミング
    const port = await getStreamPort();

    url = `http://127.0.0.1:${port}${encodeURI(filePath)}`;
  } else {
    // 通常ファイル: readFile + Blob URLで再生
    const contents = await readFile(filePath);
    const blob = new Blob([contents], { type: mime });

    url = `${URL.createObjectURL(blob)}#.${ext}`;

    // 音声ファイルの場合、メタデータも解析する
    if (AUDIO_EXTENSIONS.includes(ext)) {
      try {
        metadata = await parseBuffer(contents, { mimeType: mime });
      } catch {
        // メタデータ解析に失敗しても再生には影響しない
      }
    }
  }

  return { ext, metadata, name: baseName, url };
};

// 複数のファイルパスからVideoItemの配列を作成する
const filePathsToVideoItems = async (
  filePaths: string[],
): Promise<VideoItem[]> => {
  const items = await Promise.all(filePaths.map(filePathToVideoItem));

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
        invoke("add_recent_files", { paths: mediaPaths });
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
