/** The two IPC channel names. One module imported by both main and preload, so they cannot disagree. */
export const CHANNEL = { toHost: "hpt:to-host", fromHost: "hpt:from-host" } as const;
