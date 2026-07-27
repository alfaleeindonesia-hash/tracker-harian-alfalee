// ============================================================================
// APP — kontrol utama: login, form input (3 bagian terpisah), dashboard
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
  hariIni, namaHari, fromISODate, hariKerjaSampai, statusIsi, esc,
} from "./util.js";

const COLLECTION = "laporan";

// Deadline tiap bagian (jam lokal). null = tanpa aturan waktu.
const DEADLINE = { rencana: 10, realisasi: 21, kendala: null };

// Field milik tiap bagian
const FIELDS = {
  rencana: ["rencana", "terkait"],
  realisasi: ["realisasi", "output", "status", "rencanaBesok"],
  kendala: ["kendala", "jenisKendala", "nungguSiapa"],
};

let sesi = { email: null, pengisi: null, isAdmin: false };
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
  $("#user-badge").textContent = sesi.isAdmin ? "Admin" : ROSTER[sesi.pengisi]?.peran || "";
  if (user.photoURL) {
    const img = $("#user-foto");
    img.src = user.photoURL;
    img.hidden = false;
  }

  buildFormStatis();
  setupNav();
  langgananLaporan();
  showScreen("app");
  gotoTab("form");
}

// ---------------------------------------------------------------------------
// NAVIGASI
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
// FORM
// ---------------------------------------------------------------------------
function opsi(list) {
  return (
    `<option value="">— pilih —</option>` +
    list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")
  );
}

function buildFormStatis() {
  const wrapPengisi = $("#wrap-pengisi");
  if (sesi.isAdmin) {
    wrapPengisi.hidden = false;
    $("#f-pengisi").innerHTML = URUTAN_PENGISI.map(
      (k) => `<option value="${k}">${esc(ROSTER[k].nama)} — ${esc(ROSTER[k].peran)}</option>`
    ).join("");
    $("#f-pengisi").value = sesi.pengisi;
    $("#f-pengisi").addEventListener("change", muatFormUntukTanggal);
  } else {
    wrapPengisi.hidden = true;
  }

  $("#f-terkait").innerHTML = opsi(DROPDOWN.terkait);
  $("#f-status").innerHTML = opsi(DROPDOWN.status);
  $("#f-jenisKendala").innerHTML = opsi(DROPDOWN.jenisKendala);
  $("#f-nungguSiapa").innerHTML = opsi(DROPDOWN.nungguSiapa);

  $("#f-tanggal").value = hariIni();
  $("#f-tanggal").addEventListener("change", muatFormUntukTanggal);

  ["#f-rencana", "#f-realisasi"].forEach((s) =>
    $(s).addEventListener("input", updateStatusIsiLive)
  );

  // Tiga penyimpanan terpisah
  $("#form-rencana").addEventListener("submit", (e) => simpanBagian("rencana", e));
  $("#form-realisasi").addEventListener("submit", (e) => simpanBagian("realisasi", e));
  $("#form-kendala").addEventListener("submit", (e) => simpanBagian("kendala", e));
}

function pengisiAktif() {
  return sesi.isAdmin ? $("#f-pengisi").value : sesi.pengisi;
}
function idAktif() {
  return `${pengisiAktif()}__${$("#f-tanggal").value}`;
}

function muatFormUntukTanggal() {
  const tanggal = $("#f-tanggal").value;
  if (!tanggal) return;
  $("#f-hari").textContent = namaHari(tanggal);
  const data = laporanCache.get(idAktif()) || {};

  $("#f-rencana").value = data.rencana || "";
  $("#f-terkait").value = data.terkait || "";
  $("#f-realisasi").value = data.realisasi || "";
  $("#f-output").value = data.output || "";
  $("#f-status").value = data.status || "";
  $("#f-rencanaBesok").value = data.rencanaBesok || "";
  $("#f-kendala").value = data.kendala || "";
  $("#f-jenisKendala").value = data.jenisKendala || "";
  $("#f-nungguSiapa").value = data.nungguSiapa || "";

  ["rencana", "realisasi", "kendala"].forEach((b) => ($("#info-" + b).textContent = ""));
  refreshMeta();
}

