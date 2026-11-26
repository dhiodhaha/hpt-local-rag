import type { VaultNote } from "../corpus/index.ts";
import type { Chunk } from "./chunk.ts";
import type { Locator, SourceType } from "./types.ts";

type FolderRule = {
  folder: RegExp;
  /** Compiled books label each section; every other folder has one type. */
  sourceType: SourceType | ((chunk: Chunk) => SourceType);
  parent: string | null;
  /** Capture group 1 of `folder` is the volume ("HPT 3" is volume 3). */
  volumeFromFolder: boolean;
};

/**
 * The only place that maps a folder to a source type. A putusan whose folder matches no row fails the build,
 * so a new collection is one row here and never a silent default.
 */
export const FOLDER_RULES: readonly FolderRule[] = [
  { folder: /^Fatwa (?:\d{4}|Zakat)$/, sourceType: "fatwa", parent: null, volumeFromFolder: false },
  { folder: /^HPT (\d+)$/, sourceType: "hpt", parent: null, volumeFromFolder: true },
  { folder: /^TJA (\d+)$/, sourceType: "tanya_jawab", parent: null, volumeFromFolder: true },
  { folder: /^Fikih Muhammadiyah$/, sourceType: bookSectionType, parent: "Fikih Muhammadiyah", volumeFromFolder: false },
  { folder: /^Panduan Penyusunan Fatwa$/, sourceType: "penjelasan", parent: "Panduan Penyusunan Fatwa", volumeFromFolder: false },
];

/**
 * D12: inside a compiled book only a decision span is a putusan (`decision-spans.ts`). Everything else, a KEPUTUSAN
 * section without a marker included, is penjelasan. That errs toward the weaker label: explanation labelled as a
 * decision is the costlier mistake.
 */
function bookSectionType(chunk: Chunk): SourceType {
  return chunk.span !== null ? "putusan" : "penjelasan";
}

export class UnknownFolderError extends Error {}

export type NoteMeta = {
  number: string | null;
  year: number | null;
  publishedIn: string | null;
  volume: string | null;
};

export type PassageMeta = {
  sourceType: SourceType;
  parent: string | null;
  locator: Locator;
};

function ruleFor(note: VaultNote): FolderRule {
  const rule = FOLDER_RULES.find((candidate) => candidate.folder.test(note.folder ?? ""));
  if (!rule) throw new UnknownFolderError(`${note.id}: folder ${JSON.stringify(note.folder)} matches no FOLDER_RULES row`);
  return rule;
}

/** True for the notes whose sections are labelled one by one. A note in no known folder is not one. */
export function isCompiledBook(note: VaultNote): boolean {
  const rule = FOLDER_RULES.find((candidate) => candidate.folder.test(note.folder ?? ""));
  return rule !== undefined && typeof rule.sourceType === "function";
}

export function describeNote(note: VaultNote): NoteMeta {
  const rule = ruleFor(note);
  const numbered = /^fatwa-(\d+(?:-[a-z])?)-(?:(\d{4})-|zakat-)/.exec(note.slug);
  const publication = /-sm-no-(\d{1,2}(?:-\d{1,2})?)-(\d{4})$/.exec(note.slug);
  return {
    number: numbered?.[1] ?? null,
    year: note.year ?? (numbered?.[2] ? Number(numbered[2]) : null),
    publishedIn: publication ? `Suara Muhammadiyah No. ${publication[1]}/${publication[2]}` : null,
    volume: rule.volumeFromFolder ? (rule.folder.exec(note.folder ?? "")?.[1] ?? null) : null,
  };
}

function titleCase(slugWords: string): string {
  return slugWords
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function locatorFor(note: VaultNote, noteMeta: NoteMeta, chunk: Chunk): Locator {
  const headings = [chunk.top, chunk.sub].filter((heading): heading is string => heading !== null);
  const find = (keyword: string) => {
    for (const heading of headings) {
      const match = new RegExp(`^${keyword}\\s+(\\S.*)$`).exec(heading);
      if (match) return match[1];
    }
    return undefined;
  };
  const kitabFromSlug = /^hpt-jilid-\d+-kitab-(.+)$/.exec(note.slug)?.[1];
  const locator: Locator = {};
  if (noteMeta.volume) locator.volume = noteMeta.volume;
  const kitab = find("KITAB") ?? (kitabFromSlug ? titleCase(kitabFromSlug) : undefined);
  if (kitab) locator.kitab = kitab;
  const bab = find("BAB");
  if (bab) locator.bab = bab;
  const pasal = find("PASAL");
  if (pasal) locator.pasal = pasal;
  if (chunk.page !== null) locator.page = chunk.page;
  return locator;
}

export function describePassage(note: VaultNote, noteMeta: NoteMeta, chunk: Chunk): PassageMeta {
  const rule = ruleFor(note);
  return {
    sourceType: typeof rule.sourceType === "function" ? rule.sourceType(chunk) : rule.sourceType,
    parent: rule.parent,
    locator: locatorFor(note, noteMeta, chunk),
  };
}
