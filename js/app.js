// ============================================================================
// APP — item model + dashboard berfilter (orang/tanggal/divisi/jenis) + rincian
// ============================================================================
import {
  auth, db, provider,
  signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from "./firebase.js";
import {
  ROSTER, URUTAN_PENGISI, ALLOWLIST, ADMIN_EMAILS, DROPDOWN, AMBANG_KEPATUHAN,
} from "./config.js";
import { hariIni, namaHari, fromISODate, hariKerjaSampai, esc } from "./util.js";

const COLLECTION = "entri";

// deadline (jam) + peta field -> selector input
const SECTIONS = {
  rencana: {
    deadline: 10, labelAdd: "Tambah Rencana",
    fields: { teks: "#f-rencana", divisi: "#f-divisi" },
  },
  realisasi: {
    deadline: 21, labelAdd: "Tambah Realisasi",
    fields: { teks: "#f-realisasi", output: "#f-output", status: "#f-status" },
  },
  kendala: {
    deadline: null, labelAdd: "Tambah Kendala",
    fields: { teks: "#f-kendala", jenisKendala: "#f-jenisKendala", nungguSiapa: "#f-nungguSiapa" },
  },
};
const JENIS = ["rencana", "realisasi", "kendala"];

let sesi = { email: null, pengisi: null, isAdmin: false };
let cache = new Map();
let unsub = null;
let sortState = { key: "tanggal", dir: "desc" };

const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------------------
// AUTENTIKASI
// ---------------------------------------------------------------------------
function initAuth() {
  $("#btn-login").addEventListener("click", async () => {
    $("#login-error").textContent = "";
    try { await signInWithPopup(auth, provider); }
    catch (e) { $("#login-error").textContent = "Gagal login: " + (e?.message || e); }
  });
  document.querySelectorAll(".btn-logout").forEach((b) =>
    b.addEventListener("click", () => signOut(auth))
  );
  onAuthStateChanged(auth, (user) => {
    if (!user) return showScreen("login");
    const email = (user.email || "").toLowerCase();
    const pengisi = ALLOWLIST[email];
    if (!pengisi) { $("#denied-email").textContent = email; return showScreen("denied"); }
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
function onMasuk(user) {
  $("#user-nama").textContent = ROSTER[sesi.pengisi]?.nama || sesi.pengisi;
  $("#user-email").textContent = sesi.email;
  $("#user-badge").textContent = sesi.isAdmin ? "Admin" : ROSTER[sesi.pengisi]?.peran || "";
  if (user.photoURL) { const img = $("#user-foto"); img.src = user.photoURL; img.hidden = false; }
  buildStatis();
  setupNav();
  langganan();
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
  if (tab === "form") renderSemua();
  if (tab === "dashboard") renderDashboard();
}

// ---------------------------------------------------------------------------
// SETUP STATIS
// ---------------------------------------------------------------------------
function opsi(list) {
  return `<option value="">— pilih —</option>` +
    list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
}
function buildStatis() {
  if (sesi.isAdmin) {
    $("#wrap-pengisi").hidden = false;
    $("#f-pengisi").innerHTML = URUTAN_PENGISI.map(
      (k) => `<option value="${k}">${esc(ROSTER[k].nama)} — ${esc(ROSTER[k].peran)}</option>`
    ).join("");
    $("#f-pengisi").value = sesi.pengisi;
    $("#f-pengisi").addEventListener("change", gantiKonteks);
  } else {
    $("#wrap-pengisi").hidden = true;
  }

  $("#f-divisi").innerHTML = opsi(DROPDOWN.divisi);
  $("#f-status").innerHTML = opsi(DROPDOWN.status);
  $("#f-jenisKendala").innerHTML = opsi(DROPDOWN.jenisKendala);
  $("#f-nungguSiapa").innerHTML = opsi(DROPDOWN.nungguSiapa);

  $("#f-tanggal").value = hariIni();
  $("#f-tanggal").addEventListener("change", gantiKonteks);

  $("#f-refRencana").addEventListener("change", () => {
    const id = $("#f-refRencana").value;
    const t = $("#f-realisasi");
    if (id && cache.get(id) && !t.value.trim()) t.value = cache.get(id).teks || "";
  });

  JENIS.forEach((j) => {
    $("#form-" + j).addEventListener("submit", (e) => simpan(j, e));
    $("#cancel-" + j).addEventListener("click", () => { resetForm(j); $("#info-" + j).textContent = ""; });
    $("#list-" + j).addEventListener("click", (e) => {
      const ed = e.target.closest("[data-edit]");
      const dl = e.target.closest("[data-del]");
      if (ed) mulaiEdit(j, ed.getAttribute("data-edit"));
      else if (dl) hapus(dl.getAttribute("data-del"));
    });
  });

  // ----- Filter dashboard -----
  $("#fl-orang").innerHTML = `<option value="">Semua orang</option>` +
    URUTAN_PENGISI.map((k) => `<option value="${k}">${esc(ROSTER[k].nama)}</option>`).join("");
  $("#fl-divisi").innerHTML = `<option value="">Semua divisi</option>` +
    DROPDOWN.divisi.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");

  ["fl-orang", "fl-divisi", "fl-jenis", "fl-mulai", "fl-akhir"].forEach((id) =>
    $("#" + id).addEventListener("change", () => { if (!$("#view-dashboard").hidden) renderDashboard(); })
  );
  $("#fl-reset").addEventListener("click", () => {
    ["fl-orang", "fl-divisi", "fl-jenis", "fl-mulai", "fl-akhir"].forEach((id) => ($("#" + id).value = ""));
    renderDashboard();
  });

  // ----- Sort rincian (klik header) -----
  $("#tbl-rincian thead").addEventListener("click", (e) => {
    const th = e.target.closest("[data-sort]");
    if (!th) return;
    const key = th.getAttribute("data-sort");
    if (sortState.key === key) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    else sortState = { key, dir: key === "tanggal" || key === "createdAt" ? "desc" : "asc" };
    renderDashboard();
  });
}

function gantiKonteks() {
  JENIS.forEach((j) => { resetForm(j); $("#info-" + j).textContent = ""; });
  renderSemua();
}

// ---------------------------------------------------------------------------
// DATA AKTIF (form)
// ---------------------------------------------------------------------------
function pengisiAktif() { return sesi.isAdmin ? $("#f-pengisi").value : sesi.pengisi; }
function tanggalAktif() { return $("#f-tanggal").value; }
function itemsAktif(jenis) {
  const p = pengisiAktif(), t = tanggalAktif();
  return [...cache.values()]
    .filter((it) => it.pengisi === p && it.tanggal === t && it.jenis === jenis)
    .sort((a, b) => (a.createdAt?.seconds || Infinity) - (b.createdAt?.seconds || Infinity));
}

// ---------------------------------------------------------------------------
// SIMPAN / EDIT / HAPUS
// ---------------------------------------------------------------------------
function bacaBagian(jenis) {
  const data = {};
  for (const [f, sel] of Object.entries(SECTIONS[jenis].fields)) data[f] = $(sel).value.trim();
  if (jenis === "realisasi") {
    const refId = $("#f-refRencana").value;
    const ref = refId ? cache.get(refId) : null;
    data.refId = refId || "";
    data.refTeks = ref ? (ref.teks || "") : "";
    data.divisi = ref ? (ref.divisi || "") : ""; // realisasi mewarisi divisi dari rencana
  }
  return data;
}

async function simpan(jenis, e) {
  e.preventDefault();
  const teks = $(SECTIONS[jenis].fields.teks).value.trim();
  const info = $("#info-" + jenis);
  if (!teks) { info.textContent = "Teks tidak boleh kosong."; return; }

  const btn = $("#btn-" + jenis);
  btn.disabled = true;
  const editId = $("#edit-" + jenis).value;
  const data = bacaBagian(jenis);

  try {
    if (editId) {
      await updateDoc(doc(db, COLLECTION, editId), { ...data, updatedAt: serverTimestamp(), by: sesi.email });
      info.textContent = "✓ Diperbarui " + new Date().toLocaleTimeString("id-ID");
    } else {
      await addDoc(collection(db, COLLECTION), {
        ...data, pengisi: pengisiAktif(), tanggal: tanggalAktif(),
        hari: namaHari(tanggalAktif()), jenis,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), by: sesi.email,
      });
      info.textContent = "✓ Ditambahkan " + new Date().toLocaleTimeString("id-ID");
    }
    resetForm(jenis);
  } catch (err) {
    info.textContent = "Gagal: " + (err?.message || err);
  } finally {
    btn.disabled = false;
  }
}

function mulaiEdit(jenis, id) {
  const it = cache.get(id);
  if (!it) return;
  for (const [f, sel] of Object.entries(SECTIONS[jenis].fields)) $(sel).value = it[f] || "";
  if (jenis === "realisasi") $("#f-refRencana").value = it.refId && cache.has(it.refId) ? it.refId : "";
  $("#edit-" + jenis).value = id;
  $("#btn-" + jenis).textContent = "Perbarui";
  $("#cancel-" + jenis).hidden = false;
  $("#info-" + jenis).textContent = "Mengedit item…";
  const el = $(SECTIONS[jenis].fields.teks);
  el.focus();
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function hapus(id) {
  const it = cache.get(id);
  if (!it) return;
  if (!confirm(`Hapus item ini?\n\n"${(it.teks || "").slice(0, 80)}"`)) return;
  try { await deleteDoc(doc(db, COLLECTION, id)); }
  catch (err) { alert("Gagal hapus: " + (err?.message || err)); }
}

function resetForm(jenis) {
  for (const sel of Object.values(SECTIONS[jenis].fields)) $(sel).value = "";
  if (jenis === "realisasi") $("#f-refRencana").value = "";
  $("#edit-" + jenis).value = "";
  $("#btn-" + jenis).textContent = SECTIONS[jenis].labelAdd;
  $("#cancel-" + jenis).hidden = true;
}

// ---------------------------------------------------------------------------
// RENDER FORM
// ---------------------------------------------------------------------------
function renderSemua() {
  $("#f-hari").textContent = namaHari(tanggalAktif());
  JENIS.forEach(renderList);
  renderRefOptions();
  refreshStatus();
}
function chip(t, cls = "") { return `<span class="chip ${cls}">${esc(t)}</span>`; }
function chipLink(url) {
  const u = (url || "").trim();
  if (/^https?:\/\//i.test(u)) return `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">bukti ↗</a>`;
  return chip("bukti: " + u);
}
function tagsItem(jenis, it) {
  if (jenis === "rencana") return it.divisi ? chip(it.divisi, "divisi") : "";
  if (jenis === "realisasi")
    return (it.status ? chip(it.status) : "") + (it.output ? chipLink(it.output) : "") +
      (it.refTeks ? chip("↳ " + it.refTeks.slice(0, 34), "ref") : "");
  if (jenis === "kendala")
    return (it.jenisKendala ? chip(it.jenisKendala) : "") + (it.nungguSiapa ? chip("⏳ " + it.nungguSiapa) : "");
  return "";
}
function liHTML(jenis, it) {
  const ot = tepatWaktu(it.createdAt, it.tanggal, SECTIONS[jenis].deadline);
  let badge = "";
  if (ot === true) badge = ` <span class="pill tiny ontime">tepat</span>`;
  else if (ot === false) badge = ` <span class="pill tiny late">telat</span>`;
  let waktu = `Diisi ${fmtWaktu(it.createdAt)}${badge}`;
  if (sudahDiedit(it.createdAt, it.updatedAt)) waktu += ` · diedit ${fmtWaktu(it.updatedAt)}`;
  if (it.by) waktu += ` · ${esc(it.by)}`;
  const tags = tagsItem(jenis, it);
  return `<li class="entri-item">
    <div class="entri-main">
      <div class="entri-teks">${esc(it.teks || "")}</div>
      ${tags ? `<div class="entri-tags">${tags}</div>` : ""}
      <div class="entri-time muted small">${waktu}</div>
    </div>
    <div class="entri-actions">
      <button type="button" class="btn btn-ghost small" data-edit="${esc(it.id)}">Edit</button>
      <button type="button" class="btn btn-ghost small danger" data-del="${esc(it.id)}">Hapus</button>
    </div>
  </li>`;
}
function renderList(jenis) {
  const items = itemsAktif(jenis);
  $("#count-" + jenis).textContent = items.length ? `${items.length} item` : "";
  const ul = $("#list-" + jenis);
  ul.innerHTML = items.length
    ? items.map((it) => liHTML(jenis, it)).join("")
    : `<li class="entri-empty muted">Belum ada ${jenis} untuk tanggal ini.</li>`;
}
function renderRefOptions() {
  const sel = $("#f-refRencana");
  const cur = sel.value;
  const items = itemsAktif("rencana");
  sel.innerHTML = `<option value="">— teks bebas —</option>` +
    items.map((it) => `<option value="${esc(it.id)}">${esc((it.teks || "").slice(0, 70))}</option>`).join("");
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function refreshStatus() {
  const p = pengisiAktif(), t = tanggalAktif();
  const ada = (j) => [...cache.values()].some(
    (it) => it.pengisi === p && it.tanggal === t && it.jenis === j && (it.teks || "").trim()
  );
  const s = statusHari(ada("rencana"), ada("realisasi"));
  const el = $("#f-statusisi");
  el.textContent = s;
  el.className = "pill " + kelasStatusIsi(s);
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
  if (!d) return "…";
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
  return u.getTime() - c.getTime() > 1000;
}

// ---------------------------------------------------------------------------
// LANGGANAN
// ---------------------------------------------------------------------------
function langganan() {
  if (unsub) unsub();
  unsub = onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      cache = new Map();
      snap.forEach((d) => cache.set(d.id, { id: d.id, ...d.data() }));
      if (!$("#view-dashboard").hidden) renderDashboard();
      if (!$("#view-form").hidden) renderSemua();
    },
    (err) => {
      console.error(err);
      $("#dash-info").textContent = "Gagal memuat data: " + (err?.message || err);
    }
  );
}

// ---------------------------------------------------------------------------
// STATUS ISI
// ---------------------------------------------------------------------------
function statusHari(adaRencana, adaRealisasi) {
  if (!adaRencana && !adaRealisasi) return "Tidak Dilaporkan";
  if (adaRencana && adaRealisasi) return "Lengkap";
  if (adaRencana) return "Belum Lengkap";
  return "Rencana Kosong";
}
function kelasStatusIsi(s) {
  return { Lengkap: "ok", "Belum Lengkap": "warn", "Rencana Kosong": "warn", "Tidak Dilaporkan": "bad" }[s] || "";
}

// ---------------------------------------------------------------------------
// FILTER DASHBOARD
// ---------------------------------------------------------------------------
function getFilter() {
  return {
    orang: $("#fl-orang").value,
    divisi: $("#fl-divisi").value,
    jenis: $("#fl-jenis").value,
    mulai: $("#fl-mulai").value,
    akhir: $("#fl-akhir").value,
  };
}
function divisiItem(it) { return it.divisi || ""; } // rencana & realisasi(ref); kendala kosong
function lolos(it, f, pakaiJenis) {
  if (f.orang && it.pengisi !== f.orang) return false;
  if (f.mulai && (it.tanggal || "") < f.mulai) return false;
  if (f.akhir && (it.tanggal || "") > f.akhir) return false;
  if (f.divisi && divisiItem(it) !== f.divisi) return false;
  if (pakaiJenis && f.jenis && it.jenis !== f.jenis) return false;
  return true;
}
function itemsFiltered(pakaiJenis = false) {
  const f = getFilter();
  return [...cache.values()].filter((it) => lolos(it, f, pakaiJenis));
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
function renderDashboard() {
  const f = getFilter();
  const base = itemsFiltered(false); // tanpa filter jenis (untuk agregat)
  const aktif = [f.orang && "orang", f.divisi && "divisi", f.jenis && "jenis", f.mulai && "mulai", f.akhir && "akhir"].filter(Boolean);
  $("#dash-info").textContent =
    `${base.length} item cocok • ${cache.size} total` + (aktif.length ? ` • filter: ${aktif.join(", ")}` : " • tanpa filter");

  renderKepatuhan(f, base);
  renderHitung("nungguSiapa", "#tbl-nunggu", "Pihak", base);
  renderHitung("jenisKendala", "#tbl-jenis", "Jenis", base);
  renderHitung("status", "#tbl-status", "Status", base);
  renderRincian();
}

function petaHari(items) {
  const m = new Map();
  for (const it of items) {
    if (!(it.teks || "").trim()) continue;
    const k = `${it.pengisi}__${it.tanggal}`;
    let e = m.get(k);
    if (!e) { e = { r: [], real: [] }; m.set(k, e); }
    if (it.jenis === "rencana") e.r.push(it);
    if (it.jenis === "realisasi") e.real.push(it);
  }
  return m;
}

function renderKepatuhan(f, base) {
  const akhir = f.akhir || hariIni();
  const workdays = hariKerjaSampai(akhir).filter((t) => !f.mulai || t >= f.mulai);
  const persons = f.orang ? [f.orang] : URUTAN_PENGISI;
  const peta = petaHari(base);

  const tbody = $("#tbl-kepatuhan tbody");
  const baris = persons.map((pengisi) => {
    const dl = { lengkap: [], belum: [], kosong: [], tidak: [] };
    for (const tgl of workdays) {
      const e = peta.get(`${pengisi}__${tgl}`);
      const s = statusHari(!!e?.r.length, !!e?.real.length);
      if (s === "Lengkap") dl.lengkap.push(tgl);
      else if (s === "Belum Lengkap") dl.belum.push(tgl);
      else if (s === "Rencana Kosong") dl.kosong.push(tgl);
      else dl.tidak.push(tgl);
    }
    const total = workdays.length || 1;
    return { pengisi, dl, persen: Math.round((dl.lengkap.length / total) * 100), total: workdays.length };
  });

  tbody.innerHTML = baris.map((r) => {
    const flag = r.persen < AMBANG_KEPATUHAN ? "🚩" : "✓";
    const barCls = r.persen < AMBANG_KEPATUHAN ? "bad" : r.persen < 95 ? "warn" : "ok";
    const cell = (arr, label) =>
      `<td class="num" title="${esc(label + ": " + (arr.length ? arr.join(", ") : "—"))}">${arr.length}</td>`;
    return `<tr>
      <td><strong>${esc(ROSTER[r.pengisi].nama)}</strong></td>
      <td class="num">${r.total}</td>
      ${cell(r.dl.lengkap, "Lengkap")}
      ${cell(r.dl.belum, "Belum lengkap")}
      ${cell(r.dl.kosong, "Rencana kosong")}
      ${cell(r.dl.tidak, "Tidak dilaporkan")}
      <td><div class="bar"><span class="bar-fill ${barCls}" style="width:${r.persen}%"></span></div><span class="num">${r.persen}%</span></td>
      <td class="center">${flag}</td>
    </tr>`;
  }).join("");
}

// tabel hitung + hover sumber
function renderHitung(field, tblSel, labelKolom, items) {
  const counts = new Map();   // nilai -> jumlah
  const sumber = new Map();   // nilai -> [string sumber]
  for (const d of items) {
    const v = (d[field] || "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
    if (!sumber.has(v)) sumber.set(v, []);
    sumber.get(v).push(`${ROSTER[d.pengisi]?.nama || d.pengisi} · ${d.tanggal}: ${(d.teks || "").slice(0, 40)}`);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxV = rows.length ? rows[0][1] : 0;

  const tbl = $(tblSel);
  tbl.querySelector("thead").innerHTML = `<tr><th>${esc(labelKolom)}</th><th class="num">Total</th></tr>`;
  const tbody = tbl.querySelector("tbody");
  tbody.innerHTML = rows.length
    ? rows.map(([k, v]) => {
        const src = (sumber.get(k) || []).join("\n");
        return `<tr title="${esc(src)}">
          <td>${esc(k)}<div class="bar mini"><span class="bar-fill" style="width:${maxV ? (v / maxV) * 100 : 0}%"></span></div></td>
          <td class="num">${v}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="2" class="muted">Belum ada data.</td></tr>`;
}

// ---------------------------------------------------------------------------
// RINCIAN (filter + sort + hover)
// ---------------------------------------------------------------------------
function sortItems(items) {
  const { key, dir } = sortState;
  const mul = dir === "asc" ? 1 : -1;
  const val = (it) => {
    switch (key) {
      case "createdAt": return it.createdAt?.seconds || 0;
      case "pengisi": return URUTAN_PENGISI.indexOf(it.pengisi);
      case "jenis": return JENIS.indexOf(it.jenis);
      case "divisi": return divisiItem(it);
      default: return it.tanggal || "";
    }
  };
  return [...items].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
  });
}

function jenisChip(j) {
  const c = { rencana: "coral", realisasi: "teal", kendala: "amber" }[j] || "";
  return `<span class="chip j-${c}">${esc(j)}</span>`;
}
function rincianDetail(it) {
  if (it.jenis === "realisasi")
    return (it.status ? chip(it.status) : "") + (it.output ? chipLink(it.output) : "") +
      (it.refTeks ? chip("↳ " + it.refTeks.slice(0, 30), "ref") : "") || "—";
  if (it.jenis === "kendala")
    return (it.jenisKendala ? chip(it.jenisKendala) : "") + (it.nungguSiapa ? chip("⏳ " + it.nungguSiapa) : "") || "—";
  return `<span class="muted">—</span>`;
}

function renderRincian() {
  const items = sortItems(itemsFiltered(true));
  $("#rincian-count").textContent = `(${items.length})`;
  const tbody = $("#tbl-rincian tbody");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Tidak ada item yang cocok dengan filter.</td></tr>`;
  } else {
    tbody.innerHTML = items.map((it) => {
      const nama = ROSTER[it.pengisi]?.nama || it.pengisi;
      const sumber = `Diisi oleh ${nama} (${it.by || "?"}) pada ${fmtWaktu(it.createdAt)}` +
        (sudahDiedit(it.createdAt, it.updatedAt) ? ` · diedit ${fmtWaktu(it.updatedAt)}` : "");
      const ot = tepatWaktu(it.createdAt, it.tanggal, SECTIONS[it.jenis]?.deadline);
      let badge = "";
      if (ot === true) badge = ` <span class="pill tiny ontime">tepat</span>`;
      else if (ot === false) badge = ` <span class="pill tiny late">telat</span>`;
      return `<tr>
        <td>${esc(it.tanggal)}<br><span class="muted small">${esc(it.hari || namaHari(it.tanggal))}</span></td>
        <td>${esc(nama)}</td>
        <td>${jenisChip(it.jenis)}</td>
        <td>${it.divisi ? esc(it.divisi) : `<span class="muted">—</span>`}</td>
        <td class="rincian-teks" title="${esc(sumber)}">${esc(it.teks || "")}</td>
        <td>${rincianDetail(it)}</td>
        <td class="muted small">${fmtWaktu(it.createdAt)}${badge}</td>
      </tr>`;
    }).join("");
  }
  updateSortIndicator();
}

function updateSortIndicator() {
  document.querySelectorAll("#tbl-rincian thead th[data-sort]").forEach((th) => {
    const base = th.textContent.replace(/[ ▲▼]+$/, "");
    th.textContent = th.getAttribute("data-sort") === sortState.key
      ? base + (sortState.dir === "asc" ? " ▲" : " ▼")
      : base;
  });
}

// ---------------------------------------------------------------------------
initAuth();
