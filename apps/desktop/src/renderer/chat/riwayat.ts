import type { ConversationSummary, Snippet } from "@hpt/server/client";

/** All in local time and a function of `now`, so the sidebar and the "Semua percakapan" page cannot disagree about what "Kemarin" is. */
export type DayGroup = "today" | "yesterday" | "week" | "older";

export const DAY_GROUP_LABEL = { today: "Hari ini", yesterday: "Kemarin", week: "7 hari terakhir", older: "Lebih lama" } as const satisfies Record<DayGroup, string>;

const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const DAY_MS = 86_400_000;

export function dayGroupOf(iso: string, now: Date): DayGroup {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return days <= 7 ? "week" : "older";
}

export type Group<K extends string> = { readonly key: K; readonly label: string; readonly conversations: readonly ConversationSummary[] };

const newestFirst = (conversations: readonly ConversationSummary[]) => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export function groupByDay(conversations: readonly ConversationSummary[], now: Date): Group<DayGroup>[] {
  const buckets = new Map<DayGroup, ConversationSummary[]>();
  for (const conversation of newestFirst(conversations)) {
    const key = dayGroupOf(conversation.updatedAt, now);
    buckets.set(key, [...(buckets.get(key) ?? []), conversation]);
  }
  return (["today", "yesterday", "week", "older"] as const).flatMap((key) => {
    const found = buckets.get(key);
    return found === undefined ? [] : [{ key, label: DAY_GROUP_LABEL[key], conversations: found }];
  });
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;
const WEEKDAYS_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"] as const;

export const monthKeyOf = (iso: string): string => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export const monthLabelOf = (key: string): string => {
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1] ?? ""} ${year ?? ""}`.trim();
};

const monthNameOf = (key: string): string => MONTHS[Number(key.split("-")[1]) - 1] ?? key;

export function monthsOf(conversations: readonly ConversationSummary[]): { readonly key: string; readonly label: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const conversation of conversations) {
    const key = monthKeyOf(conversation.updatedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, count]) => ({ key, label: monthNameOf(key), count }));
}

export function groupByMonth(conversations: readonly ConversationSummary[]): Group<string>[] {
  const buckets = new Map<string, ConversationSummary[]>();
  for (const conversation of newestFirst(conversations)) {
    const key = monthKeyOf(conversation.updatedAt);
    buckets.set(key, [...(buckets.get(key) ?? []), conversation]);
  }
  return [...buckets.entries()].map(([key, found]) => ({ key, label: monthLabelOf(key).toUpperCase(), conversations: found }));
}

export function whenOf(iso: string, now: Date): string {
  const group = dayGroupOf(iso, now);
  const date = new Date(iso);
  if (group === "today") return DAY_GROUP_LABEL.today;
  if (group === "yesterday") return DAY_GROUP_LABEL.yesterday;
  if (group === "week") return WEEKDAYS_SHORT[date.getDay()] ?? "";
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()] ?? ""}${year}`;
}

export function dayOf(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()] ?? ""}`;
}

export function metaOf(conversation: ConversationSummary): string {
  const gist = conversation.gist === null ? "" : `${conversation.gist.charAt(0).toUpperCase()}${conversation.gist.slice(1)}`.replace(/\.$/, "");
  const sources = conversation.sources === 0 ? "" : `${conversation.sources} sumber`;
  return [gist, sources].filter((part) => part !== "").join(" · ");
}

export type Piece = { readonly text: string; readonly marked: boolean };

export function piecesOf(text: string, marks: readonly (readonly [number, number])[]): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const [from, to] of marks) {
    if (from > at) pieces.push({ text: text.slice(at, from), marked: false });
    pieces.push({ text: text.slice(from, to), marked: true });
    at = to;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), marked: false });
  return pieces;
}

export function titlePieces(title: string, terms: readonly string[]): Piece[] {
  const lower = title.toLowerCase();
  const haystack = lower.length === title.length ? lower : title;
  const ranges: [number, number][] = [];
  for (const term of terms) for (let at = haystack.indexOf(term); at !== -1; at = haystack.indexOf(term, at + term.length)) ranges.push([at, at + term.length]);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return piecesOf(title, merged);
}

export const snippetPieces = (snippet: Snippet): Piece[] => piecesOf(snippet.text, snippet.marks);

export function stampOf(at: number, now: Date): string {
  const date = new Date(at);
  const clock = `${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}`;
  const group = dayGroupOf(date.toISOString(), now);
  if (group === "today" || group === "yesterday") return `${DAY_GROUP_LABEL[group]}, ${clock}`;
  return `${dayOf(date.toISOString())}, ${clock}`;
}
