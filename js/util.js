// ============================================================================
// UTIL — helper tanggal & logika status
// ============================================================================
import { CAMPAIGN } from "./config.js";

const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// Format Date -> "YYYY-MM-DD" (pakai waktu lokal, bukan UTC).
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "YYYY-MM-DD" -> Date lokal (jam 00:00).
export function fromISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Tanggal hari ini (lokal) sebagai "YYYY-MM-DD".
export function hariIni() {
  return toISODate(new Date());
}

// Nama hari Indonesia dari "YYYY-MM-DD".
export function namaHari(iso) {
  return NAMA_HARI[fromISODate(iso).getDay()];
}

export function isWeekday(iso) {
  const g = fromISODate(iso).getDay();
  return g >= 1 && g <= 5; // Senin..Jumat
}

// Daftar semua hari kerja (Senin–Jumat) dari mulai s/d batas (inklusif).
// batasISO default = hari ini; tak pernah melewati CAMPAIGN.selesai.
export function hariKerjaSampai(batasISO = hariIni()) {
  const mulai = fromISODate(CAMPAIGN.mulai);
  const selesai = fromISODate(CAMPAIGN.selesai);
  let batas = fromISODate(batasISO);
  if (batas > selesai) batas = selesai;

  const out = [];
  for (let d = new Date(mulai); d <= batas; d.setDate(d.getDate() + 1)) {
    const g = d.getDay();
    if (g >= 1 && g <= 5) out.push(toISODate(d));
  }
  return out;
}

// Logika "Status Isi (otomatis)" untuk satu baris.
// row = data laporan (atau null/undefined bila belum ada dokumen).
export function statusIsi(row) {
  if (!row) return "Tidak Dilaporkan";
  const rencana = (row.rencana || "").trim();
  const realisasi = (row.realisasi || "").trim();
  if (!rencana && !realisasi) return "Tidak Dilaporkan";
  if (!rencana) return "Rencana Kosong";
  if (!realisasi) return "Belum Lengkap";
  return "Lengkap";
}

// Escape teks agar aman dimasukkan ke innerHTML.
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Ubah URL polos menjadi tautan yang aman (target _blank).
export function linkify(s) {
  const t = (s || "").trim();
  if (!t) return "";
  const isUrl = /^https?:\/\//i.test(t);
  if (isUrl) {
    return `<a href="${esc(t)}" target="_blank" rel="noopener noreferrer">buka ↗</a>`;
  }
  return esc(t);
}
