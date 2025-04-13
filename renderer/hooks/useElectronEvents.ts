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
      console.warn("Electron is not available");

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

        if (items.length > 0) {
          document.title = items[0].name || "Video Player";
          dispatch({ type: "STOP" });
          dispatch({ files: items, type: "LOAD_FILES" });
          setTimeout(() => {
            dispatch({ type: "SET_IS_PLAYING", value: true });
          }, 0);
          dispatch({ time: 0, type: "SET_CURRENT_TIME" });
          dispatch({ time: 0, type: "SET_DURATION" });
        }
      } catch (error) {
        console.error("Error loading files:", error);
      }
    };

    ipcRenderer.on("open-file", handleOpenFile);
    ipcRenderer.on("suppress-next-open-file", () => {
      ignoreNextOpenFileRef.current = true;
    });

    return () => {
      ipcRenderer.removeListener("open-file", handleOpenFile);
    };
  }, [dispatch]);

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
