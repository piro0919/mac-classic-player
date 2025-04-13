import { type IAudioMetadata } from "music-metadata-browser";
import { type VideoItem } from "../types/videoTypes";
import { ActionTypes } from "./actionTypes";

// 状態の型定義
export type VideoQueueState = {
  currentIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  muted: boolean;
  queue: VideoItem[];
};

// アクションの型定義
export type VideoQueueAction =
  | {
      artworkUrl?: string;
      index: number;
      metadata?: IAudioMetadata;
      type: typeof ActionTypes.UPDATE_MEDIA_INFO;
    }
  | { files: VideoItem[]; type: typeof ActionTypes.LOAD_FILES }
  | { index: number; type: typeof ActionTypes.SET_INDEX }
  | { time: number; type: typeof ActionTypes.SET_CURRENT_TIME }
  | { time: number; type: typeof ActionTypes.SET_DURATION }
  | { type: typeof ActionTypes.NEXT }
  | { type: typeof ActionTypes.PREVIOUS }
  | { type: typeof ActionTypes.SET_IS_PLAYING; value: boolean }
  | { type: typeof ActionTypes.SET_MUTED; value: boolean }
  | { type: typeof ActionTypes.STOP }
  | { type: typeof ActionTypes.TOGGLE_MUTED }
  | { type: typeof ActionTypes.TOGGLE_PLAY };

// 初期状態
export const initialState: VideoQueueState = {
  currentIndex: 0,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  muted: false,
  queue: [],
};

/**
 * ビデオキューの状態を管理するReducer
 * @param state 現在の状態
 * @param action 実行されるアクション
 * @returns 更新された状態
 */
export function videoQueueReducer(
  state: VideoQueueState,
  action: VideoQueueAction,
): VideoQueueState {
  const { type } = action;

  switch (type) {
    case ActionTypes.LOAD_FILES: {
      // ファイルのロード
      return {
        ...initialState, // 初期状態にリセット
        queue: action.files,
      };
    }
    case ActionTypes.SET_INDEX: {
      // インデックスの設定
      return {
        ...state,
        currentIndex: action.index,
      };
    }
    case ActionTypes.NEXT: {
      // 次のトラックへ
      if (state.queue.length === 0) return state;

      const nextIndex = (state.currentIndex + 1) % state.queue.length;

      return {
        ...state,
        currentIndex: nextIndex,
      };
    }
    case ActionTypes.PREVIOUS: {
      // 前のトラックへ
      if (state.queue.length === 0) return state;

      const prevIndex =
        (state.currentIndex - 1 + state.queue.length) % state.queue.length;

      return {
        ...state,
        currentIndex: prevIndex,
      };
    }
    case ActionTypes.SET_CURRENT_TIME: {
      // 現在の再生時間を設定
      return {
        ...state,
        currentTime: action.time,
      };
    }
    case ActionTypes.SET_DURATION: {
      // 動画の長さを設定
      return {
        ...state,
        duration: action.time,
      };
    }
    case ActionTypes.SET_IS_PLAYING: {
      // 再生状態を設定
      return {
        ...state,
        isPlaying: action.value,
      };
    }
    case ActionTypes.SET_MUTED: {
      // ミュート状態を設定
      return {
        ...state,
        muted: action.value,
      };
    }
    case ActionTypes.STOP: {
      // 停止
      return {
        ...state,
        isPlaying: false,
      };
    }
    case ActionTypes.TOGGLE_MUTED: {
      // ミュートのトグル
      return {
        ...state,
        muted: !state.muted,
      };
    }
    case ActionTypes.UPDATE_MEDIA_INFO: {
      // メディアのメタデータを更新
      const updatedQueue = [...state.queue];

      // 指定されたインデックスが有効な範囲内かチェック
      if (action.index >= 0 && action.index < updatedQueue.length) {
        updatedQueue[action.index] = {
          ...updatedQueue[action.index],
          artworkUrl:
            action.artworkUrl ?? updatedQueue[action.index].artworkUrl,
          metadata: action.metadata ?? updatedQueue[action.index].metadata,
        };
      }

      return {
        ...state,
        queue: updatedQueue,
      };
    }
    case ActionTypes.TOGGLE_PLAY: {
      // 再生/一時停止のトグル
      return {
        ...state,
        isPlaying: !state.isPlaying,
      };
    }
    default: {
      // 未知のアクションタイプの場合は状態を変更しない
      return state;
    }
  }
}
