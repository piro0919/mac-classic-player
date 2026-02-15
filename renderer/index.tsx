// music-metadataがNode.jsのBufferを使用するため、ブラウザ環境向けにポリフィルを提供
import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { restoreStateCurrent, StateFlags } from "@tauri-apps/plugin-window-state";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// ウィンドウの位置を前回の状態から復元する（SIZE以外）
// SIZE はプラグインのPhysicalSize処理がRetinaで2倍になるため、JSでLogicalSizeで管理する
restoreStateCurrent(StateFlags.POSITION | StateFlags.FULLSCREEN).catch(() => {});

// ウィンドウサイズをLogicalSizeで復元する
const savedSize = localStorage.getItem("windowSize");

if (savedSize) {
  try {
    const { width, height } = JSON.parse(savedSize);

    getCurrentWindow().setSize(new LogicalSize(width, height)).catch(() => {});
  } catch {
    // パースエラー時は無視
  }
}

// ウィンドウ閉じる前にサイズを保存する（CSS/論理ピクセル）
window.addEventListener("beforeunload", () => {
  localStorage.setItem(
    "windowSize",
    JSON.stringify({ height: window.innerHeight, width: window.innerWidth }),
  );
});

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
