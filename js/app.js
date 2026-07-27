// ============================================================================
// APP — kontrol utama: login, form input, dashboard
// ============================================================================
import {
  auth, db, provider,
  signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, setDoc, onSnapshot, serverTimestamp,
} from "./firebase.js";
import {
  ROSTER, URUTAN_PENGISI, ALLOWLIST, ADMIN_EMAILS, DROPDOWN, AMBANG_KEPATUHAN,
} from "./config.js";
import {
  hariIni, namaHari, hariKerjaSampai, statusIsi, esc, linkify,
} from "./util.js";

const COLLECTION = "laporan";

// State sesi login
let sesi = { email: null, pengisi: null, isAdmin: false };
// Cache seluruh laporan (docId -> data), diperbarui real-time
let laporanCache = new Map();
let unsubLaporan = null;

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// AUTENTIKASI
// ---------------------------------------------------------------------------
function initAuth() {
  $("#btn-login").addEventListener("click", async () => {
    $("#login-error").textContent = "";
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      $("#login-error").textContent = "Gagal login: " + (e?.message || e);
    }
  });

  document.querySelectorAll(".btn-logout").forEach((b) =>
    b.addEventListener("click", () => signOut(auth))
  );

  onAuthStateChanged(auth, (user) => {
    if (!user) return showScreen("login");

    const email = (user.email || "").toLowerCase();
    const pengisi = ALLOWLIST[email];

    if (!pengisi) {
      $("#denied-email").textContent = email;
      return showScreen("denied");
    }

    sesi = { email, pengisi, isAdmin: ADMIN_EMAILS.includes(email) };
    onMasuk(user);
  });
}

function showScreen(name) {
  ["loading", "login", "denied", "app"].forEach((s) => {
    const el = $("#screen-" + s);
    if (el) el.hidden = s !== name;
  });
}

// ---------------------------------------------------------------------------
// SETELAH MASUK
// ---------------------------------------------------------------------------
function onMasuk(user) {
  $("#user-nama").textContent = ROSTER[sesi.pengisi]?.nama || sesi.pengisi;
  $("#user-email").textContent = sesi.email;
  $("#user-badge").textContent = sesi.isAdmin
    ? "Admin"
    : ROSTER[sesi.pengisi]?.peran || "";
  if (user.photoURL) {
    const img = $("#user-foto");
    img.src = user.photoURL;
    img.hidden = false;
  }

  buildFormStatis();
  setupNav();
  langgananLaporan(); // mulai dengarkan data real-time
  showScreen("app");
  gotoTab("form");
}

// ---------------------------------------------------------------------------
// NAVIGASI TAB
// ---------------------------------------------------------------------------
function setupNav() {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => gotoTab(b.dataset.tab))
  );
}
function gotoTab(tab) {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  $("#view-form").hidden = tab !== "form";
  $("#view-dashboard").hidden = tab !== "dashboard";
  if (tab === "form") muatFormUntukTanggal();
  if (tab === "dashboard") renderDashboard();
}

// ---------------------------------------------------------------------------
// FORM INPUT
// ---------------------------------------------------------------------------
function opsi(list, terpilih) {
  return (
    `<option value="">— pilih —</option>` +
    list
      .map(
        (v) =>
          `<option value="${esc(v)}"${v === terpilih ? " selected" : ""}>${esc(v)}</option>`
      )
      .join("")
  );
}

function buildFormStatis() {
  // Pilih pengisi (admin bisa memilih siapa saja)
  const wrapPengisi = $("#wrap-pengisi");
  if (sesi.isAdmin) {
    wrapPengisi.hidden = false;
    $("#f-pengisi").innerHTML = URUTAN_PENGISI.map(
      (k) => `<option value="${k}">${esc(ROSTER[k].nama)} — ${esc(ROSTER[k].peran)}</option>`
    ).join("");
    $("#f-pengisi").value = sesi.pengisi;
  } else {
    wrapPengisi.hidden = true;
  }

  // Dropdown vokabulari
  $("#f-terkait").innerHTML = opsi(DROPDOWN.terkait);
  $("#f-status").innerHTML = opsi(DROPDOWN.status);
  $("#f-jenisKendala").innerHTML = opsi(DROPDOWN.jenisKendala);
  $("#f-nungguSiapa").innerHTML = opsi(DROPDOWN.nungguSiapa);

  // Tanggal default hari ini
  const tgl = $("#f-tanggal");
  tgl.value = hariIni();

  // Listener
  tgl.addEventListener("change", muatFormUntukTanggal);
  $("#f-pengisi").addEventListener("change", muatFormUntukTanggal);
  ["#f-rencana", "#f-realisasi"].forEach((s) =>
    $(s).addEventListener("input", updateStatusIsiLive)
  );
  $("#form-laporan").addEventListener("submit", simpanLaporan);
}

