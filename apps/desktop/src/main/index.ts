import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FromHost, ToHost } from "@hpt/server/client";
import { CHANNEL } from "../shared/channels.ts";
import { watchEngineSource } from "./dev-watch.ts";
import { hostLaunch, scenarioFrom } from "./host-launch.ts";
import { WINDOW_SECURITY, answeredLogLine, appendLog, askLogLine, askVerdict, classify, expectedRenderer, rejectedLogLine, senderVerdict, urlAllowed, type RejectReason } from "./input-guard.ts";
import { startSupervisor } from "./supervisor.ts";

/**
 * Electron main: a window, a supervisor, nothing else. It imports no engine code and no native module, so Electron's ABI never
 * matters here and a crash in SQLite or ONNX cannot take the window down.
 *
 * The page is sandboxed with context isolation, may not navigate or open windows, and renders corpus text only as text nodes.
 *
 * Input boundary (D32): a frame from the page is accepted only from this window's main frame at the page we loaded, and every ask is
 * written to data/logs/input-YYYY-MM-DD.jsonl with where it came from, never with its text. See input-guard.ts.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
/** The same data directory the server uses (apps/server/src/shared/config.ts), so one folder holds everything that stays local. */
const LOGS_DIR = path.join(REPO_ROOT, "data", "logs");
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
    webPreferences: { preload: path.join(import.meta.dirname, "../preload/index.cjs"), ...WINDOW_SECURITY },
  });
  window.setMenuBarVisibility(false);
  const { webContents } = window;
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const expected = expectedRenderer(process.env.ELECTRON_RENDERER_URL, pathToFileURL(path.join(import.meta.dirname, "../renderer/index.html")).href);
  const blockNavigation = (event: { preventDefault(): void }, url: string) => {
    if (urlAllowed(url, expected)) return;
    event.preventDefault();
    console.log(`[main] blocked navigation to ${url}`);
  };
  webContents.on("will-navigate", (event, url) => blockNavigation(event, url));
  webContents.on("will-frame-navigate", (event) => blockNavigation(event, event.url));

  const asks = new Set<string>();
  const log = (line: Parameters<typeof appendLog>[2]) => appendLog(LOGS_DIR, new Date(), line, (message) => console.log(`[main] ${message}`));
  const toWindow = (frame: FromHost) => {
    if (frame.kind === "result" && asks.delete(frame.id)) {
      const line = answeredLogLine(new Date(), frame.id, frame.result);
      if (line !== null) log(line);
    } else if (frame.kind === "error") asks.delete(frame.id);
    if (!webContents.isDestroyed()) webContents.send(CHANNEL.fromHost, frame);
  };

  const receive = supervisor.connect({
    send: toWindow,
    on: (event, listener) => {
      if (event === "closed") webContents.once("destroyed", listener);
      else
        webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
          if (isMainFrame && !inPlace) listener();
        });
    },
  });
  const reject = (reason: RejectReason, senderUrl: string) => {
    log(rejectedLogLine(new Date(), reason, senderUrl));
    console.log(`[main] dropped a frame: ${reason} (${senderUrl})`);
  };
  ipcMain.on(CHANNEL.toHost, (event, frame: unknown) => {
    const main = webContents.mainFrame;
    const from = event.senderFrame;
    const senderUrl = from?.url ?? event.sender.getURL();
    const sender = senderVerdict(
      { fromWindow: event.sender === webContents, isMainFrame: from !== null && from.processId === main.processId && from.routingId === main.routingId, frameUrl: senderUrl },
      expected,
    );
    if (!sender.ok) return reject(sender.reason, senderUrl);
    const classified = classify(frame);
    const verdict = askVerdict(classified);
    if (!verdict.ok) return reject(verdict.reason, senderUrl);
    if (classified.kind === "ask") {
      asks.add(classified.ask.id);
      log(askLogLine({ now: new Date(), ask: classified.ask, windowFocused: window.isFocused(), windowVisible: window.isVisible() }));
    }
    receive(frame as ToHost);
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
