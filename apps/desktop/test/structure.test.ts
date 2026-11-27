import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARABIC, TJ_PASSAGES } from "@hpt/server/testing";
import { segmentsOf, structureOf, type Kind, type Segment } from "../src/renderer/reader/structure.ts";

const words = (text: string, part: Segment) => text.slice(part.start, part.end);
const kinds = (text: string): Kind[] => segmentsOf(text).map((part) => part.kind);
const shown = (text: string) => segmentsOf(text).map((part) => [part.kind, words(text, part)]);
const squash = (text: string) => text.replace(/\s+/g, "");

describe("a Tanya Jawab page", () => {
  const ONE_LINE = "5. Shalat di kapal Tanya: Bolehkah shalat di atas kapal? (Siti Aminah, Kab. Cilacap) Jawab: Boleh, bila tidak mungkin berdiri.";

  it("cuts a numbered question into its title, the question, the asker and the answer", () => {
    assert.deepEqual(shown(ONE_LINE), [
      ["title", "5. Shalat di kapal"],
      ["question", "Tanya: Bolehkah shalat di atas kapal?"],
      ["signature", "(Siti Aminah, Kab. Cilacap)"],
      ["answer", "Jawab: Boleh, bila tidak mungkin berdiri."],
    ]);
  });

  it("gives the title its number and the question and the answer their head, so they can be drawn as run-in heads", () => {
    const parts = segmentsOf(ONE_LINE);
    assert.deepEqual(parts.map((part) => ONE_LINE.slice(part.start, part.start + part.head)), ["5.", "Tanya:", "", "Jawab:"]);
  });

  it("reads Tanya and Jawab on lines of their own, with the asker on a line of its own", () => {
    const text = "Tanya:\nApakah boleh?\n(Hendra, Kota Surabaya)\nJawab:\nBoleh.";
    assert.deepEqual(shown(text), [
      ["question", "Tanya:"],
      ["plain", "Apakah boleh?"],
      ["signature", "(Hendra, Kota Surabaya)"],
      ["answer", "Jawab:"],
      ["plain", "Boleh."],
    ]);
  });

  it("takes only a last bracket with a comma, Kab., Kota or a digit for the asker", () => {
    assert.deepEqual(kinds("Tanya: Apakah ini boleh (menurut HPT)? Jawab: Boleh."), ["question", "answer"]);
    assert.deepEqual(kinds("Tanya: Apakah ini boleh? (Pak Budi, Jl. Mawar) Jawab: Boleh."), ["question", "signature", "answer"]);
    assert.deepEqual(kinds("Tanya: Apakah ini boleh? (Pak Budi 2) Jawab: Boleh."), ["question", "signature", "answer"]);
    assert.deepEqual(kinds("Tanya: Apakah ini boleh? (Pak Budi) Jawab: Boleh."), ["question", "answer"]);
  });

  it("finds the asker at the end of a question that opens with a number", () => {
    const text = "6. Mana yang lebih baik Tanya: Siapa yang lebih baik pergi?\n1. Wanita yang sudah lanjut; 2. Anak-anak. (Tjik Den, Kp. Masjid, Baturaja). Jawab: Lebih baik pergi.";
    assert.deepEqual(shown(text).slice(2), [
      ["point", "1. Wanita yang sudah lanjut; 2. Anak-anak."],
      ["signature", "(Tjik Den, Kp. Masjid, Baturaja)."],
      ["answer", "Jawab: Lebih baik pergi."],
    ]);
  });

  it("does not take a bracket in the middle of the question for the asker", () => {
    assert.deepEqual(kinds("Tanya: Apakah (lihat HPT, hal. 5) boleh dilakukan? Jawab: Boleh."), ["question", "answer"]);
  });

  it("starts the answer at the first Jawab: only while a question is open", () => {
    assert.deepEqual(kinds("Penjelasan umum. Jawab: bukan jawaban."), ["plain"]);
    assert.deepEqual(kinds("1. Judul Tanya: Apakah? Jawab: Ya. Jawab: Sekali lagi."), ["title", "question", "answer"]);
  });

  it("keeps a question that spans several lines open until its Jawab:", () => {
    const text = "Tanya: Baris satu.\nBaris dua? Jawab: Jawaban.";
    assert.deepEqual(shown(text), [
      ["question", "Tanya: Baris satu."],
      ["plain", "Baris dua?"],
      ["answer", "Jawab: Jawaban."],
    ]);
  });

  it("reads one passage that holds several questions", () => {
    const text = "1. Satu Tanya: A? (Ani, Kab. X) Jawab: B.\n2. Dua Tanya: C? (Budi, Kota Y) Jawab: D.";
    assert.deepEqual(kinds(text), ["title", "question", "signature", "answer", "title", "question", "signature", "answer"]);
  });
});

describe("points and items", () => {
  it("reads a numbered point and a lettered item", () => {
    assert.deepEqual(kinds("1. Pertama.\na. Hurufnya."), ["point", "item"]);
  });

  it("puts a lettered item one step in under the nearest numbered point above it, and one step less before any", () => {
    const text = "Jawab: Ada dua hal:\na. Satu.\nb. Dua.\n1. Poin.\na. Di bawah poin.\n2. Poin lain.\nb. Masih di bawahnya.";
    const parts = segmentsOf(text);
    assert.deepEqual(parts.filter((part) => part.kind === "item").map((part) => part.depth), [1, 1, 2, 2]);
  });

  it("forgets the point when a new question begins", () => {
    const text = "1. Poin.\n2. Judul Tanya: A? Jawab: B.\na. Butir.";
    assert.equal(segmentsOf(text).at(-1)?.depth, 1);
  });

  it("leaves a lettered mark that is not a single letter and a number longer than two digits as plain text", () => {
    assert.deepEqual(kinds("dst. Seterusnya.\n2014. Tahun."), ["plain", "plain"]);
  });
});

