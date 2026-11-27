import type { NoteId } from "../features/corpus/index.ts";
import type { Passage, PassageId } from "../features/search/index.ts";
import { ARABIC, TEXT_ONE, TEXT_TWO, makePassage } from "./answer-fixtures.ts";

/**
 * A fictional long putusan for the reader: 26 passages in seven bagian, one with a sub-heading, Arabic inline and on its own line,
 * and the three passages the scripted answer cites (TEXT_ONE, TEXT_TWO and the third scenario passage) deep inside it. And a small
 * pair of notes, the older one partly replaced by the newer, for the revision view. Nothing here is corpus text.
 */
export const READER_NOTE: NoteId = "putusan/uji-pembaca";
export const READER_TITLE = "Putusan Uji tentang Pengolahan Kompos";

const SENTENCES = [
  "Tumpukan diletakkan di tempat yang teduh dan tidak tergenang air.",
  "Suhu tumpukan diperiksa dengan tangan setiap pagi, dan bila terlalu panas tumpukan dibalik.",
  "Air disiramkan secukupnya sampai bahan terasa lembap seperti spons yang diperas.",
  "Bahan yang keras dipotong kecil-kecil agar cepat melapuk.",
  "Wadah dan alat dicuci bersih sebelum dan sesudah dipakai.",
  "Hasilnya dipakai untuk kebun sendiri atau dibagikan kepada tetangga tanpa dipungut bayaran.",
  "Petani yang baru belajar dianjurkan memulai dari tumpukan kecil.",
  "Bau yang menyengat menandakan tumpukan kurang udara dan perlu dibalik.",
  "Kompos yang matang berwarna gelap, gembur, dan tidak berbau busuk.",
  "Catatan tanggal pembuatan membantu menentukan kapan kompos siap dipakai.",
];

const filler = (n: number): string => [SENTENCES[n % 10], SENTENCES[(n * 3 + 1) % 10], SENTENCES[(n * 7 + 2) % 10]].join(" ");

const DALIL = `Contoh dalil yang dipakai dalam putusan uji ini:\n${ARABIC}\n“Penulis itu menulis kitab itu.”`;
const S3_TEXT = "Daun kering juga dapat dibakar, tetapi pembakaran di ruang terbuka dilarang di banyak daerah.";

type Bagian = { readonly title: string; readonly sub?: string; readonly count: number };

const LAYOUT: readonly Bagian[] = [
  { title: "Pengertian kompos", count: 2 },
  { title: "Bahan dan alat", count: 4 },
  { title: "Cara membuat kompos", sub: "Tahap awal", count: 4 },
  { title: "Cara membuat kompos", sub: "Perawatan", count: 4 },
  { title: "Pematangan", count: 4 },
  { title: "Pemakaian di kebun", count: 4 },
  { title: "Hal yang dilarang", count: 2 },
  { title: "Penutup", count: 2 },
];

/** Ordinals of the passages the scripted answer cites, in S1, S2, S3 order. */
export const READER_CITED = { S1: 8, S2: 17, S3: 23 } as const;

const TEXTS: Readonly<Record<number, string>> = { [READER_CITED.S1]: TEXT_ONE, [READER_CITED.S2]: TEXT_TWO, 18: DALIL, [READER_CITED.S3]: S3_TEXT };

function note(noteId: NoteId, title: string, year: number, build: (ordinal: number) => Partial<Passage>, entries: readonly { section: string | null; text: string }[]): Passage[] {
  return entries.map((entry, index) => {
    const ordinal = index + 1;
    return makePassage(ordinal, entry.text, { id: `${noteId}#${ordinal}` as PassageId, noteId, title, section: entry.section, sourceType: "putusan", number: "7", year, publishedIn: "Munas Uji XXX", ...build(ordinal) });
  });
}

const SECTIONS = LAYOUT.flatMap((bagian) => Array.from({ length: bagian.count }, () => (bagian.sub === undefined ? bagian.title : `${bagian.title} › ${bagian.sub}`)));

export const READER_PASSAGES: readonly Passage[] = note(READER_NOTE, READER_TITLE, 2018, () => ({}), SECTIONS.map((section, index) => ({ section, text: TEXTS[index + 1] ?? filler(index + 1) })));

/** The scenario's retrieval order: the three cited passages first (so they are S1, S2 and S3), then the rest of the note. */
export const READER_ORDER: readonly Passage[] = [
  ...Object.values(READER_CITED).map((ordinal) => READER_PASSAGES[ordinal - 1] as Passage),
  ...READER_PASSAGES.filter((passage) => !(Object.values(READER_CITED) as number[]).includes(passage.ordinal)),
];

export const OLD_NOTE: NoteId = "putusan/uji-istihadah-lama";
export const NEW_NOTE: NoteId = "putusan/uji-istihadah-baru";
const NEWER = (ordinal: number): PassageId => `${NEW_NOTE}#${ordinal}` as PassageId;

/** Passages 4 to 6 of the older note were replaced by the first three of the newer one. The first three are still in force and cited. */
export const REVISED_OLD: readonly Passage[] = note(
  OLD_NOTE,
  "Putusan Uji tentang Istihadah",
  2000,
  (ordinal) => (ordinal >= 4 ? { supersededBy: NEWER(ordinal - 3) } : {}),
  [
    { section: "Pengertian dan hukum", text: TEXT_ONE },
    { section: "Pengertian dan hukum", text: TEXT_TWO },
    { section: "Pengertian dan hukum", text: S3_TEXT },
    { section: "Batas waktu", text: "Darah yang keluar lebih dari batas yang ditentukan dihukumi sebagai darah penyakit seluruhnya." },
    { section: "Batas waktu", text: "Perempuan yang belum memiliki kebiasaan menghitung hari menurut sifat darah yang keluar." },
    { section: "Batas waktu", text: "Perhitungan di atas berlaku untuk setiap bulan tanpa pengecualian." },
  ],
);

