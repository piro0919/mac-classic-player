/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { app, BrowserWindow, Menu } from "electron";
import { autoUpdater } from "electron-updater";
import * as fs from "fs/promises";
import * as path from "path";

let openFilePath: null | string = null;
let mainWindow: BrowserWindow | null = null;

type Settings = {
  windowHeight: number;
  windowWidth: number;
};

const defaultSettings: Settings = {
  windowHeight: 450,
  windowWidth: 800,
};
const getSettingsPath = (): string => {
  return path.join(app.getPath("userData"), "settings.json");
};
const loadSettings = async (): Promise<Settings> => {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = await fs.readFile(getSettingsPath(), "utf-8");

    return JSON.parse(raw);
  } catch {
    return defaultSettings;
  }
};
const saveSettings = async (settings: Settings) => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(
    getSettingsPath(),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
};
const createWindow = async (): Promise<void> => {
  const settings = await loadSettings();

  mainWindow = new BrowserWindow({
    height: settings.windowHeight,
    icon: path.join(__dirname, "../assets/icon.png"),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
    width: settings.windowWidth,
  });

  mainWindow.on("resize", () => {
    const [width, height] = mainWindow!.getSize();

    saveSettings({ windowHeight: height, windowWidth: width });
  });

  const isDev = !app.isPackaged;
  const url = isDev
    ? "http://localhost:5173"
    : `file://${encodeURI(path.resolve(__dirname, "../dist/index.html"))}`;

  mainWindow.loadURL(url);

  mainWindow.webContents.once("did-finish-load", () => {
    if (openFilePath) {
      mainWindow?.webContents.send("open-file", [openFilePath]);
    }
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
};

app.on("open-file", (event, path) => {
  event.preventDefault();
  openFilePath = path;

  if (mainWindow?.webContents) {
    mainWindow.webContents.send("open-file", [openFilePath]);
  }
});

const args = process.argv;
const fileFromArg = args.find((arg) => /\.(mp4|mp3|mov|m4a|wav)$/i.test(arg));

if (fileFromArg) {
  openFilePath = fileFromArg;
}

const buildMenu = (isJapanese: boolean) =>
  Menu.buildFromTemplate([
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
            const { dialog } = require("electron");
            const { canceled, filePaths } = await dialog.showOpenDialog({
              filters: [
                {
                  extensions: ["mp4", "mp3", "mov", "m4a", "wav"],
                  name: isJapanese ? "メディアファイル" : "Media Files",
                },
              ],
              properties: ["openFile", "multiSelections"],
            });

            if (!canceled && filePaths.length > 0) {
              const win = BrowserWindow.getAllWindows()[0];

              win?.webContents.send("open-file", filePaths);
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
            const win = BrowserWindow.getAllWindows()[0];

            win?.webContents.send("toggle-help");
          },
          label: isJapanese
            ? "ショートカット一覧を表示"
            : "Show Shortcuts Help",
        },
        { type: "separator" },
        {
          click: () => {
            const version = app.getVersion();
            const { dialog } = require("electron");

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
            const { shell } = require("electron");

            shell.openExternal(
              "https://github.com/piro0919/mac-classic-player",
            );
          },
          label: "GitHub",
        },
      ],
    },
  ]);

app
  .whenReady()
  .then(() => {
    const locale = app.getLocale();
    const isJapanese = /^ja(-|$)/.test(locale);

    autoUpdater.checkForUpdatesAndNotify();

    Menu.setApplicationMenu(buildMenu(isJapanese));
    createWindow();

    return;
  })
  .catch(() => {});
