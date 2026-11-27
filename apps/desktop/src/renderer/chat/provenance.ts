import type { AskOrigin, AskVia } from "@hpt/server/client";

/** What the caller knows about an ask: the path and the DOM event that made it. The store adds the turn number. */
export type Provenance = Pick<AskOrigin, "via" | "trusted" | "focused">;

/** Read at the moment of the click or the key, from the event itself: a script's `.click()` or dispatched event is not trusted. */
export const provenanceOf = (via: AskVia, event: { readonly nativeEvent: Event }): Provenance => ({ via, trusted: event.nativeEvent.isTrusted, focused: document.hasFocus() });
