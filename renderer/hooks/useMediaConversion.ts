// MKVなど変換が必要なファイルを、再生する番が来たときにRust側（ffmpeg）でMP4に変換する
// プレイリストの全ファイルを先に変換すると時間がかかるので、今のファイルだけを変換する
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { type VideoQueueAction } from "../store/videoQueueReducer";
import { type VideoItem } from "../types/videoTypes";
import { subscribe } from "./useTauriEvents";

export type ConversionMode = "remux" | "transcode";

export type ConversionState =
  | { ffmpegMissing: boolean; message: string; status: "error" }
  | { mode: ConversionMode | null; progress: number; status: "converting" }
  | { status: "idle" };

type ConvertProgressPayload = {
  mode: ConversionMode;
  path: string;
  progress: number;
};

// Rust側（convert.rs）のエラーコード
const ERR_FFMPEG_MISSING = "ffmpeg-missing";
const ERR_CANCELLED = "cancelled";

export const useMediaConversion = (
  currentItem: undefined | VideoItem,
  dispatch: React.Dispatch<VideoQueueAction>,
) => {
  const [conversion, setConversion] = useState<ConversionState>({
    status: "idle",
  });
  // 「もう一度試す」で effect をやり直すためのカウンター
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const pendingPath =
    currentItem?.needsConversion && !currentItem.url
      ? currentItem.sourcePath
      : undefined;

  useEffect(() => {
    if (!pendingPath) {
      setConversion({ status: "idle" });

      return;
    }

    let active = true;

    setConversion({ mode: null, progress: 0, status: "converting" });

    const unsubscribe = subscribe(
      listen<ConvertProgressPayload>("convert-progress", (event) => {
        if (!active || event.payload.path !== pendingPath) return;

        setConversion({
          mode: event.payload.mode,
          progress: event.payload.progress,
          status: "converting",
        });
      }),
    );

    invoke<string>("prepare_media", { path: pendingPath })
      .then((url) => {
        if (!active) return undefined;

        dispatch({ sourcePath: pendingPath, type: "SET_ITEM_URL", url });
        setConversion({ status: "idle" });

        return undefined;
      })
      .catch((error: unknown) => {
        const message = String(error);

        // 別のファイルに切り替えて止めた場合は何も表示しない
        if (!active || message === ERR_CANCELLED) return;

        setConversion({
          ffmpegMissing: message === ERR_FFMPEG_MISSING,
          message,
          status: "error",
        });
      });

    return () => {
      active = false;
      unsubscribe();
      // 再生中のファイルが変わったら、そのファイルの変換は止める
      invoke("cancel_conversion", { path: pendingPath }).catch(() => {});
    };
    // currentItem が変わる（別のファイル・同じファイルの開き直し）たびにやり直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem, attempt, dispatch]);

  return { conversion, retry };
};
