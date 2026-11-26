import type { FailureCode } from "../providers/index.ts";
import type { Route } from "./routes.ts";

/**
 * Every user-facing string the engine produces, in one file. Indonesian, "Anda". WITHHELD and EXCEPTION_WITHHELD are verbatim
 * from the decision log (D10d, D10f). The rest are written here because the log has no copy for them.
 */
export const WITHHELD = "Jawaban ini belum lolos pemeriksaan sumber, jadi tidak kami tampilkan. Silakan coba lagi.";

export const EXCEPTION_WITHHELD = "Ada satu pengecualian yang belum lolos pemeriksaan sumber. Lihat naskah terkait sebelum mengamalkan.";

export const RESTART = "Memeriksa ulang sumber…";

/** The line under RESTART on the screen, so the engine and the UI say the same thing about why. */
export const RESTART_WHY = "Ada bagian jawaban yang belum cocok dengan naskah sumbernya, jadi kami susun ulang.";

export function modelName(id: string): string {
  const family = /opus|sonnet|haiku/i.exec(id)?.[0];
  return family === undefined ? id : `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()}`;
}

export const fallbackNotice = (route: Route, from: string): string => `Dijawab oleh ${modelName(route.model)} karena batas ${modelName(from)} tercapai.`;

export const FAILURE_COPY: Readonly<Record<FailureCode, string>> = {
  not_signed_in: "Claude Code belum tersambung. Masuk dulu dengan perintah `claude auth login`, lalu coba lagi.",
  rate_limited: "Batas pemakaian Claude Anda sudah tercapai. Coba lagi setelah batas diperbarui.",
  blocked: "Permintaan ini ditahan oleh pengaman penyedia model. Coba tulis ulang pertanyaan Anda.",
  overloaded: "Layanan model sedang padat. Silakan coba lagi sebentar lagi.",
  model_unavailable: "Model yang dipilih tidak tersedia untuk akun Anda. Pilih model lain.",
  boot_timeout: "Penyedia model belum siap. Silakan coba lagi.",
  crashed: "Penyedia model berhenti di tengah jalan. Silakan coba lagi.",
  aborted: "Dibatalkan.",
  unknown: "Terjadi gangguan yang belum dikenali. Silakan coba lagi.",
};
