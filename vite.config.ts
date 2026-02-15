import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Tauri用のホスト設定（モバイルデバッグ用）
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  base: "./",
  root: "renderer",
  // Viteのclear screenを無効化（Tauriのログが消えないように）
  clearScreen: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Tauri環境に合わせたビルドターゲット
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./renderer"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // src-tauriのファイル変更でViteが再読み込みしないように除外
      ignored: ["**/src-tauri/**"],
    },
  },
  // Tauri環境変数のプレフィックスを許可
  envPrefix: ["VITE_", "TAURI_ENV_*"],
});
