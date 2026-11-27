import { createEngine, jsonlTraceSink, loadCanary, loadPromptTemplate, openConversations, type AnswerEngine, type Conversations, type EngineSettings, type TraceSink } from "./features/answer/index.ts";
import { claudeProvider, type ApiCredential } from "./features/providers/index.ts";
import { loadEmbedder, openIndex, type HptIndex } from "./features/search/index.ts";
import { answerConfig, config } from "./shared/config.ts";

/**
 * The one place the index, the prompt, the canary, the provider and the engine meet. `hpt ask` calls it, and so will the
 * answer eval, so the eval measures the engine the CLI runs and not a copy. Opening the index throws IndexUnavailableError
 * when `hpt build` has not run.
 */
export type Composed = {
  readonly engine: AnswerEngine;
  readonly conversations: Conversations;
  readonly index: HptIndex;
  /** Closes the engine, the provider's spare process and the index. Safe to call twice. */
  close(): Promise<void>;
};

export type ComposeOptions = {
  readonly settings?: Partial<EngineSettings>;
  /** Written to in addition to data/traces/. The eval reads its own traces back through this. */
  readonly extraTraceSink?: TraceSink;
  /** D34: the API key (and workspace) a model-calling eval runs on. The app and `hpt ask` leave it out, so they use the plan login. */
  readonly api?: ApiCredential;
};

export async function compose(options: ComposeOptions = {}): Promise<Composed> {
  const index = openIndex({ path: config.indexFile, embedder: () => loadEmbedder({ modelDir: config.modelDir, allowDownload: false }) });
  const files = jsonlTraceSink(answerConfig.tracesDir);
  const traces: TraceSink = { write: (trace) => [files, options.extraTraceSink].forEach((sink) => sink?.write(trace)) };
  const engine = createEngine({
    index,
    provider: claudeProvider({ api: options.api }),
    prompt: loadPromptTemplate(answerConfig.systemPromptDoc),
    canary: loadCanary(answerConfig.canaryFile, process.env),
    traces,
    settings: { ...answerConfig.answer, ...options.settings },
  });
  let closing: Promise<void> | null = null;
  return {
    engine,
    index,
    conversations: openConversations(answerConfig.conversationsDir, { tracesDir: answerConfig.tracesDir }),
    close: () =>
      (closing ??= engine.close().then(
        () => index.close(),
        (cause) => {
          index.close();
          throw cause;
        },
      )),
  };
}
