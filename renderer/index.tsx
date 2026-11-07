// music-metadataがNode.jsのBufferを使用するため、ブラウザ環境向けにポリフィルを提供
import { Buffer } from "buffer";

globalThis.Buffer = Buffer;
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// ウィンドウの位置と大きさの保存・復元は Rust 側（window_geometry.rs）で行う

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
