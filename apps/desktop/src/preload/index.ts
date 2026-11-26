import { contextBridge, ipcRenderer } from "electron";
import type { FromHost, Pipe, ToHost } from "@hpt/server/client";
import { CHANNEL } from "../shared/channels.ts";

/**
 * The whole preload: expose a Pipe and nothing else. No `ipcRenderer`, no channel names, no helpers reach the page. The listener is
 * re-wrapped so the page never receives the IpcRendererEvent, which carries `sender`.
 */
const pipe: Pipe = {
  send: (frame: ToHost) => ipcRenderer.send(CHANNEL.toHost, frame),
  subscribe: (listener) => {
    const handler = (_event: unknown, frame: FromHost) => listener(frame);
    ipcRenderer.on(CHANNEL.fromHost, handler);
    return () => ipcRenderer.removeListener(CHANNEL.fromHost, handler);
  },
};

contextBridge.exposeInMainWorld("hptPipe", pipe);
