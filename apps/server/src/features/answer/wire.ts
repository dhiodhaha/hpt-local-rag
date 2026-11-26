import { z } from "zod";

/**
 * The model's JSON, exactly as system-prompt-v2 Part 1 defines it. Private to this feature: wire values carry S-ids and the
 * model's own strings, and the pipeline turns them into domain values or rejects them.
 */

/** The prompt's field order, and the order the interface renders in (D5). A test fails if the prompt's JSON block disagrees. */
export const FIELD_ORDER = [
  "type",
  "basis",
  "unverified_references",
  "headline",
  "headline_short",
  "summary",
  "inference_note",
  "notes",
  "dalil",
  "quotes",
  "clarifying_question",
  "clarifying_options",
  "message",
] as const;
export type FieldName = (typeof FIELD_ORDER)[number];

export const ITEM_FIELDS = ["notes", "dalil", "quotes", "unverified_references", "clarifying_options"] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];
export type ScalarField = Exclude<FieldName, ItemField>;

export const isItemField = (name: string): name is ItemField => (ITEM_FIELDS as readonly string[]).includes(name);
export const isField = (name: string): name is FieldName => (FIELD_ORDER as readonly string[]).includes(name);

/** Strings that stream word by word before they are complete (D5a). Everything else renders on completion. */
export const PROGRESS_FIELDS: ReadonlySet<string> = new Set(["summary"]);

const basis = z.enum(["explicit", "inferred"]);
const text = z.string();
const nullableText = z.string().nullable();

const quote = z.object({ source: text, text });

export const SCALAR_SCHEMAS = {
  type: z.enum(["answer", "clarify", "insufficient", "out_of_scope", "declined"]),
  basis: basis.nullable(),
  headline: nullableText,
  headline_short: nullableText,
  summary: nullableText,
  inference_note: nullableText,
  clarifying_question: nullableText,
  message: nullableText,
} satisfies Record<ScalarField, z.ZodType>;

export const ITEM_SCHEMAS = {
  notes: z.object({
    id: text,
    kind: z.enum(["exception", "practical", "difference", "revision", "referral"]),
    title: text,
    text,
    basis,
    quote: quote.nullish(),
    sources: z.array(text),
  }),
  dalil: z.object({
    id: text,
    kind: z.enum(["quran", "hadith", "tarjih"]),
    reference: text,
    arabic: nullableText,
    translation: nullableText,
    explanation: text,
    explanation_basis: basis,
    sources: z.array(text),
  }),
  quotes: quote,
  unverified_references: z.object({ as_stated: text, note: text }),
  clarifying_options: text,
} satisfies Record<ItemField, z.ZodType>;

export type WireScalars = { [K in ScalarField]: z.infer<(typeof SCALAR_SCHEMAS)[K]> };
export type WireValue = { [K in ItemField]: z.infer<(typeof ITEM_SCHEMAS)[K]> };
export type WireNote = WireValue["notes"];
export type WireDalil = WireValue["dalil"];
export type WireQuote = WireValue["quotes"];

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

function parseWith(schema: z.ZodType, raw: string): Parsed<unknown> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, detail: "not valid JSON" };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const issue = result.error.issues[0];
  return { ok: false, detail: `${issue?.path.join(".") || "value"}: ${issue?.message ?? "invalid"}` };
}

/** A scalar field's raw JSON to its typed value. Enum violations and wrong types are `bad_shape`. */
export function parseScalar<K extends ScalarField>(name: K, raw: string): Parsed<WireScalars[K]> {
  return parseWith(SCALAR_SCHEMAS[name], raw) as Parsed<WireScalars[K]>;
}

export function parseItem<K extends ItemField>(name: K, raw: string): Parsed<WireValue[K]> {
  return parseWith(ITEM_SCHEMAS[name], raw) as Parsed<WireValue[K]>;
}