export const REVISED_NEW: readonly Passage[] = note(
  NEW_NOTE,
  "Putusan Uji tentang Istihadah (Perubahan)",
  2018,
  (ordinal) => (ordinal <= 3 ? { supersedes: `${OLD_NOTE}#${ordinal + 3}` as PassageId } : {}),
  [
    { section: "Batas waktu", text: "Darah yang keluar lebih dari lima belas hari dihukumi sebagai darah penyakit, dan haidnya dihitung menurut kebiasaannya." },
    { section: "Batas waktu", text: "Perempuan yang belum memiliki kebiasaan menghitung haid enam atau tujuh hari setiap bulan." },
    { section: "Batas waktu", text: "Perhitungan ini ditinjau kembali pada setiap Munas berikutnya." },
    { section: "Penutup", text: "Putusan ini berlaku sejak ditetapkan." },
  ],
);

export const REVISED_ORDER: readonly Passage[] = [...REVISED_OLD, ...REVISED_NEW];

/**
 * A fictional Tanya Jawab note, written the way the collection's Tanya Jawab pages are laid out: a numbered question with its title
 * on the same line, the asker in brackets, "Jawab:" in the middle of a line, lettered items, numbered points, a hadith lead-in, the
 * Arabic on a line of its own, "Artinya:" and a narrator. Nothing here is corpus text.
 */
export const TJ_NOTE: NoteId = "putusan/tja-uji-2";
export const TJ_TITLE = "Tanya Jawab Agama Uji 2";

const TJ_ARABIC_ONE = "كَتَبَ الْكَاتِبُ الْكِتَابَ فِي الْمَسْجِدِ بَعْدَ صَلَاةِ الْعَصْرِ";
const TJ_ARABIC_TWO = "جَلَسَ الطُّلَّابُ فِي الْفَصْلِ وَقَرَؤُوا الدَّرْسَ بِهُدُوءٍ";

export const TJ_QUOTE_ONE = "cukup menghadap kiblat ketika takbiratul ihram bila mudah dilakukan";
export const TJ_QUOTE_TWO = "boleh dikerjakan sambil duduk bila tidak mungkin berdiri";

const TJ_TEXTS: readonly string[] = [
  [
    "3. Shalat sunnah di kendaraan Tanya: Saya sering bepergian dengan bus antarkota pada malam hari. Bolehkah shalat sunnah dikerjakan sambil duduk di kursi bus, dan bagaimana arah kiblatnya? Mohon penjelasan. (Nur Hidayah, Kab. Banyumas) Jawab: Ada dua hal yang Anda tanyakan, yakni:",
    "a. Hukum shalat sunnah di atas kendaraan.",
    "b. Arah kiblat selama kendaraan berjalan.",
    "1. Shalat sunnah boleh dikerjakan sambil duduk di kendaraan. Rukuk dan sujud cukup dengan isyarat, dan isyarat sujud dibuat lebih rendah daripada isyarat rukuk. Dasarnya antara lain:",
    "a. Hadis riwayat Perawi Uji 1:",
    TJ_ARABIC_ONE,
    "Artinya: “Penulis menulis kitab itu di masjid setelah shalat Ashar.” (HR. Perawi Uji 1)",
    "b. Hadis riwayat Perawi Uji 2 pula: Artinya: “Para pelajar duduk di kelas dan membaca pelajaran dengan tenang.” (HR. Perawi Uji 2)",
    `2. Mengenai arah kiblat, ${TJ_QUOTE_ONE}, lalu shalat diteruskan mengikuti arah kendaraan sampai salam. Shalat fardu tetap dikerjakan dengan turun dari kendaraan bila waktunya memungkinkan.`,
    "Wallahu a'lam bish-shawab.",
  ].join("\n"),
  [
    `1. Shalat di kapal laut Tanya: Saya sering menyeberang dengan kapal feri selama tiga jam. Bolehkah shalat Zuhur dikerjakan di atas kapal bila tidak ada tempat untuk berdiri? (Siti Aminah, Kab. Cilacap) Jawab: Shalat di atas kapal ${TJ_QUOTE_TWO}, dan menghadap kiblat sedapat mungkin. Dasarnya hadis riwayat Perawi Uji 3:`,
    TJ_ARABIC_TWO,
    "Artinya: “Nabi shalat di atas perahu sambil duduk karena tidak mampu berdiri.” (HR. Perawi Uji 3)",
    "2. Jamak karena hujan Tanya: Apakah shalat Magrib dan Isya boleh dijamak di masjid ketika hujan deras? (Ahmad Fauzi, Kota Bandung) Jawab: Boleh, bila hujan itu menyulitkan jamaah untuk datang ke masjid pada waktu Isya.",
  ].join("\n"),
  [
    "4. Qashar bagi sopir",
    "Tanya:",
    "Apakah sopir truk lintas provinsi boleh mengqashar shalat selama perjalanan? Bila boleh, sampai berapa lama?",
    "(Hendra, Jl. Melati 12, Kota Surabaya)",
    "Jawab:",
    "Sopir yang menempuh perjalanan jauh boleh mengqashar shalat selama ia masih dalam perjalanan.",
  ].join("\n"),
];

export const TJ_PASSAGES: readonly Passage[] = TJ_TEXTS.map((text, index) =>
  makePassage(index + 1, text, { id: `${TJ_NOTE}#${index + 1}` as PassageId, noteId: TJ_NOTE, title: TJ_TITLE, section: "Bab Shalat", sourceType: "tanya_jawab", number: "2", year: 2019, publishedIn: "Suara Uji" }),
);
