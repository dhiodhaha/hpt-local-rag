/**
 * The host feature's node-side surface: `hpt host` and tests import from here. The browser-safe half is client.ts and reaches
 * apps through `@hpt/server/client`. Not exported: the zod schemas and the open-call bookkeeping.
 */
export { claudeModelOptions, createHost } from "./host.ts";
export type { Backend, Host, HostDeps } from "./host.ts";
export * from "./client.ts";
