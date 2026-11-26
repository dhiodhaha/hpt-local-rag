/**
 * The streamed-JSON field scanner. It knows JSON, not our schema: it finds where each TOP-LEVEL value, and each element of a
 * top-level array, starts and ends, and hands out the raw text of that span. Parsing and checking happen elsewhere, per span,
 * so a malformed field cannot corrupt the next one.
 *
 * Hand-written because the pipeline needs "this value is COMPLETE" for scalars and array items, which generic partial-JSON
 * parsers do not say (a number or a string looks the same half-way), plus exact raw spans and a dead state on the first
 * malformed byte. The shape is fixed, so a depth counter and a string/escape flag are enough.
 *
 *   - Chunk-invariant: any split of the same text yields the same events, except that `progress` may be emitted fewer times.
 *   - Tolerates a leading ```json fence and a trailing ``` (reported as `fence`), nothing else outside the object.
 *   - `progress` is emitted at most once per push, only for string fields in `progressFields`, with the whole decoded string so
 *     far. A half-received escape (\u12, a lone high surrogate) is held back until complete.
 *   - After `error` the scanner is dead and further pushes return []. After `end` only whitespace and backticks may follow.
 *   - A repeated top-level key is an error: the second value would silently replace a checked one.
 */
export type ScanEvent =
  | { readonly kind: "progress"; readonly field: string; readonly text: string }
  /** An array element is complete. Strings and numbers in arrays are items too (`raw` is the JSON literal). */
  | { readonly kind: "item"; readonly field: string; readonly index: number; readonly raw: string }
  /** A top-level value is complete. For an array, `raw` is the whole array, after its last `item`. */
  | { readonly kind: "value"; readonly field: string; readonly raw: string }
  | { readonly kind: "fence" }
  | { readonly kind: "end" }
  | { readonly kind: "error"; readonly reason: "not_json" | "malformed" | "trailing" | "duplicate_key"; readonly at: number };

export type Scanner = {
  push(chunk: string): ScanEvent[];
  readonly seen: readonly string[];
  readonly dead: boolean;
};

type Fed = "open" | "closed" | "closed_before" | "invalid";

class ValueSpan {
  #kind: "string" | "container" | "literal" | null = null;
  #depth = 0;
  #inString = false;
  #escape = false;

  get isString(): boolean {
    return this.#kind === "string";
  }

  feed(ch: string): Fed {
    if (this.#kind === null) return this.#start(ch);
    if (this.#kind === "literal") {
      if (/[\s,\]}]/.test(ch)) return "closed_before";
      return /[A-Za-z0-9+\-.]/.test(ch) ? "open" : "invalid";
    }
    if (this.#kind === "string") return this.#inStringChar(ch) ? "closed" : "open";
    if (this.#inString) {
      this.#inStringChar(ch);
      return "open";
    }
    if (ch === '"') this.#inString = true;
    else if (ch === "{" || ch === "[") this.#depth += 1;
    else if (ch === "}" || ch === "]") this.#depth -= 1;
    return this.#depth === 0 ? "closed" : "open";
  }

  #start(ch: string): Fed {
    if (ch === '"') {
      this.#kind = "string";
      this.#inString = true;
      return "open";
    }
    if (ch === "{" || ch === "[") {
      this.#kind = "container";
      this.#depth = 1;
      return "open";
    }
    if (/[-0-9tfn]/.test(ch)) {
      this.#kind = "literal";
      return "open";
    }
    return "invalid";
  }

  #inStringChar(ch: string): boolean {
    if (this.#escape) {
      this.#escape = false;
      return false;
    }
    if (ch === "\\") {
      this.#escape = true;
      return false;
    }
    if (ch === '"') {
      this.#inString = false;
      return this.#kind === "string";
    }
    return false;
  }
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };

/** The decoded text of a JSON string body that may stop mid-escape. A half-received escape is left out until it completes. */
export function decodePartialString(raw: string): string {
  let out = "";
  let index = 0;
  while (index < raw.length) {
    const ch = raw.charAt(index);
    if (ch !== "\\") {
      out += ch;
      index += 1;
      continue;
    }
    const next = raw.charAt(index + 1);
    if (next === "") break;
    if (next !== "u") {
      out += SIMPLE_ESCAPES[next] ?? next;
      index += 2;
      continue;
    }
    const hex = raw.slice(index + 2, index + 6);
    if (hex.length < 4) break;
    const code = Number.parseInt(hex, 16);
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    if (isHighSurrogate && raw.length < index + 12) break;
    out += Number.isNaN(code) ? "" : String.fromCharCode(code);
    index += 6;
  }
  return out;
}

type Phase = "pre" | "fence" | "key_wait" | "key" | "colon" | "value_wait" | "value" | "array" | "after_value" | "done" | "dead";

type ArrayState = { index: number; state: "need" | "in" | "after"; afterComma: boolean; item: ValueSpan; itemStart: number };

