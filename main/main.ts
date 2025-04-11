import { app, BrowserWindow, Menu } from "electron";
import { autoUpdater } from "electron-updater";
import * as fs from "fs/promises";
import * as path from "path";

let openFilePath: null | string = null;

type Settings = {
  windowHeight: number;
  windowWidth: number;
};

const defaultSettings: Settings = {
  windowHeight: 600,
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
const createWindow = async () => {
  const settings = await loadSettings();
  const win = new BrowserWindow({
    height: settings.windowHeight,
    webPreferences: {
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
    if (openFilePath) {
      win.webContents.send("open-file", openFilePath);
    }
  });

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
};

app.on("open-file", (event, path) => {
  event.preventDefault();
  openFilePath = path;
});

const args = process.argv;
const fileFromArg = args.find((arg) => /\.(mp4|mp3|mov|m4a|wav)$/i.test(arg));

if (fileFromArg) {
  openFilePath = fileFromArg;
}

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();

  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [{ role: "quit" }],
    },
  ]);

  Menu.setApplicationMenu(menu);
  createWindow();
});
