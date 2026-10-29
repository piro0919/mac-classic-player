import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readFile, stat } from "@tauri-apps/plugin-fs";
import { useEffect, useRef } from "react";
import {
  AUDIO_EXTENSIONS,
  MEDIA_EXTENSIONS,
  newItemId,
  parseAudioMetadata,
  parseFileName,
} from "../utils/mediaFile";
import type { VideoQueueAction } from "../store/videoQueueReducer";
import type { VideoItem } from "../types/videoTypes";

// 音声メタデータ解析用のMIMEタイプ
const AUDIO_MIME: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};
// ファイルパスから拡張子とベース名を抽出する
const parseFilePath = (filePath: string): { baseName: string; ext: string } =>
  parseFileName(filePath.split("/").pop() || "");
// メタデータを読むために丸ごと読み込む音声ファイルの上限（200MB）
const MAX_METADATA_SIZE = 200 * 1024 * 1024;
// ファイルパスからVideoItemを作成する
// 再生は mpv がパスから直接行うので、ここでは中身を読まない
// （音声ファイルだけ、曲名やジャケットのためにメタデータを読む）
const filePathToVideoItem = async (filePath: string): Promise<VideoItem> => {
  const { baseName, ext } = parseFilePath(filePath);
  const item: VideoItem = {
    ext,
    id: newItemId(),
    name: baseName,
    path: filePath,
    url: filePath,
  };

  if (AUDIO_EXTENSIONS.includes(ext)) {
    try {
      const info = await stat(filePath);

      if (info.size <= MAX_METADATA_SIZE) {
        const contents = await readFile(filePath);

        item.metadata = await parseAudioMetadata(
          contents,
          AUDIO_MIME[ext] || "application/octet-stream",
        );
      }
    } catch {
      // メタデータが読めなくても再生はできる
    }
  }

  return item;
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

// イベント購読を登録し、解除する関数を返す
// listen()のPromiseが解決する前にcleanupが走るとunlistenがundefinedのまま
// リスナーが残ってしまうため、cancelledフラグで取りこぼしを防ぐ
export const subscribe = (registration: Promise<UnlistenFn>): (() => void) => {
  let unlisten: undefined | UnlistenFn;
  let cancelled = false;

  registration
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;

      return undefined;
    })
    .catch((error: unknown) => {
      console.error("イベント購読エラー:", error);
    });

  return () => {
    cancelled = true;
    unlisten?.();
  };
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
  useEffect(
    () =>
      subscribe(
        listen<string[]>("open-file", (event) => {
          if (ignoreNextOpenFileRef.current) {
            ignoreNextOpenFileRef.current = false;

            return;
          }

          const filePaths = event.payload;

          if (!filePaths || filePaths.length === 0) return;

          loadAndPlayFiles(filePaths, dispatch, seekToTime);
        }),
      ),
    [dispatch, seekToTime],
  );

  // Rustバックエンドからの「toggle-help」イベントを受信する
  // メニューの「ショートカット一覧を表示」で発火
  useEffect(
    () =>
      subscribe(
        listen("toggle-help", () => {
          setShowHelp((prev) => !prev);
        }),
      ),
    [setShowHelp],
  );

  // Tauriのネイティブドラッグ&ドロップイベントを処理する
  // Tauri v2ではブラウザのdropイベントではなく、ネイティブイベントでファイルパスが渡される
  useEffect(
    () =>
      subscribe(
        getCurrentWebview().onDragDropEvent(
          (event: { payload: { paths?: string[]; type: string } }) => {
            if (event.payload.type !== "drop") return;

            const mediaPaths = (event.payload.paths ?? []).filter(
              (p: string) => {
                const ext = p.split(".").pop()?.toLowerCase() || "";

                return MEDIA_EXTENSIONS.includes(ext);
              },
            );

            if (mediaPaths.length === 0) return;

            loadAndPlayFiles(mediaPaths, dispatch, seekToTime);
            invoke("add_recent_files", { paths: mediaPaths });
          },
        ),
      ),
    [dispatch, seekToTime],
  );

  // ドラッグ&ドロップ時のopen-file抑制フラグを設定する関数を返す
  const suppressNextOpenFile = () => {
    ignoreNextOpenFileRef.current = true;
  };

  return { suppressNextOpenFile };
};