export function createScanner(options: { readonly progressFields: ReadonlySet<string> }): Scanner {
  let buffer = "";
  let position = 0;
  let phase: Phase = "pre";
  let fenceStart = 0;
  let keyStart = 0;
  let keyEscape = false;
  let canClose = true;
  let key = "";
  let valueStart = 0;
  let span = new ValueSpan();
  let array: ArrayState | null = null;
  let lastProgress = "";
  const seen: string[] = [];
  const isDead = () => phase === "dead";

  function push(chunk: string): ScanEvent[] {
    if (isDead()) return [];
    buffer += chunk;
    const events: ScanEvent[] = [];
    const fail = (reason: "not_json" | "malformed" | "trailing" | "duplicate_key") => {
      events.push({ kind: "error", reason, at: position });
      phase = "dead";
    };
    const finishValue = (raw: string) => {
      events.push({ kind: "value", field: key, raw });
      seen.push(key);
      lastProgress = "";
      phase = "after_value";
    };

    while (position < buffer.length && !isDead()) {
      const ch = buffer.charAt(position);
      const isSpace = /\s/.test(ch);
      let consumed = true;

      switch (phase) {
        case "pre":
          if (isSpace) break;
          if (ch === "`") {
            fenceStart = position;
            phase = "fence";
          } else if (ch === "{") {
            phase = "key_wait";
            canClose = true;
          } else fail("not_json");
          break;
        case "fence":
          if (ch !== "\n") break;
          if (/^```[A-Za-z]*\s*$/.test(buffer.slice(fenceStart, position))) {
            events.push({ kind: "fence" });
            phase = "pre";
          } else fail("not_json");
          break;
        case "key_wait":
          if (isSpace) break;
          if (ch === '"') {
            keyStart = position;
            keyEscape = false;
            phase = "key";
          } else if (ch === "}" && canClose) {
            events.push({ kind: "end" });
            phase = "done";
          } else fail("malformed");
          break;
        case "key":
          if (keyEscape) keyEscape = false;
          else if (ch === "\\") keyEscape = true;
          else if (ch === '"') {
            try {
              key = JSON.parse(buffer.slice(keyStart, position + 1)) as string;
            } catch {
              fail("malformed");
              break;
            }
            if (seen.includes(key)) fail("duplicate_key");
            else phase = "colon";
          }
          break;
        case "colon":
          if (isSpace) break;
          if (ch === ":") phase = "value_wait";
          else fail("malformed");
          break;
        case "value_wait":
          if (isSpace) break;
          valueStart = position;
          if (ch === "[") {
            array = { index: 0, state: "need", afterComma: false, item: new ValueSpan(), itemStart: 0 };
            phase = "array";
            break;
          }
          span = new ValueSpan();
          phase = "value";
          consumed = false;
          break;
        case "value": {
          const fed = span.feed(ch);
          if (fed === "invalid") fail("malformed");
          else if (fed === "closed") finishValue(buffer.slice(valueStart, position + 1));
          else if (fed === "closed_before") {
            finishValue(buffer.slice(valueStart, position));
            consumed = false;
          }
          break;
        }
        case "array": {
          const state = array as ArrayState;
          if (state.state === "need") {
            if (isSpace) break;
            if (ch === "]" && !state.afterComma) {
              finishValue(buffer.slice(valueStart, position + 1));
              break;
            }
            state.item = new ValueSpan();
            state.itemStart = position;
            state.state = "in";
            consumed = false;
          } else if (state.state === "in") {
            const fed = state.item.feed(ch);
            if (fed === "invalid") fail("malformed");
            else if (fed === "closed" || fed === "closed_before") {
              const end = fed === "closed" ? position + 1 : position;
              events.push({ kind: "item", field: key, index: state.index, raw: buffer.slice(state.itemStart, end) });
              state.index += 1;
              state.state = "after";
              consumed = fed === "closed";
            }
          } else {
            if (isSpace) break;
            if (ch === ",") {
              state.state = "need";
              state.afterComma = true;
            } else if (ch === "]") finishValue(buffer.slice(valueStart, position + 1));
            else fail("malformed");
          }
          break;
        }
        case "after_value":
          if (isSpace) break;
          if (ch === ",") {
            phase = "key_wait";
            canClose = false;
          } else if (ch === "}") {
            events.push({ kind: "end" });
            phase = "done";
          } else fail("malformed");
          break;
        case "done":
          if (!isSpace && ch !== "`") fail("trailing");
          break;
      }
      if (consumed) position += 1;
    }

    if (phase === "value" && span.isString && options.progressFields.has(key)) {
      const text = decodePartialString(buffer.slice(valueStart + 1, position));
      if (text !== lastProgress) {
        lastProgress = text;
        events.push({ kind: "progress", field: key, text });
      }
    }
    return events;
  }

  return {
    push,
    seen,
    get dead() {
      return isDead();
    },
  };
}
