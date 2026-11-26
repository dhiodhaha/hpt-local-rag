import { hardWrapped, sentences, type FixtureNote } from "./helpers.ts";

const PUPUK = "Pupuk organik dari kompos dibuat dengan menumpuk sisa daun dan jerami lalu membaliknya tiap minggu sampai matang.";
const FATWA_TWIN = `${PUPUK} ${sentences(1, 60)}`;

const TOC_BOOK = [
  "BUKU CONTOH  ",
  "BUKU CONTOH .......................... 1  ",
  "BAGIAN UMUM ........................... 2  ",
  "KEPUTUSAN TENTANG LUMBUNG (HALAMAN 12).. 5  ",
  "",
  "BUKU CONTOH  ",
  "BAGIAN UMUM  ",
  hardWrapped(sentences(2, 160), 5),
  "KEPUTUSAN TENTANG LUMBUNG (HALAMAN 12)  ",
  `Menimbang: ${sentences(6, 40)}`,
  "Memutuskan :  ",
  `1. ${sentences(3, 110)}`,
].join("\n");

export const notes: FixtureNote[] = [
  { id: "putusan/fatwa-05-a-2003-pupuk-organik-sm-no-12-13-2003", title: "Fatwa 05 A 2003 Pupuk Organik", folder: "Fatwa 2003", year: 2003, body: FATWA_TWIN, backlink: "sources/fatwa-05-a-2003-pupuk-organik-sm-no-12-13-2003" },
  { id: "putusan/fatwa-06-2003-pupuk-organik-salinan", title: "Fatwa 06 2003 Pupuk Organik Salinan", folder: "Fatwa 2003", year: 2003, body: FATWA_TWIN },
  { id: "putusan/tja-1-masalah-perahu", title: "Tanya Jawab Agama 1 Masalah Perahu", folder: "TJA 1", body: `Nelayan memperbaiki perahu dan jaring sebelum melaut. ${sentences(4, 80)}` },
  { id: "putusan/hpt-jilid-1-kitab-gudang", title: "HPT Jilid 1 Kitab Gudang", folder: "HPT 1", body: `${hardWrapped(sentences(5, 600), 6)}\nlumbungku penuh` },
  { id: "putusan/fikih-contoh-bagian-a", title: "Fikih Contoh Bagian A", folder: "Fikih Muhammadiyah", body: TOC_BOOK },
  { id: "sources/fatwa-05-a-2003-pupuk-organik-sm-no-12-13-2003", title: "Fatwa 05 A 2003 Pupuk Organik", body: "## Summary\n\nNaskah lengkap sudah disalin ke [[putusan/fatwa-05-a-2003-pupuk-organik-sm-no-12-13-2003|Fatwa 05 A]]." },
  { id: "sources/fatwa-06-2003-pupuk-organik-salinan", title: "Fatwa 06 2003 Pupuk Organik Salinan", body: "## Summary\n\nNaskah lengkap di [[putusan/fatwa-06-2003-pupuk-organik-salinan|Salinan]]." },
  { id: "sources/tja-1-masalah-perahu", title: "Tanya Jawab Agama 1 Masalah Perahu", body: "## Summary\n\nNaskah lengkap di [[putusan/tja-1-masalah-perahu|TJA]]." },
  { id: "sources/hpt-jilid-1-kitab-gudang", title: "HPT Jilid 1 Kitab Gudang", body: "## Summary\n\nNaskah lengkap di [[putusan/hpt-jilid-1-kitab-gudang|HPT]]." },
  { id: "sources/fikih-contoh-bagian-a", title: "Fikih Contoh Bagian A", body: "## Summary\n\nNaskah lengkap di [[putusan/fikih-contoh-bagian-a|Fikih]]." },
  { id: "concepts/pengomposan", title: "Pengomposan", body: "## Definisi\n\nPengomposan limbah tani menjadi tanah subur.\n\n## Dalam Tarjih\n\nDibahas di [[sources/fatwa-05-a-2003-pupuk-organik-sm-no-12-13-2003|Fatwa 05 A]]." },
  { id: "entities/petani-contoh", title: "Petani Contoh", body: "## Profil\n\nSeorang petani yang bertanya." },
  { id: "quran/001-contoh", title: "Contoh (1)", body: "## Ayat yang Dirujuk\n\nTidak ada." },
];
