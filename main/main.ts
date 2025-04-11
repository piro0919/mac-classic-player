import { app, BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs/promises";

interface Settings {
  windowWidth: number;
  windowHeight: number;
}

const defaultSettings: Settings = {
  windowWidth: 800,
  windowHeight: 600,
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
    width: settings.windowWidth,
    height: settings.windowHeight,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  win.on("resize", () => {
    const [width, height] = win.getSize();
    saveSettings({ windowWidth: width, windowHeight: height });
  });

  const isDev = !app.isPackaged;

  const url = isDev
    ? "http://localhost:5173"
    : `file://${encodeURI(path.resolve(__dirname, "../dist/index.html"))}`;

  win.loadURL(url);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
};

app.whenReady().then(createWindow);