// Perbarui label waktu tiap bagian + status isi (TANPA menyentuh input)
function refreshMeta() {
  const tanggal = $("#f-tanggal").value;
  const data = laporanCache.get(idAktif()) || {};
  renderMetaBagian("#meta-rencana", data, "rencana", tanggal);
  renderMetaBagian("#meta-realisasi", data, "realisasi", tanggal);
  renderMetaBagian("#meta-kendala", data, "kendala", tanggal);
  updateStatusIsiLive();
}

function renderMetaBagian(sel, data, bagian, tanggalISO) {
  const span = $(sel);
  const created = data[bagian + "CreatedAt"];
  const updated = data[bagian + "UpdatedAt"];
  if (!created && !updated) {
    span.className = "meta muted";
    span.textContent = "Belum diisi";
    return;
  }
  let html = `Diisi ${fmtWaktu(created)}`;
  const ot = tepatWaktu(created, tanggalISO, DEADLINE[bagian]);
  if (ot === true) html += ` <span class="pill tiny ontime">Tepat waktu</span>`;
  else if (ot === false) html += ` <span class="pill tiny late">Terlambat</span>`;
  if (sudahDiedit(created, updated)) html += ` · diedit ${fmtWaktu(updated)}`;
  const by = data[bagian + "By"];
  if (by) html += ` <span class="muted">· ${esc(by)}</span>`;
  span.className = "meta";
  span.innerHTML = html;
}

function updateStatusIsiLive() {
  const s = statusIsi({ rencana: $("#f-rencana").value, realisasi: $("#f-realisasi").value });
  const el = $("#f-statusisi");
  el.textContent = s;
  el.className = "pill " + kelasStatusIsi(s);
}

async function simpanBagian(bagian, e) {
  e.preventDefault();
  const tanggal = $("#f-tanggal").value;
  const pengisi = pengisiAktif();
  if (!tanggal) return;

  const btn = $("#btn-" + bagian);
  const info = $("#info-" + bagian);
  btn.disabled = true;
  const labelAsli = btn.textContent;
  btn.textContent = "Menyimpan…";

  const existing = laporanCache.get(`${pengisi}__${tanggal}`) || {};
  const now = serverTimestamp();

  const payload = { pengisi, tanggal, hari: namaHari(tanggal) };
  for (const f of FIELDS[bagian]) payload[f] = $("#f-" + f).value.trim();
  payload[bagian + "UpdatedAt"] = now;
  payload[bagian + "By"] = sesi.email;
  if (!existing[bagian + "CreatedAt"]) payload[bagian + "CreatedAt"] = now;

  try {
    await setDoc(doc(collection(db, COLLECTION), `${pengisi}__${tanggal}`), payload, { merge: true });
    info.textContent = "✓ Tersimpan " + new Date().toLocaleTimeString("id-ID");
  } catch (err) {
    info.textContent = "Gagal: " + (err?.message || err);
  } finally {
    btn.disabled = false;
    btn.textContent = labelAsli;
  }
}

// ---------------------------------------------------------------------------
// RIWAYAT
// ---------------------------------------------------------------------------
function renderRiwayat() {
  const pengisi = pengisiAktif();
  const rows = [...laporanCache.values()]
    .filter((d) => d.pengisi === pengisi)
    .sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1))
    .slice(0, 12);

  const tbody = $("#riwayat-body");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Belum ada riwayat.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((d) => {
      const le = editTerakhir(d);
      return `<tr>
        <td><strong>${esc(d.tanggal)}</strong><br><span class="muted small">${esc(d.hari || namaHari(d.tanggal))}</span></td>
        <td>${selWaktu(d, "rencana")}</td>
        <td>${selWaktu(d, "realisasi")}</td>
        <td>${selWaktu(d, "kendala")}</td>
        <td>${le ? `${fmtWaktu(le.at)}<br><span class="muted small">${esc(le.by || "")}</span>` : "—"}</td>
      </tr>`;
    })
    .join("");
}

