# Tracker Harian — Alfalee × MHG

Aplikasi web pengganti Google Sheet "Laporan Harian Tim". Login Gmail (SSO),
form input harian per orang, dan dashboard kepatuhan & bottleneck real-time.

- **Frontend:** statis (HTML/CSS/JS) — dihosting di **GitHub Pages**.
- **Login:** Firebase Authentication (Google).
- **Database:** Cloud Firestore.
- **Keamanan:** hanya email di allowlist yang bisa masuk; tiap orang hanya bisa
  mengisi tabnya sendiri; admin bisa semua.

---

## 🔧 Setup (sekali saja)

### 1. Firebase
1. Buat project di <https://console.firebase.google.com>.
2. **Authentication → Sign-in method → Google → Enable.**
3. **Firestore Database → Create database** (production mode, lokasi `asia-southeast2`).
4. **Project settings → Your apps → Web `</>`** → daftar app → salin blok `firebaseConfig`.

### 2. Tempel config
Buka [`js/config.js`](js/config.js) dan ganti objek `firebaseConfig` dengan milikmu.

### 3. Pasang aturan keamanan
Salin isi [`firestore.rules`](firestore.rules) ke **Firestore → tab Rules → Publish**.

### 4. Authorized domain
**Authentication → Settings → Authorized domains → Add domain** →
masukkan `USERNAME.github.io` (ganti `USERNAME` dengan username GitHub-mu).
> `localhost` sudah otomatis diizinkan untuk uji coba lokal.

---

## 🚀 Deploy ke GitHub Pages

1. Buat repo **publik** bernama `tracker-harian-alfalee`.
2. Upload semua file di folder ini ke repo (root).
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch →
   Branch: `main` / `(root)` → Save.**
4. Tunggu ±1 menit. Situs terbit di:
   `https://USERNAME.github.io/tracker-harian-alfalee/`

Via command line:

```bash
cd tracker-harian-alfalee
git init
git add .
git commit -m "Tracker harian Alfalee x MHG"
git branch -M main
git remote add origin https://github.com/USERNAME/tracker-harian-alfalee.git
git push -u origin main
```

---

## 👥 Menambah / mengubah anggota

Anggota baru (mis. Daffa, Syifa) perlu ditambahkan di **dua** tempat, lalu deploy ulang:

1. [`js/config.js`](js/config.js) → objek `ALLOWLIST` (email → kode pengisi).
2. [`firestore.rules`](firestore.rules) → fungsi `allowlist()` (baris yang sama) → **Publish** ulang di Firebase.

Contoh:
```js
// js/config.js
"emaildaffa@gmail.com": "DAFFA",
```
```
// firestore.rules
"emaildaffa@gmail.com": "DAFFA",
```

Admin diatur di `ADMIN_EMAILS` (config.js) dan `admins()` (rules).

---

## 🗂️ Struktur data (Firestore)

Koleksi **`laporan`**, id dokumen = `PENGISI__YYYY-MM-DD` (mis. `ALI__2026-07-28`).

| Field | Isi |
|---|---|
| `pengisi` | kode pengisi (DAFFA/ALI/…) |
| `tanggal` | `YYYY-MM-DD` |
| `hari` | nama hari (otomatis) |
| `rencana` | Rencana Hari Ini |
| `realisasi` | Realisasi s/d 21.00 |
| `output` | Output / Bukti (link) |
| `terkait` | dropdown Terkait |
| `status` | dropdown Status |
| `kendala` | Kendala |
| `jenisKendala` | dropdown Jenis Kendala |
| `nungguSiapa` | dropdown Nunggu Siapa |
| `rencanaBesok` | Rencana Besok |
| `updatedByEmail`, `updatedAt` | jejak audit (otomatis) |

`Hari` dan `Status Isi` dihitung otomatis dan tidak disimpan sebagai sumber kebenaran.

---

## 🧪 Uji coba lokal

Karena pakai modul ES, buka lewat server lokal (bukan `file://`):

```bash
cd tracker-harian-alfalee
python -m http.server 8000
```
Lalu buka <http://localhost:8000>.
