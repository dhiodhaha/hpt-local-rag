import { z } from "zod";
import { isConversationId, type Scope } from "../answer/client.ts";
import { isPutusanNoteId } from "../corpus/index.ts";
import type { AskParams, ToHost } from "./client.ts";

/**
 * Validation of everything a renderer sends. Node side only: the renderer never imports zod. Each schema is typed against the
 * TS type in client.ts, so a field added to AskParams without a schema entry fails to compile here.
 */
const MAX_QUESTION_CHARS = 4000;

const conversationId = z.string().refine(isConversationId, "not a conversation id");
const noteId = z.string().refine(isPutusanNoteId, "not a putusan note id");

// A PassageId is a branded string in the domain types. The parse produces the plain string and the brand is only a type.
const scope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), noteId }),
  z.object({ kind: z.literal("revision"), active: z.string().min(1), superseded: z.string().min(1) }),
]) as unknown as z.ZodType<Scope>;

export const AskParamsSchema: z.ZodType<AskParams> = z.object({
  conversation: conversationId.nullable(),
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  scope: scope.nullable(),
  choice: z.object({ provider: z.literal("claude"), model: z.string().min(1) }).nullable(),
});

const MAX_QUERY_CHARS = 200;
const MAX_TITLE_CHARS = 400;
const callId = z.string().min(1);

export const ToHostSchema: z.ZodType<ToHost> = z.union([
  z.object({ kind: z.literal("hello") }),
  z.object({ kind: z.literal("call"), id: callId, method: z.literal("ask"), params: AskParamsSchema }),
  z.object({ kind: z.literal("call"), id: callId, method: z.literal("list"), params: z.null() }),
  z.object({ kind: z.literal("call"), id: callId, method: z.literal("open"), params: z.object({ conversation: conversationId }) }),
  z.object({ kind: z.literal("call"), id: callId, method: z.literal("search"), params: z.object({ query: z.string().max(MAX_QUERY_CHARS) }) }),
  z.object({ kind: z.literal("call"), id: callId, method: z.literal("passages"), params: z.object({ noteId }) }),
  z.object({ kind: z.literal("call"), id: callId, method: z.literal("rename"), params: z.object({ conversation: conversationId, title: z.string().max(MAX_TITLE_CHARS) }) }),
  z.object({ kind: z.literal("call"), id: callId, method: z.literal("remove"), params: z.object({ conversation: conversationId }) }),
  z.object({ kind: z.literal("cancel"), id: callId }),
]);
