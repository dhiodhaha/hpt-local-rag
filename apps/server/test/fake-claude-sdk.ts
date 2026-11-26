import type { ClaudeMessage, ClaudeOptions, ClaudeQuery, ClaudeSdk, ClaudeWarm, ToolBinding } from "../src/features/providers/claude/sdk.ts";
import type { ToolSpec } from "../src/features/providers/index.ts";

export const textDelta = (text: string): ClaudeMessage => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
export const thinkingDelta = (thinking: string): ClaudeMessage => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking } } });
export const toolStart = (name: string): ClaudeMessage => ({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name } } });
export const successResult = (extra: Record<string, unknown> = {}): ClaudeMessage => ({
  type: "result",
  subtype: "success",
  is_error: false,
  usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
  ...extra,
});

export type FakeQueryScript = {
  messages: readonly ClaudeMessage[];
  after?: { index: number; run: () => Promise<void> };
  /** After the last message the iterator never finishes until closed, like the SDK's teardown lag. */
  hangAfter?: boolean;
  throwAfterMessages?: Error;
};

export type FakeQuery = ClaudeQuery & { closed: boolean; prompt: string };

function fakeQuery(prompt: string, script: FakeQueryScript): FakeQuery {
  let closeHang: () => void = () => {};
  const hang = new Promise<void>((resolve) => {
    closeHang = resolve;
  });
  const query = {
    closed: false,
    prompt,
    close() {
      query.closed = true;
      closeHang();
    },
    async *[Symbol.asyncIterator]() {
      for (const [index, message] of script.messages.entries()) {
        if (query.closed) return;
        yield message;
        if (script.after?.index === index) await script.after.run();
      }
      if (script.throwAfterMessages) throw script.throwAfterMessages;
      if (script.hangAfter) await hang;
    },
  } as unknown as FakeQuery;
  const iterator = query[Symbol.asyncIterator]();
  Object.assign(query, {
    next: () => iterator.next(),
    return: () => iterator.return(undefined),
    throw: (error: unknown) => iterator.throw(error),
  });
  return query;
}

export type FakeSdk = ClaudeSdk & {
  startups: { options: ClaudeOptions; warm: FakeWarm | null }[];
  queries: { options: ClaudeOptions; query: FakeQuery }[];
  servers: { specs: readonly ToolSpec[]; binding: ToolBinding }[];
  /** Per-call overrides; each is consumed once. */
  nextScripts: FakeQueryScript[];
  startupDelayMs: number;
  startupFails: boolean;
};

export type FakeWarm = ClaudeWarm & { closed: boolean; queried: FakeQuery | null };

const DEFAULT_SCRIPT: FakeQueryScript = { messages: [textDelta("{}"), successResult()] };

export function fakeSdk(): FakeSdk {
  const sdk: FakeSdk = {
    startups: [],
    queries: [],
    servers: [],
    nextScripts: [],
    startupDelayMs: 0,
    startupFails: false,
    query: ({ prompt, options }) => {
      const query = fakeQuery(prompt, sdk.nextScripts.shift() ?? DEFAULT_SCRIPT);
      sdk.queries.push({ options, query });
      return query;
    },
    startup: async ({ options }) => {
      const record: FakeSdk["startups"][number] = { options, warm: null };
      sdk.startups.push(record);
      if (sdk.startupDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, sdk.startupDelayMs));
      if (sdk.startupFails) throw new Error("boot failed");
      const warm: FakeWarm = {
        closed: false,
        queried: null,
        query(prompt) {
          warm.queried = fakeQuery(prompt, sdk.nextScripts.shift() ?? DEFAULT_SCRIPT);
          return warm.queried;
        },
        close() {
          warm.closed = true;
        },
      };
      record.warm = warm;
      return warm;
    },
    mcpServer: (specs, binding) => {
      sdk.servers.push({ specs, binding });
      return { specs };
    },
  };
  return sdk;
}