function pengisiAktif() {
  return sesi.isAdmin ? $("#f-pengisi").value : sesi.pengisi;
}

function muatFormUntukTanggal() {
  const tanggal = $("#f-tanggal").value;
  const pengisi = pengisiAktif();
  if (!tanggal) return;

  $("#f-hari").textContent = namaHari(tanggal);
  const id = `${pengisi}__${tanggal}`;
  const data = laporanCache.get(id) || {};

  $("#f-rencana").value = data.rencana || "";
  $("#f-realisasi").value = data.realisasi || "";
  $("#f-output").value = data.output || "";
  $("#f-terkait").value = data.terkait || "";
  $("#f-status").value = data.status || "";
  $("#f-kendala").value = data.kendala || "";
  $("#f-jenisKendala").value = data.jenisKendala || "";
  $("#f-nungguSiapa").value = data.nungguSiapa || "";
  $("#f-rencanaBesok").value = data.rencanaBesok || "";

  $("#simpan-info").textContent = data.updatedAt
    ? "Terakhir disimpan oleh " + (data.updatedByEmail || "?")
    : "Belum ada isian untuk tanggal ini.";
  updateStatusIsiLive();
  renderRiwayat();
}

function bacaForm() {
  return {
    rencana: $("#f-rencana").value.trim(),
    realisasi: $("#f-realisasi").value.trim(),
    output: $("#f-output").value.trim(),
    terkait: $("#f-terkait").value,
    status: $("#f-status").value,
    kendala: $("#f-kendala").value.trim(),
    jenisKendala: $("#f-jenisKendala").value,
    nungguSiapa: $("#f-nungguSiapa").value,
    rencanaBesok: $("#f-rencanaBesok").value.trim(),
  };
}

function updateStatusIsiLive() {
  const s = statusIsi(bacaForm());
  const el = $("#f-statusisi");
  el.textContent = s;
  el.className = "pill " + kelasStatusIsi(s);
}

