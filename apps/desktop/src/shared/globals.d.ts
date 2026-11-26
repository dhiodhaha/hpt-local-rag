import type { Pipe } from "@hpt/server/client";

declare global {
  interface Window {
    readonly hptPipe: Pipe;
  }
}
