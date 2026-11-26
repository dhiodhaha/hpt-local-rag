import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The canary (D11), checked on the ACCUMULATED stream so a token split across chunks is still caught. One tripwire per
 * attempt, shared by the pipeline (model text) and the tool session (tool arguments). Once tripped it stays tripped.
 * The match ignores case: a canary the model re-cases is still a leak.
 */
export type Tripwire = {
  /** Feed a piece of the raw stream. True when the canary has now appeared, in this piece or across the seam with the last. */
  feed(text: string): boolean;
  /** A stateless check of one decoded value, so a canary hidden behind JSON escapes is still caught. */
  contains(text: string): boolean;
  readonly tripped: boolean;
  /** How many trailing characters of a streamed draft must be held back so a canary prefix never renders. */
  readonly holdBack: number;
};

export function createTripwire(canary: string): Tripwire {
  const needle = canary.toLowerCase();
  let tail = "";
  let tripped = false;
  const trip = (found: boolean) => {
    tripped ||= found;
    return found;
  };
  return {
    feed(text) {
      const seam = `${tail}${text.toLowerCase()}`;
      tail = seam.slice(Math.max(0, seam.length - (needle.length - 1)));
      return trip(seam.includes(needle));
    },
    contains: (text) => trip(text.toLowerCase().includes(needle)),
    get tripped() {
      return tripped;
    },
    holdBack: needle.length - 1,
  };
}

/**
 * The canary comes from local settings, never from the repo: env HPT_CANARY, else `file`. If neither exists the file is
 * created with a random token, so the first `hpt ask` works with no setup. An empty value is an error: a missing canary
 * must never mean "no check".
 */
export function loadCanary(file: string, env: NodeJS.ProcessEnv): string {
  const fromEnv = env.HPT_CANARY;
  if (fromEnv !== undefined) return nonEmpty(fromEnv, "HPT_CANARY");
  if (fs.existsSync(file)) return nonEmpty(fs.readFileSync(file, "utf8"), file);
  const created = `CANARY-${crypto.randomBytes(8).toString("hex")}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${created}\n`);
  return created;
}

function nonEmpty(value: string, source: string): string {
  const canary = value.trim();
  if (canary === "") throw new Error(`${source} is empty. A canary must not be blank.`);
  return canary;
}
