// music-metadataがNode.jsのBufferを使用するため、ブラウザ環境向けにポリフィルを提供
import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

import { restoreStateCurrent, StateFlags } from "@tauri-apps/plugin-window-state";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// ウィンドウの位置・サイズを前回の状態から復元する
restoreStateCurrent(StateFlags.ALL).catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