describe("a hadith", () => {
  it("reads the lead-in, the matn, the translation and the narrator", () => {
    const text = `a. Hadis riwayat Perawi Uji 1:\n${ARABIC}\nArtinya: “Penulis menulis kitab.” (HR. Perawi Uji 1)`;
    assert.deepEqual(kinds(text), ["item", "matn", "translation", "narrator"]);
    assert.equal(segmentsOf(text)[0]?.leadIn, true);
    assert.equal(segmentsOf(text)[2]?.leadIn, false);
  });

  it("starts a translation inline after a lead-in", () => {
    const text = "b. Hadis riwayat Perawi Uji 2 pula: Artinya: “Para pelajar duduk.” (HR. Perawi Uji 2)";
    assert.deepEqual(shown(text), [
      ["item", "b. Hadis riwayat Perawi Uji 2 pula:"],
      ["translation", "Artinya: “Para pelajar duduk.”"],
      ["narrator", "(HR. Perawi Uji 2)"],
    ]);
    assert.equal(segmentsOf(text)[0]?.leadIn, true);
  });

  it("takes both kinds of bracket for the narrator, and only at the end of a translation", () => {
    assert.deepEqual(kinds("Artinya: “Satu.” [HR Abu Dawud 1609]."), ["translation", "narrator"]);
    assert.deepEqual(kinds("Artinya: “Satu.” (HR. Muslim) lalu penjelasan lain."), ["translation"]);
    assert.deepEqual(kinds("Penjelasan biasa (HR. Muslim)"), ["plain"]);
  });

  it("calls a quoted line right after the matn its translation, even without Artinya", () => {
    assert.deepEqual(kinds(`${ARABIC}\n“Penulis menulis kitab.” [HR. Muslim]`), ["matn", "translation", "narrator"]);
    assert.deepEqual(kinds(`${ARABIC}\nKalimat biasa.`), ["matn", "plain"]);
  });

  it("draws a line that is mostly Arabic as the matn, and Arabic inside a line as a run", () => {
    assert.deepEqual(kinds(`Contoh ${ARABIC} dalam kalimat.\n${ARABIC}`), ["plain", "matn"]);
  });
});

describe("what the reading never does", () => {
  const SAMPLES = [
    "",
    "   \n\n",
    "Teks biasa saja tanpa tanda apa pun.",
    "5. Shalat di kapal Tanya: Bolehkah? (Siti Aminah, Kab. Cilacap) Jawab: Boleh.\n6. Judul lain Tanya: Apakah? Jawab: Ya.",
    `Jawab: Ada dua hal:\na. Satu.\n1. Poin:\na. Hadis riwayat X:\n${ARABIC}\nArtinya: “Terjemah.” (HR. X)\nb. Hadits riwayat Y pula: Artinya: “Lagi.” (HR. Y)\nWallahu a'lam.`,
    "Tanya: ??? Jawab: !!! Jawab: ... Artinya: Artinya: (HR. (HR. x))",
    ...TJ_PASSAGES.map((passage) => passage.text),
  ];

  it("drops no character and moves none: the parts read in order give every non-blank character back", () => {
    for (const text of SAMPLES) {
      const joined = segmentsOf(text).map((part) => words(text, part)).join("");
      assert.equal(squash(joined), squash(text), JSON.stringify(text));
    }
  });

  it("keeps the parts in order and apart", () => {
    for (const text of SAMPLES) {
      const parts = segmentsOf(text);
      parts.forEach((part, index) => {
        assert.ok(part.start < part.end, "no empty part");
        assert.ok(part.head >= 0 && part.start + part.head <= part.end);
        const next = parts[index + 1];
        if (next !== undefined) assert.ok(part.end <= next.start, "parts do not overlap");
      });
    }
  });

  it("is the same whatever the answer quoted: the excerpts only cut the pieces, never the parts", () => {
    const text = TJ_PASSAGES[0]?.text ?? "";
    const plain = structureOf(text, []);
    const start = text.indexOf("cukup menghadap");
    const quoted = structureOf(text, [{ start, end: start + 30 }]);
    assert.deepEqual(quoted.map((part) => part.kind), plain.map((part) => part.kind));
    assert.equal(quoted.flatMap((part) => part.pieces).filter((piece) => piece.quoted).map((piece) => piece.text).join(""), text.slice(start, start + 30));
    assert.equal(quoted.flatMap((part) => [...part.head, ...part.pieces]).map((piece) => piece.text).join("").replace(/\s+/g, ""), squash(text));
  });

  it("reads the fictional Tanya Jawab note the way it was written", () => {
    const [first, second, third] = TJ_PASSAGES.map((passage) => kinds(passage.text));
    assert.deepEqual(first?.slice(0, 5), ["title", "question", "signature", "answer", "item"]);
    assert.ok(first?.includes("matn") && first.includes("translation") && first.includes("narrator"));
    assert.deepEqual(second?.slice(0, 4), ["title", "question", "signature", "answer"]);
    assert.deepEqual(third, ["point", "question", "plain", "signature", "answer", "plain"]);
  });
});
