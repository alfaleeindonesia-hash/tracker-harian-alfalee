// ============================================================================
// KONFIGURASI — Tracker Harian Alfalee × MHG
// ============================================================================
// File ini aman berada di repo publik. Keamanan asli ada di firestore.rules.
// ----------------------------------------------------------------------------

// --- 1. Firebase config (TEMPEL punyamu dari console Firebase di sini) ------
// Ganti seluruh objek di bawah dengan blok firebaseConfig milikmu.
export const firebaseConfig = {
  apiKey: "AIzaSyCXjIQKRfsx1YvFLjsPxCDsz5QIkib-b-Q",
  authDomain: "tracker-harian-alfalee.firebaseapp.com",
  projectId: "tracker-harian-alfalee",
  storageBucket: "tracker-harian-alfalee.firebasestorage.app",
  messagingSenderId: "688098864646",
  appId: "1:688098864646:web:9ca3d111c21786a50ddd87",
};

// --- 2. Tanggal campaign ----------------------------------------------------
// Hari kerja (Senin–Jumat) dihitung dari tanggal mulai s/d tanggal selesai.
export const CAMPAIGN = {
  mulai: "2026-07-28", // Selasa
  selesai: "2026-10-30", // Jumat
};

// --- 3. Roster tim ----------------------------------------------------------
// key = kode PENGISI (verbatim, huruf besar). Dipakai sebagai id di database.
export const ROSTER = {
  DAFFA: { nama: "Daffa", peran: "Coach / In-house" },
  ALI: { nama: "Ali", peran: "Pengarah Sistem (Alfalee)" },
  HANIF: { nama: "Hanif", peran: "HR / OD" },
  KIKY: { nama: "Kiky", peran: "CRM & Community Manager" },
  SYIFA: { nama: "Syifa", peran: "Sales" },
  ABDAN: { nama: "Abdan", peran: "Project Manager" },
};

// Urutan tampil di dashboard & dropdown pengisi.
export const URUTAN_PENGISI = ["DAFFA", "ALI", "HANIF", "KIKY", "SYIFA", "ABDAN"];

// --- 4. Allowlist: siapa boleh login + petakan email -> kode pengisi --------
// Email HARUS huruf kecil. Yang belum ada tinggal ditambah satu baris.
export const ALLOWLIST = {
  "derkaizerz@gmail.com": "ABDAN",
  "muhammadsyarifaliakbarsyah@gmail.com": "ALI",
  "alfaleeindonesia@gmail.com": "KIKY",
  "hanifrexx@gmail.com": "HANIF",
  // "emaildaffa@gmail.com": "DAFFA",   // menyusul
  // "emailsyifa@gmail.com": "SYIFA",   // menyusul
};

// --- 5. Admin: bisa isi & edit tab semua orang ------------------------------
export const ADMIN_EMAILS = ["alfaleeindonesia@gmail.com"];

// --- 6. Vokabulari dropdown (VERBATIM dari Google Sheet — jangan diubah) -----
export const DROPDOWN = {
  terkait: [
    "Campaign",
    "Storyboard/Konten",
    "TGNC",
    "Community & CRM",
    "Sales & Follow-up",
    "Event/#MHGNgopi",
    "Sistem & SOP",
    "Koordinasi Klien",
    "Lainnya",
  ],
  status: [
    "Selesai",
    "Sebagian",
    "Masih Berjalan",
    "Tidak Jalan",
    "Belum Dapat Dinilai",
  ],
  jenisKendala: [
    "Nunggu Approval",
    "Nunggu Orang Lain",
    "Arahan Tidak Jelas",
    "Alat & Fasilitas",
    "Skill/Kapasitas",
    "Beban Bentrok",
    "Eksternal",
    "Pribadi",
    "Tidak Ada",
  ],
  nungguSiapa: [
    "MHG",
    "Ali",
    "Daffa",
    "Hanif",
    "Kiky",
    "Syifa",
    "Abdan",
    "Awi",
    "Rafa",
    "Mike",
    "Tim Media INH",
    "Pihak Eksternal",
    "Tidak Ada",
  ],
};

// Ambang kepatuhan (flag merah bila di bawah ini).
export const AMBANG_KEPATUHAN = 80; // persen