function selWaktu(d, bagian) {
  const created = d[bagian + "CreatedAt"];
  const updated = d[bagian + "UpdatedAt"];
  if (!created && !updated) return `<span class="muted">—</span>`;
  const ot = tepatWaktu(created, d.tanggal, DEADLINE[bagian]);
  let badge = "";
  if (ot === true) badge = ` <span class="pill tiny ontime">tepat</span>`;
  else if (ot === false) badge = ` <span class="pill tiny late">telat</span>`;
  const edit = sudahDiedit(created, updated) ? `<br><span class="muted small">diedit ${fmtWaktu(updated)}</span>` : "";
  return `${fmtWaktu(created)}${badge}${edit}`;
}

function editTerakhir(d) {
  let best = null;
  for (const b of ["rencana", "realisasi", "kendala"]) {
    const u = d[b + "UpdatedAt"];
    if (u && u.seconds && (!best || u.seconds > best.sec)) {
      best = { sec: u.seconds, at: u, by: d[b + "By"] };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// WAKTU
// ---------------------------------------------------------------------------
function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
}
function fmtWaktu(ts) {
  const d = toDate(ts);
  if (!d) return "…"; // serverTimestamp masih pending
  return d.toLocaleString("id-ID", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
function tepatWaktu(createdTs, tanggalISO, deadlineHour) {
  if (deadlineHour == null) return null;
  const created = toDate(createdTs);
  if (!created || !tanggalISO) return null;
  const dl = fromISODate(tanggalISO);
  dl.setHours(deadlineHour, 0, 0, 0);
  return created <= dl;
}
function sudahDiedit(createdTs, updatedTs) {
  const c = toDate(createdTs), u = toDate(updatedTs);
  if (!c || !u) return false;
  return u.getTime() - c.getTime() > 1000; // beda > 1 detik
}

// ---------------------------------------------------------------------------
// DATA REAL-TIME
// ---------------------------------------------------------------------------
function langgananLaporan() {
  if (unsubLaporan) unsubLaporan();
  unsubLaporan = onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      laporanCache = new Map();
      snap.forEach((d) => laporanCache.set(d.id, d.data()));
      if (!$("#view-dashboard").hidden) renderDashboard();
      if (!$("#view-form").hidden) {
        renderRiwayat();
        refreshMeta(); // perbarui label waktu tanpa mengubah input
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
    return { pengisi, lengkap, belum, kosong, tidak, persen: Math.round((lengkap / total) * 100) };
  });

  tbody.innerHTML = baris
    .map((r) => {
      const flag = r.persen < AMBANG_KEPATUHAN ? "🚩" : "✓";
      const barCls = r.persen < AMBANG_KEPATUHAN ? "bad" : r.persen < 95 ? "warn" : "ok";
      return `<tr>
        <td><strong>${esc(ROSTER[r.pengisi].nama)}</strong></td>
        <td class="num">${workdays.length}</td>
        <td class="num">${r.lengkap}</td>
        <td class="num">${r.belum}</td>
        <td class="num">${r.kosong}</td>
        <td class="num">${r.tidak}</td>
        <td><div class="bar"><span class="bar-fill ${barCls}" style="width:${r.persen}%"></span></div><span class="num">${r.persen}%</span></td>
        <td class="center">${flag}</td>
      </tr>`;
    })
    .join("");
}

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
  tbl.querySelector("thead").innerHTML = `<tr><th>${esc(labelKolom)}</th><th class="num">Total</th></tr>`;
  const tbody = tbl.querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="muted">Belum ada data.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      ([k, v]) => `<tr>
        <td>${esc(k)}<div class="bar mini"><span class="bar-fill" style="width:${maxV ? (v / maxV) * 100 : 0}%"></span></div></td>
        <td class="num">${v}</td>
      </tr>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
initAuth();
