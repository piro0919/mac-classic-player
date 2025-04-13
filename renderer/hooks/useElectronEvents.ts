import { useEffect, useRef } from "react";
import { type VideoQueueAction } from "../store/videoQueueReducer";

export const useElectronEvents = (
  dispatch: React.Dispatch<VideoQueueAction>,
  seekToTime: (time: number) => void,
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  const ignoreNextOpenFileRef = useRef(false);

  // ファイルオープンイベントのハンドリング
  useEffect(() => {
    // Electronが利用可能かチェック
    if (!window.require) {
      console.log("Electron is not available");

      return;
    }

    const { ipcRenderer } = window.require("electron");
    // ファイルオープンハンドラー
    const handleOpenFile = async (_: any, filePaths: string[]) => {
      if (ignoreNextOpenFileRef.current) {
        console.log("🚫 suppressing open-file");
        ignoreNextOpenFileRef.current = false;

        return;
      }

      console.log("Received open-file event with paths:", filePaths); // デバッグログを追加

      if (!filePaths || filePaths.length === 0) return;

      const fs = window.require("fs");

      try {
        const items = await Promise.all(
          filePaths.map(async (filePath) => {
            const fileName = filePath.split("/").pop() || "Video Player";
            const [baseName, ext] = fileName.split(/\.(?=[^.]+$)/);
            // ファイルを読み込む
            const buffer = fs.readFileSync(filePath);
            // MIMEタイプの判定
            const mime =
              ext === "mp3" || ext === "m4a" || ext === "wav"
                ? `audio/${ext}`
                : `video/${ext}`;
            // BlobとURLの作成
            const blob = new Blob([buffer], { type: mime });
            const url = URL.createObjectURL(blob);

            return { ext, name: baseName, url };
          }),
        );

        console.log("Processed files:", items); // デバッグログを追加

        if (items.length > 0) {
          // ここで確実に動画が再生されるようにディスパッチの順序を修正
          dispatch({ type: "STOP" });
          dispatch({ files: items, type: "LOAD_FILES" });

          // タイムアウトを長めに設定して、UIレンダリングが完了してから再生を開始
          setTimeout(() => {
            dispatch({ type: "SET_IS_PLAYING", value: true });
            console.log("Setting isPlaying to true"); // デバッグログを追加
          }, 100);

          // 時間関連のディスパッチを最後に行う
          dispatch({ time: 0, type: "SET_CURRENT_TIME" });
          seekToTime(0);
        }
      } catch (error) {
        console.error("Error loading files:", error);
      }
    };

    // イベントリスナーを登録
    console.log("Registering open-file event listener"); // デバッグログを追加
    ipcRenderer.on("open-file", handleOpenFile);
    ipcRenderer.on("suppress-next-open-file", () => {
      ignoreNextOpenFileRef.current = true;
    });

    // コンポーネントのアンマウント時にリスナーを解除
    return () => {
      ipcRenderer.removeListener("open-file", handleOpenFile);
    };
  }, [dispatch, seekToTime]); // seekToTimeを依存配列に追加

  // ヘルプトグルイベントのハンドリング
  useEffect(() => {
    if (!window.require) return;

    const { ipcRenderer } = window.require("electron");
    const handleToggleHelp = () => {
      setShowHelp((prevHelp) => !prevHelp);
    };

    ipcRenderer.on("toggle-help", handleToggleHelp);

    return () => {
      ipcRenderer.removeListener("toggle-help", handleToggleHelp);
    };
  }, [setShowHelp]);
};
