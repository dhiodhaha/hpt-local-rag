import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { ToHost } from "@hpt/server/client";
import { CHANNEL } from "../shared/channels.ts";
import { watchEngineSource } from "./dev-watch.ts";
import { hostLaunch, scenarioFrom } from "./host-launch.ts";
import { startSupervisor } from "./supervisor.ts";

/**
 * Electron main: a window, a supervisor, nothing else. It imports no engine code and no native module, so Electron's ABI never
 * matters here and a crash in SQLite or ONNX cannot take the window down.
 *
 * The page is sandboxed with context isolation, may not navigate or open windows, and renders corpus text only as text nodes.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const GROUND = "#f2f3f6";

async function main(): Promise<void> {
  const userData = process.env.HPT_USER_DATA;
  if (userData !== undefined && userData !== "") app.setPath("userData", userData);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  const scenario = scenarioFrom(process.argv, process.env);
  const supervisor = startSupervisor({
    log: (line) => console.log(`[host] ${line}`),
    launch: () => hostLaunch({ repoRoot: REPO_ROOT, scenario, env: process.env }),
  });
  const stopWatching = app.isPackaged || scenario !== null ? () => {} : watchEngineSource(REPO_ROOT, (file) => void supervisor.restart(`${file} changed`));

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: GROUND,
    title: "Tanya HPT",
    show: process.env.HPT_SHOW_WINDOW !== "0",
    webPreferences: { preload: path.join(import.meta.dirname, "../preload/index.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.setMenuBarVisibility(false);
  const { webContents } = window;
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, url) => {
    if (url !== webContents.getURL()) event.preventDefault();
  });

  const receive = supervisor.connect({
    send: (frame) => {
      if (!webContents.isDestroyed()) webContents.send(CHANNEL.fromHost, frame);
    },
    on: (event, listener) => {
      if (event === "closed") webContents.once("destroyed", listener);
      else
        webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
          if (isMainFrame && !inPlace) listener();
        });
    },
  });
  ipcMain.on(CHANNEL.toHost, (event, frame: ToHost) => {
    if (event.sender === webContents) receive(frame);
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl === undefined || rendererUrl === "") await window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  else await window.loadURL(rendererUrl);

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    stopWatching();
    void supervisor.close().finally(() => app.exit(0));
  });
  app.on("window-all-closed", () => app.quit());
}

void main();
