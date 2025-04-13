import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { autoUpdater } from "electron-updater";
import * as fs from "fs/promises";
import * as path from "path";

// 型定義
type Settings = {
  windowHeight: number;
  windowWidth: number;
};

// 定数
const DEFAULT_SETTINGS: Settings = {
  windowHeight: 450,
  windowWidth: 800,
};
const SUPPORTED_EXTENSIONS = ["mp4", "mp3", "mov", "m4a", "wav"];

// グローバル変数
let mainWindow: BrowserWindow | null = null;
let openFilePaths: string[] = [];

/**
 * 設定ファイルのパスを取得
 */
const getSettingsPath = (): string => {
  return path.join(app.getPath("userData"), "settings.json");
};
/**
 * 設定を読み込む
 */
const loadSettings = async (): Promise<Settings> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf-8");

    return JSON.parse(raw) as Settings;
  } catch (error) {
    console.log("Settings file not found, using defaults:", error);

    return DEFAULT_SETTINGS;
  }
};
/**
 * 設定を保存
 */
const saveSettings = async (settings: Settings): Promise<void> => {
  try {
    await fs.writeFile(
      getSettingsPath(),
      JSON.stringify(settings, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
};
/**
 * メインウィンドウを作成
 */
const createWindow = async (): Promise<void> => {
  try {
    const settings = await loadSettings();

    mainWindow = new BrowserWindow({
      height: settings.windowHeight,
      icon: path.join(__dirname, "../assets/icon.png"),
      webPreferences: {
        // セキュリティ上の理由からcontextIsolationをtrueにすることが推奨されるが、
        // 現状の仕様を維持するためfalseに設定
        contextIsolation: false,
        nodeIntegration: true,
      },
      width: settings.windowWidth,
    });

    // ウィンドウサイズ変更時に設定を保存
    mainWindow.on("resize", () => {
      if (!mainWindow) return;

      const [width, height] = mainWindow.getSize();

      void saveSettings({ windowHeight: height, windowWidth: width });
    });

    // アプリが開発モードか本番モードかを判定
    const isDev = !app.isPackaged;
    const url = isDev
      ? "http://localhost:5173"
      : `file://${encodeURI(path.resolve(__dirname, "../dist/index.html"))}`;

    // URLをロード
    await mainWindow.loadURL(url);

    // ウェブコンテンツのロードが完了したら、ファイルを開く
    mainWindow.webContents.once("did-finish-load", () => {
      if (openFilePaths.length > 0 && mainWindow) {
        mainWindow.webContents.send("open-file", openFilePaths);
        openFilePaths = [];
      }
    });

    // 開発モードの場合、開発者ツールを開く
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } catch (error) {
    console.error("Failed to create window:", error);
  }
};
/**
 * メニューを構築
 */
const buildMenu = (isJapanese: boolean) => {
  const mediaFilesFilterName = isJapanese ? "メディアファイル" : "Media Files";

  return Menu.buildFromTemplate([
    {
      label: "Mac Classic Player",
      submenu: [
        {
          label: isJapanese
            ? "Mac Classic Player を終了"
            : "Quit Mac Classic Player",
          role: "quit",
        },
      ],
    },
    {
      label: isJapanese ? "ファイル" : "File",
      submenu: [
        {
          accelerator: "O",
          click: async () => {
            try {
              const { canceled, filePaths } = await dialog.showOpenDialog({
                filters: [
                  {
                    extensions: SUPPORTED_EXTENSIONS,
                    name: mediaFilesFilterName,
                  },
                ],
                properties: ["openFile", "multiSelections"],
              });

              if (!canceled && filePaths.length > 0 && mainWindow) {
                mainWindow.webContents.send("open-file", filePaths);
              }
            } catch (error) {
              console.error("Error opening file dialog:", error);
            }
          },
          label: isJapanese ? "ファイルを開く…" : "Open File…",
        },
      ],
    },
    {
      label: isJapanese ? "ヘルプ" : "Help",
      submenu: [
        {
          accelerator: "?",
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.send("toggle-help");
          },
          label: isJapanese
            ? "ショートカット一覧を表示"
            : "Show Shortcuts Help",
        },
        { type: "separator" },
        {
          click: () => {
            const version = app.getVersion();

            dialog.showMessageBox({
              message: `Mac Classic Player\nv${version}`,
              title: "Version",
              type: "info",
            });
          },
          label: isJapanese ? "バージョン情報" : "About Version",
        },
        { type: "separator" },
        {
          click: () => {
            void shell.openExternal(
              "https://github.com/piro0919/mac-classic-player",
            );
          },
          label: "GitHub",
        },
      ],
    },
  ]);
};
/**
 * コマンドライン引数からファイルを検出
 */
const checkFileFromCommandLine = (): void => {
  const args = process.argv;
  const fileRegex = new RegExp(`\\.(${SUPPORTED_EXTENSIONS.join("|")})$`, "i");
  const fileFromArg = args.find((arg) => fileRegex.test(arg));

  if (fileFromArg) {
    openFilePaths.push(fileFromArg);
  }
};
// アプリケーションの初期化
const initializeApp = async (): Promise<void> => {
  try {
    const locale = app.getLocale();
    const isJapanese = /^ja(-|$)/.test(locale);

    // アップデートの確認
    void autoUpdater.checkForUpdatesAndNotify();

    // メニューの設定
    Menu.setApplicationMenu(buildMenu(isJapanese));

    // ウィンドウ作成
    await createWindow();
  } catch (error) {
    console.error("Failed to initialize app:", error);
  }
};

// ファイルを開くイベント（macOS）
app.on("open-file", (event, path) => {
  event.preventDefault();
  openFilePaths.push(path);

  if (mainWindow?.webContents?.isLoading() === false) {
    mainWindow.webContents.send("open-file", openFilePaths);
    openFilePaths = [];
  }
});

// アプリケーションの準備ができたら実行
app
  .whenReady()
  .then(async () => {
    checkFileFromCommandLine();

    return initializeApp();
  })
  .catch((error) => {
    console.error("Application initialization failed:", error);
  });

// 全てのウィンドウが閉じられたときにアプリケーションを終了（macOS以外）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// アプリがアクティブになったとき（macOS）
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
