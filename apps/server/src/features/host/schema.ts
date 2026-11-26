import { z } from "zod";
import { isConversationId, type Scope } from "../answer/client.ts";
import type { AskParams, ToHost } from "./client.ts";

/**
 * Validation of everything a renderer sends. Node side only: the renderer never imports zod. Each schema is typed against the
 * TS type in client.ts, so a field added to AskParams without a schema entry fails to compile here.
 */
const MAX_QUESTION_CHARS = 4000;

const conversationId = z.string().refine(isConversationId, "not a conversation id");

// A PassageId is a branded string in the domain types. The parse produces the plain string and the brand is only a type.
const scope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), noteId: z.string().startsWith("putusan/") }),
  z.object({ kind: z.literal("revision"), active: z.string().min(1), superseded: z.string().min(1) }),
]) as unknown as z.ZodType<Scope>;

export const AskParamsSchema: z.ZodType<AskParams> = z.object({
  conversation: conversationId.nullable(),
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  scope: scope.nullable(),
  choice: z.object({ provider: z.literal("claude"), model: z.string().min(1) }).nullable(),
});

export const ToHostSchema: z.ZodType<ToHost> = z.union([
  z.object({ kind: z.literal("hello") }),
  z.object({ kind: z.literal("call"), id: z.string().min(1), method: z.literal("ask"), params: AskParamsSchema }),
  z.object({ kind: z.literal("cancel"), id: z.string().min(1) }),
]);
