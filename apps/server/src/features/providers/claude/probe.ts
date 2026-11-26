import { emptyCwd, isolatedEnv } from "./options.ts";
import type { Connection } from "../types.ts";

export type Account = {
  readonly email?: string;
  readonly subscriptionType?: string;
  readonly tokenSource?: string;
};

/**
 * Starts the Claude process with no prompt and asks it for its account. That is the initialize handshake only: no model call
 * and no usage. A logged-out process reports `tokenSource: "none"` and no subscription. The process is always closed, also when
 * the wait runs out.
 */
async function readAccount(timeoutMs: number): Promise<Account> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const silence: AsyncIterable<never> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) };
  const claude = query({
    prompt: silence,
    options: { tools: [], settingSources: [], persistSession: false, mcpServers: {}, strictMcpConfig: true, cwd: emptyCwd(), env: isolatedEnv(process.env) },
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("no answer from the Claude process")), timeoutMs);
  });
  try {
    return await Promise.race([claude.accountInfo(), timeout]);
  } finally {
    clearTimeout(timer);
    claude.close();
  }
}

export function connectionOf(account: Account): Connection {
  const signedIn = account.email !== undefined || account.subscriptionType !== undefined || (account.tokenSource !== undefined && account.tokenSource !== "none");
  return signedIn ? { state: "connected", subscription: account.subscriptionType ?? null } : { state: "not_signed_in" };
}

export async function probeClaude(read: (timeoutMs: number) => Promise<Account> = readAccount, timeoutMs = 15_000): Promise<Connection> {
  try {
    return connectionOf(await read(timeoutMs));
  } catch {
    return { state: "unknown" };
  }
}
