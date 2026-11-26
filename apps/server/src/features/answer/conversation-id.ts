/**
 * A conversation id becomes `<dir>/<id>.jsonl`, so anything that is not exactly this shape is refused before it reaches a path.
 */
export type ConversationId = string;

const SHAPE = /^c-\d{8}-\d{6}-[0-9a-f]{4}$/;

export const isConversationId = (value: unknown): value is ConversationId => typeof value === "string" && SHAPE.test(value);
