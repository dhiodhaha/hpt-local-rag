import type { NoteId } from "./snapshot.ts";

/**
 * A putusan note id as the index stores it: `putusan/` and a slug. A UI sends one to read a note, and it only ever becomes a query
 * parameter, but one shape is checked at every door so a path or a wildcard never travels further than the schema. No imports from
 * Node, so this file stays usable from a browser bundle.
 */
const SHAPE = /^putusan\/[a-z0-9][a-z0-9-]{0,100}$/;

export const isPutusanNoteId = (value: unknown): value is NoteId => typeof value === "string" && SHAPE.test(value);
