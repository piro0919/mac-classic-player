// 再生エンジン（mpv）とReactの状態をつなぐ
//
// - Reactの状態（再生/一時停止・音量・速度…）が変わったら mpv に伝える
// - mpv から届くプロパティの変化（再生位置・長さ・トラック一覧…）をReactの状態に反映する
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { type VideoQueueAction } from "../store/videoQueueReducer";
import { type VideoItem } from "../types/videoTypes";
import { subscribe } from "./useTauriEvents";

export type MpvTrack = {
  albumart?: boolean;
  codec?: string;
  default?: boolean;
  "demux-channel-count"?: number;
  external?: boolean;
  "external-filename"?: string;
  forced?: boolean;
  id: number;
  lang?: string;
  selected?: boolean;
  title?: string;
  type: "audio" | "sub" | "video";
};

export type EngineStatus =
  | { detail: string; kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready" }
  | { kind: "starting" };

// mpv のトラック選択（番号、または "no"）
export type TrackId = "no" | number;

type MpvMessage =
  | { error: null | string; reason: string; type: "end-file" }
  | { name: string; type: "property"; value: unknown }
  | { type: "file-loaded" };

// Rust側（player.rs）のエラーコード
const ERR_MPV_MISSING = "mpv-missing";

type Options = {
  currentItem: undefined | VideoItem;
  dispatch: React.Dispatch<VideoQueueAction>;
  isPlaying: boolean;
  // 1曲だけのときは繰り返す
  loopSingle: boolean;
  muted: boolean;
  onEnded: () => void;
  playbackRate: number;
  volume: number;
};

// mpv の aid / sid は番号か false（オフ）で届く
const toTrackId = (value: unknown): TrackId =>
  typeof value === "number" ? value : "no";
const setProperty = async (name: string, value: boolean | number | string) =>
  invoke("mpv_set", { name, value }).catch((error: unknown) => {
    console.error(`mpv_set ${name}:`, error);
  });

export const useMpvPlayer = ({
  currentItem,
  dispatch,
  isPlaying,
  loopSingle,
  muted,
  onEnded,
  playbackRate,
  volume,
}: Options) => {
  const [status, setStatus] = useState<EngineStatus>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);
  const [tracks, setTracks] = useState<MpvTrack[]>([]);
  const [audioId, setAudioId] = useState<TrackId>("no");
  const [subtitleId, setSubtitleId] = useState<TrackId>("no");
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState<null | string>(null);
  // 「もう一度試す」で同じファイルを読み直すためのカウンター
  const [reloadToken, setReloadToken] = useState(0);
  // イベントハンドラーから最新の onEnded を呼ぶため
  const onEndedRef = useRef(onEnded);

  onEndedRef.current = onEnded;

  const ready = status.kind === "ready";

  // mpv を起動する
  useEffect(() => {
    let active = true;

    setStatus({ kind: "starting" });
    invoke("mpv_start")
      .then(() => {
        if (active) setStatus({ kind: "ready" });

        return undefined;
      })
      .catch((error: unknown) => {
        if (!active) return;

        const message = String(error);

        setStatus(
          message.startsWith(ERR_MPV_MISSING)
            ? { detail: message, kind: "missing" }
            : { kind: "error", message },
        );
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  // mpv からの通知を受け取る
  useEffect(
    () =>
      subscribe(
        listen<MpvMessage>("mpv", ({ payload }) => {
          if (payload.type === "file-loaded") {
            setPlaybackError(null);

            return;
          }

          if (payload.type === "end-file") {
            if (payload.reason === "error") {
              setPlaybackError(payload.error || "Unknown error");
            }

            return;
          }

          const { name, value } = payload;

          switch (name) {
            case "aid":
              setAudioId(toTrackId(value));

              break;
            case "duration":
              dispatch({
                time: typeof value === "number" ? value : 0,
                type: "SET_DURATION",
              });

              break;
            case "eof-reached":
              if (value === true) onEndedRef.current();

              break;
            case "pause":
              dispatch({ type: "SET_IS_PLAYING", value: value === false });

              break;
            case "paused-for-cache":
            case "seeking":
              setBuffering(value === true);

              break;
            case "sid":
              setSubtitleId(toTrackId(value));

              break;
            case "time-pos":
              if (typeof value === "number") {
                dispatch({ time: value, type: "SET_CURRENT_TIME" });
              }

              break;
            case "track-list":
              setTracks(Array.isArray(value) ? (value as MpvTrack[]) : []);

              break;
          }
        }),
      ),
    [dispatch],
  );

  // ファイルを読み込む（同じファイルの開き直しでも id が変わるので読み直す）
  const itemId = currentItem?.id;
  const itemPath = currentItem?.path;

  useEffect(() => {
    if (!ready) return;

    setPlaybackError(null);
    setTracks([]);

    if (!itemPath) {
      invoke("mpv_stop").catch(() => {});

      return;
    }

    invoke("mpv_load", { path: itemPath }).catch((error: unknown) => {
      setPlaybackError(String(error));
    });
  }, [ready, itemId, itemPath, reloadToken]);

  // Reactの状態を mpv に反映する
  useEffect(() => {
    if (ready) void setProperty("pause", !isPlaying);
  }, [ready, isPlaying]);
  useEffect(() => {
    if (ready) void setProperty("volume", Math.round(volume * 100));
  }, [ready, volume]);
  useEffect(() => {
    if (ready) void setProperty("mute", muted);
  }, [ready, muted]);
  useEffect(() => {
    if (ready) void setProperty("speed", playbackRate);
  }, [ready, playbackRate]);
  useEffect(() => {
    if (ready) void setProperty("loop-file", loopSingle ? "inf" : "no");
  }, [ready, loopSingle]);

  const seek = useCallback((seconds: number) => {
    invoke("mpv_seek", { seconds }).catch(() => {});
  }, []);
  const selectAudio = useCallback((id: TrackId) => {
    void setProperty("aid", id);
  }, []);
  const selectSubtitle = useCallback((id: TrackId) => {
    void setProperty("sid", id);
  }, []);
  const openSubtitleFile = useCallback(() => {
    invoke("mpv_open_subtitle_dialog").catch(() => {});
  }, []);
  const retryEngine = useCallback(() => setAttempt((n) => n + 1), []);
  const reloadFile = useCallback(() => setReloadToken((n) => n + 1), []);

  return {
    audioId,
    buffering,
    openSubtitleFile,
    playbackError,
    reloadFile,
    retryEngine,
    seek,
    selectAudio,
    selectSubtitle,
    status,
    subtitleId,
    tracks,
  };
};

// 映像エリア（CSS上の位置）にネイティブの映像ビューを合わせる
export const useVideoRect = (element: HTMLElement | null, visible: boolean) => {
  useEffect(() => {
    if (!element) {
      invoke("mpv_set_video_rect", {
        height: 0,
        visible: false,
        width: 0,
        x: 0,
        y: 0,
      }).catch(() => {});

      return;
    }

    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();

        invoke("mpv_set_video_rect", {
          height: rect.height,
          visible,
          width: rect.width,
          x: rect.left,
          y: rect.top,
        }).catch(() => {});
      });
    };
    const observer = new ResizeObserver(update);

    observer.observe(element);
    window.addEventListener("resize", update);
    update();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [element, visible]);
};