async function simpanLaporan(e) {
  e.preventDefault();
  const tanggal = $("#f-tanggal").value;
  const pengisi = pengisiAktif();
  if (!tanggal) return;

  const btn = $("#btn-simpan");
  btn.disabled = true;
  btn.textContent = "Menyimpan…";

  const payload = {
    ...bacaForm(),
    pengisi,
    tanggal,
    hari: namaHari(tanggal),
    updatedByEmail: sesi.email,
    updatedAt: serverTimestamp(),
  };

  try {
    const id = `${pengisi}__${tanggal}`;
    await setDoc(doc(collection(db, COLLECTION), id), payload, { merge: true });
    $("#simpan-info").textContent = "✓ Tersimpan " + new Date().toLocaleTimeString("id-ID");
  } catch (err) {
    $("#simpan-info").textContent = "Gagal menyimpan: " + (err?.message || err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan";
  }
}

// Riwayat isian orang aktif (10 terbaru)
function renderRiwayat() {
  const pengisi = pengisiAktif();
  const rows = [...laporanCache.values()]
    .filter((d) => d.pengisi === pengisi)
    .sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1))
    .slice(0, 10);

  const tbody = $("#riwayat-body");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Belum ada riwayat.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((d) => {
      const s = statusIsi(d);
      return `<tr>
        <td>${esc(d.tanggal)}</td>
        <td>${esc(d.hari || namaHari(d.tanggal))}</td>
        <td>${esc(d.terkait || "—")}</td>
        <td>${esc(d.status || "—")}</td>
        <td><span class="pill ${kelasStatusIsi(s)}">${esc(s)}</span></td>
      </tr>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// LANGGANAN DATA REAL-TIME
// ---------------------------------------------------------------------------
function langgananLaporan() {
  if (unsubLaporan) unsubLaporan();
  unsubLaporan = onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      laporanCache = new Map();
      snap.forEach((d) => laporanCache.set(d.id, d.data()));
      // segarkan tampilan aktif
      if (!$("#view-dashboard").hidden) renderDashboard();
      if (!$("#view-form").hidden) {
        renderRiwayat();
        const id = `${pengisiAktif()}__${$("#f-tanggal").value}`;
        // jangan timpa ketikan; hanya info
      }
    },
    (err) => {
      console.error(err);
      $("#dash-info").textContent = "Gagal memuat data: " + (err?.message || err);
    }
  );
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
function kelasStatusIsi(s) {
  return (
    {
      Lengkap: "ok",
      "Belum Lengkap": "warn",
      "Rencana Kosong": "warn",
      "Tidak Dilaporkan": "bad",
    }[s] || ""
  );
}

function renderDashboard() {
  const workdays = hariKerjaSampai();
  $("#dash-info").textContent = `Per ${hariIni()} • ${workdays.length} hari kerja • ${laporanCache.size} isian tercatat`;

  renderKepatuhan(workdays);
  renderHitung("nungguSiapa", "#tbl-nunggu", "Pihak");
  renderHitung("jenisKendala", "#tbl-jenis", "Jenis");
  renderHitung("status", "#tbl-status", "Status");
}

// Section 1: kepatuhan per orang
function renderKepatuhan(workdays) {
  const tbody = $("#tbl-kepatuhan tbody");
  const baris = URUTAN_PENGISI.map((pengisi) => {
    let lengkap = 0, belum = 0, kosong = 0, tidak = 0;
    for (const tgl of workdays) {
      const s = statusIsi(laporanCache.get(`${pengisi}__${tgl}`));
      if (s === "Lengkap") lengkap++;
      else if (s === "Belum Lengkap") belum++;
      else if (s === "Rencana Kosong") kosong++;
      else tidak++;
    }
    const total = workdays.length || 1;
    const persen = Math.round((lengkap / total) * 100);
    return { pengisi, lengkap, belum, kosong, tidak, persen };
  });

  tbody.innerHTML = baris
    .map((r) => {
      const flag = r.persen < AMBANG_KEPATUHAN ? `🚩` : `✓`;
      const barCls = r.persen < AMBANG_KEPATUHAN ? "bad" : r.persen < 95 ? "warn" : "ok";
      return `<tr>
        <td><strong>${esc(ROSTER[r.pengisi].nama)}</strong></td>
        <td class="num">${workdays.length}</td>
        <td class="num">${r.lengkap}</td>
        <td class="num">${r.belum}</td>
        <td class="num">${r.kosong}</td>
        <td class="num">${r.tidak}</td>
        <td>
          <div class="bar"><span class="bar-fill ${barCls}" style="width:${r.persen}%"></span></div>
          <span class="num">${r.persen}%</span>
        </td>
        <td class="center">${flag}</td>
      </tr>`;
    })
    .join("");
}

// Section 2–4: hitung frekuensi nilai suatu field di semua laporan
function renderHitung(field, tblSel, labelKolom) {
  const counts = new Map();
  for (const d of laporanCache.values()) {
    const v = (d[field] || "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxV = rows.length ? rows[0][1] : 0;

  const tbl = $(tblSel);
  tbl.querySelector("thead").innerHTML =
    `<tr><th>${esc(labelKolom)}</th><th class="num">Total</th></tr>`;
  const tbody = tbl.querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="muted">Belum ada data.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      ([k, v]) => `<tr>
        <td>${esc(k)}
          <div class="bar mini"><span class="bar-fill" style="width:${maxV ? (v / maxV) * 100 : 0}%"></span></div>
        </td>
        <td class="num">${v}</td>
      </tr>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
initAuth();
