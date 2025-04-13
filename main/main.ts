/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable security/detect-non-literal-regexp */
/* eslint-disable promise/always-return */
/* eslint-disable promise/catch-or-return */
/* eslint-disable security/detect-non-literal-fs-filename */
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { autoUpdater } from "electron-updater";
import * as fs from "fs/promises";
import * as path from "path";

const openFilePaths: string[] = [];

type Settings = {
  windowHeight: number;
  windowWidth: number;
};

const defaultSettings: Settings = {
  windowHeight: 450,
  windowWidth: 800,
};
const getSettingsPath = () => {
  return path.join(app.getPath("userData"), "settings.json");
};
const loadSettings = async (): Promise<Settings> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf-8");

    return JSON.parse(raw);
  } catch {
    return defaultSettings;
  }
};
const saveSettings = async (settings: Settings) => {
  await fs.writeFile(
    getSettingsPath(),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
};
const createWindow = async (): Promise<BrowserWindow> => {
  const settings = await loadSettings();
  const win = new BrowserWindow({
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

  win.on("resize", () => {
    const [width, height] = win.getSize();

    saveSettings({ windowHeight: height, windowWidth: width });
  });

  const isDev = !app.isPackaged;
  const url = isDev
    ? "http://localhost:5173"
    : `file://${encodeURI(path.resolve(__dirname, "../dist/index.html"))}`;

  win.loadURL(url);

  win.webContents.once("did-finish-load", () => {
    if (openFilePaths.length > 0) {
      win.webContents.send("open-file", openFilePaths);
    }
  });

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
};
const SUPPORTED_EXTENSIONS = ["mp4", "mp3", "mov", "m4a", "wav"];
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
/**
 * メニューを構築
 */
const buildMenu = (isJapanese: boolean, mainWindow: BrowserWindow) => {
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

// ファイルを開くイベント（macOS）
app.on("open-file", (event, path) => {
  event.preventDefault();
  console.log("open-file イベント発生:", path);
  openFilePaths.push(path);
});

app.whenReady().then(async () => {
  checkFileFromCommandLine();

  const locale = app.getLocale();
  const isJapanese = /^ja(-|$)/.test(locale);

  // アップデートの確認
  void autoUpdater.checkForUpdatesAndNotify();

  const mainWindow = await createWindow();

  // メニューの設定
  Menu.setApplicationMenu(buildMenu(isJapanese, mainWindow));
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
