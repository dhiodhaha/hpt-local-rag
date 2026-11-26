import type { FromHost, Host, Pipe, ToHost } from "../features/host/index.ts";

/**
 * A Pipe wired straight to a Host, with no Electron and no process. Frames take the same JSON round trip fork IPC gives them,
 * and arrive on a later microtask, so a test sees the ordering a real transport has.
 */
export function memoryPipe(host: Host): Pipe {
  const listeners = new Set<(frame: FromHost) => void>();
  const send = (frame: FromHost) => {
    const copy: FromHost = JSON.parse(JSON.stringify(frame));
    queueMicrotask(() => {
      for (const listener of listeners) listener(copy);
    });
  };
  host.start(send);
  return {
    send: (frame: ToHost) => {
      const copy: unknown = JSON.parse(JSON.stringify(frame));
      queueMicrotask(() => host.handle(copy, send));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
