export type VideoItem = {
  artworkUrl?: string;
  ext: string; // 例: "mp4", "mp3"
  name: string; // 拡張子を含まない
  url: string;
};

type VideoQueueState = {
  currentIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  muted: boolean;
  queue: VideoItem[];
};

export type VideoQueueAction =
  | { artworkUrl: string; index: number; type: "UPDATE_ARTWORK" }
  | { files: VideoItem[]; type: "LOAD_FILES" }
  | { index: number; type: "SET_INDEX" }
  | { time: number; type: "SET_CURRENT_TIME" }
  | { time: number; type: "SET_DURATION" }
  | { type: "NEXT" }
  | { type: "PREVIOUS" }
  | { type: "SET_IS_PLAYING"; value: boolean }
  | { type: "SET_MUTED"; value: boolean }
  | { type: "STOP" }
  | { type: "TOGGLE_MUTED" }
  | { type: "TOGGLE_PLAY" };

export const initialState: VideoQueueState = {
  currentIndex: 0,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  muted: false,
  queue: [],
};

export function videoQueueReducer(
  state: VideoQueueState,
  action: VideoQueueAction,
): VideoQueueState {
  switch (action.type) {
    case "LOAD_FILES":
      return {
        currentIndex: 0,
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        muted: false,
        queue: action.files,
      };
    case "SET_INDEX":
      return {
        ...state,
        currentIndex: action.index,
      };
    case "NEXT": {
      const nextIndex = (state.currentIndex + 1) % state.queue.length;

      return {
        ...state,
        currentIndex: nextIndex,
      };
    }
    case "PREVIOUS": {
      const prevIndex =
        (state.currentIndex - 1 + state.queue.length) % state.queue.length;

      return {
        ...state,
        currentIndex: prevIndex,
      };
    }
    case "SET_CURRENT_TIME":
      return {
        ...state,
        currentTime: action.time,
      };
    case "SET_DURATION":
      return {
        ...state,
        duration: action.time,
      };
    case "SET_IS_PLAYING":
      return {
        ...state,
        isPlaying: action.value,
      };
    case "SET_MUTED":
      return {
        ...state,
        muted: action.value,
      };
    case "STOP":
      return {
        ...state,
        isPlaying: false,
      };
    case "TOGGLE_MUTED":
      return {
        ...state,
        muted: !state.muted,
      };
    case "UPDATE_ARTWORK": {
      const updatedQueue = [...state.queue];

      updatedQueue[action.index] = {
        ...updatedQueue[action.index],
        artworkUrl: action.artworkUrl,
      };

      return {
        ...state,
        queue: updatedQueue,
      };
    }
    case "TOGGLE_PLAY":
      return {
        ...state,
        isPlaying: !state.isPlaying,
      };
    default:
      return state;
  }
}
