"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let current = null; // currently displayed report

/* ---------- helpers ---------- */

// Map any status-like word from the report to a colour tone.
function tone(value) {
  const v = String(value || "").toLowerCase().trim();
  if (!v) return "neutral";
  if (/^(not ok|blocking|high|critical|fail|no)\b/.test(v)) return "bad";
  if (/^(attention|medium|warn|partial)/.test(v)) return "warn";
  if (/^(not found|missing|absent)/.test(v)) return "info";
  if (/^(not read|n\/a|-)/.test(v)) return "neutral";
  if (/^(ok|read|low|yes|pass|done)\b/.test(v)) return "good";
  return "neutral";
}
const pill = (v, t = tone(v)) => (v ? `<span class="pill ${t}">${esc(v)}</span>` : "");

// Case-insensitive lookup of a column in a row; accepts several candidate names.
function col(row, ...names) {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase() === n.toLowerCase());
    if (k !== undefined) return row[k];
  }
  return "";
}

function parseDate(s) {
  const m = String(s || "").match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function relDays(d) {
  const n = Math.round((d - today()) / 86400000);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
const avatar = (name) => `<span class="avatar" title="${esc(name)}">${esc(initials(name))}</span>`;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function section(key) { return current.sections.find((s) => s.key === key); }

/* ---------- sidebar ---------- */

async function loadList(selectId) {
  const res = await fetch("/api/reports");
  const items = await res.json();
  const ul = $("#report-list");
  ul.innerHTML = items.length ? "" : `<li class="s" style="cursor:default">No reports yet</li>`;
  for (const it of items) {
    const li = document.createElement("li");
    li.dataset.id = it.id;
    li.innerHTML = `
      <span class="dot ${it.error ? "bad" : tone(it.risk)}"></span>
      <div><div class="t">${esc(it.title)}</div>
        <div class="s">${it.error ? "parse error" : esc([it.risk, it.prepared, it.ticket].filter(Boolean).join(" · "))}</div></div>
      <button class="del" title="Delete">×</button>`;
    li.addEventListener("click", () => openReport(it.id));
    $(".del", li).addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ${it.id}?`)) return;
      await fetch(`/api/reports/${encodeURIComponent(it.id)}`, { method: "DELETE" });
      if (current && current.id === it.id) { current = null; $("#report").hidden = true; $("#empty").hidden = false; location.hash = ""; }
      loadList();
    });
    ul.appendChild(li);
  }
  const want = selectId || decodeURIComponent(location.hash.slice(1));
  if (want && items.some((i) => i.id === want)) openReport(want);
  else markActive();
}

function markActive() {
  $$("#report-list li").forEach((li) => li.classList.toggle("active", current && li.dataset.id === current.id));
}

async function upload(files) {
  const msg = $("#upload-msg");
  if (!files.length) return;
  const fd = new FormData();
  [...files].forEach((f) => fd.append("file", f));
  msg.className = "upload-msg"; msg.textContent = "Uploading…";
  const res = await fetch("/api/reports", { method: "POST", body: fd });
  const data = await res.json();
  msg.className = "upload-msg" + (data.errors?.length ? " err" : "");
  msg.textContent = data.errors?.length ? data.errors.join("; ") : `Uploaded ${data.saved.length} report(s)`;
  if (data.saved?.length) loadList(data.saved[data.saved.length - 1]);
}

/* ---------- report rendering ---------- */

async function openReport(id) {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!res.ok) { alert(data.error || "Failed to load report"); return; }
  current = data;
  location.hash = encodeURIComponent(id);
  render();
  markActive();
  window.scrollTo(0, 0);
}

function render() {
  const r = current;
  const parts = [];
  const nav = [];
  const used = new Set();

  parts.push(renderHero(r));
  parts.push(renderKpis());

  const add = (key, title, html, count) => {
    if (!html) return;
    used.add(key);
    nav.push(`<a href="#sec-${key}" data-sec="${key}">${esc(title)}</a>`);
    parts.push(`<section class="block" id="sec-${key}"><h2>${esc(title)}${count != null ? ` <span class="count">${count}</span>` : ""}</h2>${html}</section>`);
  };

  const s = (k) => section(k);
  add("conditions", "Conditions", s("conditions") && renderConditions(s("conditions")), s("conditions")?.rows.length);
  add("deadlines", "Deadlines", s("deadlines") && renderDeadlines(s("deadlines")), s("deadlines")?.rows.length);
  add("risks", "Risks", s("risks") && renderRisks(s("risks")), s("risks")?.rows.length);
  add("parameters", "Parameters", s("parameters") && renderParameters(s("parameters")), s("parameters")?.rows.length);
  if (s("commercial") || s("line_items")) {
    used.add("line_items");
    add("commercial", "Commercial", renderCommercial(s("commercial"), s("line_items")));
  }
  add("cross_checks", "Cross-checks", s("cross_checks") && renderChecks(s("cross_checks")), s("cross_checks")?.rows.length);
  add("owners", "Who does what", renderOwners());
  add("documents_reviewed", "Documents reviewed", s("documents_reviewed") && renderDocuments(s("documents_reviewed")), s("documents_reviewed")?.rows.length);

  // Anything the skill adds later that we don't know about yet.
  for (const sec of r.sections) {
    if (used.has(sec.key)) continue;
    add(sec.key, titleCase(sec.name), renderGeneric(sec), sec.rows?.length);
  }

  const navHtml = `<nav class="secnav">${nav.join("")}<span class="spacer"></span><button onclick="window.print()">Print / PDF</button></nav>`;
  parts.splice(2, 0, navHtml);

  const el = $("#report");
  el.innerHTML = `<div class="wrap">${parts.join("")}</div>`;
  el.hidden = false;
  $("#empty").hidden = true;
  document.title = `${r.title} — Legal Review`;
  wireUp(el);
}

function titleCase(s) { return s.charAt(0) + s.slice(1).toLowerCase(); }

function renderHero(r) {
  const h = r.header;
  const known = ["Document", "Risk level", "Recommended", "Basis", "In one sentence"];
  const metaItems = Object.entries(h).filter(([k]) => !known.includes(k) && !(k === "Related KYV" && h[k] === h.Linear));
  return `
    <header class="hero">
      <div class="eyebrow">Legal review${h.Prepared ? " · prepared " + esc(h.Prepared) : ""}</div>
      <h1>${esc(r.title)}</h1>
      ${h.Document ? `<p class="doc">${esc(h.Document)}</p>` : ""}
      <div class="verdict">
        ${h["Risk level"] ? `<span class="risk-badge ${tone(h["Risk level"])}">${esc(h["Risk level"])} RISK</span>` : ""}
        ${h.Recommended ? `<span class="pill neutral" style="font-size:13px;padding:5px 12px">Recommended: <b>${esc(h.Recommended)}</b></span>` : ""}
      </div>
      ${h["In one sentence"] ? `<p class="lead">${esc(h["In one sentence"])}</p>` : ""}
      ${h.Basis ? `<div class="callout ${tone(h["Risk level"])}"><b>Why this risk level</b>${esc(h.Basis)}</div>` : ""}
      <dl class="meta">${metaItems.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    </header>`;
}

function renderKpis() {
  const k = [];
  const params = section("parameters");
  if (params) {
    const counts = {};
    params.rows.forEach((p) => { const st = col(p, "Status") || "—"; counts[st] = (counts[st] || 0) + 1; });
    const order = Object.keys(counts).sort((a, b) => ["bad", "warn", "info", "neutral", "good"].indexOf(tone(a)) - ["bad", "warn", "info", "neutral", "good"].indexOf(tone(b)));
    const bar = order.map((st) => `<span style="flex:${counts[st]};background:var(--${tone(st)})" title="${esc(st)}: ${counts[st]}"></span>`).join("");
    k.push(kpi("parameters", "Parameters reviewed", params.rows.length,
      `<div class="stack">${bar}</div><div class="sub">${order.map((st) => `${counts[st]} ${esc(st)}`).join(" · ")}</div>`));
  }
  const risks = section("risks");
  if (risks) k.push(kpi("risks", "Risks identified", risks.rows.length, `<div class="sub">each with a mitigation</div>`));
  const conds = section("conditions");
  if (conds) {
    const blocking = conds.rows.filter((c) => tone(col(c, "Blocking")) === "bad");
    const open = blocking.filter((c) => !isDone(c));
    k.push(kpi("conditions", "Blocking conditions open", `${open.length}<span style="font-size:15px;color:var(--muted)"> / ${blocking.length}</span>`,
      `<div class="sub">${conds.rows.length} conditions in total</div>`, open.length ? "bad" : "good"));
  }
  const checks = section("cross_checks");
  if (checks) {
    const bad = checks.rows.filter((c) => tone(col(c, "Result")) === "bad").length;
    k.push(kpi("cross_checks", "Cross-checks failing", `${bad}<span style="font-size:15px;color:var(--muted)"> / ${checks.rows.length}</span>`, "", bad ? "bad" : "good"));
  }
  const dl = section("deadlines");
  if (dl) {
    const next = dl.rows.map((d) => ({ d: parseDate(col(d, "Date")), w: col(d, "What") })).filter((x) => x.d && x.d >= today()).sort((a, b) => a.d - b.d)[0];
    if (next) k.push(kpi("deadlines", "Next deadline", esc(relDays(next.d)), `<div class="sub">${esc(next.w.split(" - ")[0])}</div>`, "warn"));
  }
  return k.length ? `<div class="kpis">${k.join("")}</div>` : "";
}
function kpi(target, label, value, extra = "", t = "") {
  return `<div class="kpi" data-goto="${target}"><div class="k">${esc(label)}</div><div class="v" ${t ? `style="color:var(--${t})"` : ""}>${value}</div>${extra}</div>`;
}

/* --- parameters --- */
function renderParameters(sec) {
  const risksByParam = {};
  (section("risks")?.rows || []).forEach((r) => {
    const p = col(r, "Parameter");
    (risksByParam[p] ||= []).push(col(r, "#"));
  });
  const statuses = {};
  sec.rows.forEach((p) => { const s = col(p, "Status"); statuses[s] = (statuses[s] || 0) + 1; });
  const chips = [`<button class="chip on" data-filter="">All<span class="n">${sec.rows.length}</span></button>`]
    .concat(Object.entries(statuses).map(([s, n]) => `<button class="chip" data-filter="${esc(s)}">${esc(s)}<span class="n">${n}</span></button>`));
  const cards = sec.rows.map((p) => {
    const name = col(p, "Parameter");
    const status = col(p, "Status");
    const clause = col(p, "Clause");
    const ev = col(p, "Evidence");
    const linked = risksByParam[name] || [];
    return `
      <div class="card param s-${tone(status)}" id="param-${slug(name)}" data-status="${esc(status)}" data-text="${esc((name + " " + col(p, "Position") + " " + clause).toLowerCase())}">
        <div class="num">${esc(col(p, "#"))}</div>
        <div class="head"><span class="name">${esc(name)}</span>${pill(status)}</div>
        <div class="pos">${esc(col(p, "Position"))}</div>
        <div class="foot">
          ${clause && clause !== "-" ? `<span class="tag">§ ${esc(clause)}</span>` : ""}
          ${ev && ev.toLowerCase() !== "read" ? `<span class="tag">evidence: ${esc(ev)}</span>` : ""}
          ${linked.map((n) => `<a class="link" data-risk="${esc(n)}">⚠ Risk ${esc(n)}</a>`).join("")}
        </div>
      </div>`;
  }).join("");
  return `<div class="toolbar" data-for="params">${chips.join("")}<input type="search" placeholder="Search parameters…"></div><div class="params">${cards}</div>`;
}

/* --- risks --- */
function renderRisks(sec) {
  const paramNames = new Set((section("parameters")?.rows || []).map((p) => col(p, "Parameter")));
  return `<div class="risks">${sec.rows.map((r) => {
    const p = col(r, "Parameter");
    const link = paramNames.has(p)
      ? `<a class="link" data-param="${esc(slug(p))}">→ ${esc(p)}</a>`
      : p ? `<a class="link" data-goto="${esc(slug(p).replace(/-/g, "_"))}">→ ${esc(p)}</a>` : "";
    return `
      <div class="card risk" id="risk-${esc(col(r, "#"))}">
        <div class="r"><span class="n">${esc(col(r, "#"))}</span><span>${esc(col(r, "Risk"))}</span></div>
        <div class="m"><b>Mitigation</b>${esc(col(r, "Mitigation"))}</div>
        <div>${link}</div>
      </div>`;
  }).join("")}</div>`;
}

/* --- conditions (with local tick-off) --- */
function doneKey(c) { return `done:${current.id}:${col(c, "ID")}`; }
function isDone(c) { try { return localStorage.getItem(doneKey(c)) === "1"; } catch { return false; } }

function renderConditions(sec) {
  const buckets = {};
  sec.rows.forEach((c) => (buckets[col(c, "Bucket") || "other"] ||= []).push(c));
  return `<div class="buckets">${Object.entries(buckets).map(([b, items]) => `
    <div class="card bucket">
      <h3><span>${esc(b)}</span><span>${items.length}</span></h3>
      ${items.map((c) => {
        const blocking = col(c, "Blocking");
        const done = isDone(c);
        return `
        <label class="cond ${done ? "done" : ""}">
          <input type="checkbox" data-done="${esc(doneKey(c))}" ${done ? "checked" : ""}>
          <div>
            <div class="txt"><b>${esc(col(c, "ID"))}</b> ${esc(col(c, "Condition"))}</div>
            <div class="meta-line">
              ${blocking ? pill(blocking) : ""}
              ${col(c, "Owner") ? `${avatar(col(c, "Owner"))} ${esc(col(c, "Owner"))}` : ""}
              ${col(c, "By when") ? `<span>· by ${esc(col(c, "By when"))}</span>` : ""}
              ${dueBadge(col(c, "By when"))}
            </div>
          </div>
        </label>`;
      }).join("")}
    </div>`).join("")}</div>
    <p class="sub" style="color:var(--muted);font-size:12px;margin-top:8px">Ticks are saved in this browser only.</p>`;
}
function dueBadge(s) {
  const d = parseDate(s);
  if (!d) return "";
  const n = Math.round((d - today()) / 86400000);
  return pill(relDays(d), n < 0 ? "bad" : n <= 14 ? "warn" : "neutral");
}

/* --- deadlines --- */
function renderDeadlines(sec) {
  const items = sec.rows.map((r) => ({ r, d: parseDate(col(r, "Date")) })).sort((a, b) => (a.d || 0) - (b.d || 0));
  const nextIdx = items.findIndex((x) => x.d && x.d >= today());
  return `<div class="card" style="padding:16px 18px"><div class="timeline">${items.map((x, i) => {
    const what = col(x.r, "What");
    const [head, ...rest] = what.split(" - ");
    const cls = x.d && x.d < today() ? "past" : i === nextIdx ? "next" : "";
    return `
      <div class="tl ${cls}">
        <div class="d">${esc(col(x.r, "Date"))} ${x.d ? pill(relDays(x.d), cls === "past" ? "neutral" : cls === "next" ? "bad" : "neutral") : ""}</div>
        <div class="w"><b>${esc(head)}</b>${rest.length ? ` — ${esc(rest.join(" - "))}` : ""}</div>
        ${col(x.r, "Owner") ? `<div class="o">${avatar(col(x.r, "Owner"))}${esc(col(x.r, "Owner"))}</div>` : ""}
      </div>`;
  }).join("")}</div></div>`;
}

/* --- commercial --- */
function renderCommercial(kv, items) {
  let html = "";
  if (kv) {
    const highlight = /cancel|late|antispam|overconsumption/i;
    html += `<div class="kv-grid">${kv.items.map((i) => `
      <div class="card ${highlight.test(i.label) ? "hl" : ""}"><div class="l">${esc(i.label)}</div><div class="v">${esc(i.value)}</div></div>`).join("")}</div>`;
  }
  if (items) html += `<div class="sub-h">Line items</div>` + renderTable(items);
  return html;
}

/* --- cross-checks --- */
function renderChecks(sec) {
  return `<div class="checks">${sec.rows.map((c) => {
    const res = col(c, "Result");
    const t = tone(res);
    return `<div class="card check"><span class="ic ${t}">${t === "good" ? "✓" : t === "bad" ? "✗" : "?"}</span>
      <div><div class="c">${esc(col(c, "Check"))} ${pill(res)}</div><div class="nt">${esc(col(c, "Note"))}</div></div></div>`;
  }).join("")}</div>`;
}

/* --- documents --- */
function renderDocuments(sec) {
  return renderTable(sec, (colName, v) => {
    if (colName.toLowerCase() !== "status") return esc(v);
    const [head, ...rest] = v.split(" - ");
    return pill(head) + (rest.length ? `<div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(rest.join(" - "))}</div>` : "");
  });
}

/* --- owners: conditions + deadlines grouped by person --- */
function renderOwners() {
  const by = {};
  (section("conditions")?.rows || []).forEach((c) => {
    const o = col(c, "Owner"); if (!o) return;
    (by[o] ||= []).push(`<li>${esc(col(c, "ID"))} — ${esc(col(c, "Condition"))} <small>(${esc(col(c, "By when"))})</small>${tone(col(c, "Blocking")) === "bad" ? " " + pill("blocking") : ""}</li>`);
  });
  (section("deadlines")?.rows || []).forEach((d) => {
    const o = col(d, "Owner"); if (!o) return;
    (by[o] ||= []).push(`<li>📅 <b>${esc(col(d, "Date"))}</b> — ${esc(col(d, "What").split(" - ")[0])}</li>`);
  });
  const h = current.header;
  if (h.Decision) (by[h.Decision] ||= []).unshift(`<li><b>Decision owner</b> for this review</li>`);
  const names = Object.keys(by);
  if (!names.length) return "";
  return `<div class="owners">${names.map((n) => `
    <div class="card owner"><h3>${avatar(n)} ${esc(n)} <span class="count" style="font-size:12px;color:var(--muted);font-weight:500">${by[n].length}</span></h3><ul>${by[n].join("")}</ul></div>`).join("")}</div>`;
}

/* --- generic fallbacks --- */
function renderTable(sec, cell = (c, v) => (/status|result|blocking/i.test(c) ? pill(v) : esc(v))) {
  return `<div style="overflow-x:auto"><table class="t"><thead><tr>${sec.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${sec.rows.map((r) => `<tr>${sec.columns.map((c) => `<td>${cell(c, r[c] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function renderGeneric(sec) {
  if (sec.kind === "kv") return `<div class="kv-grid">${sec.items.map((i) => `<div class="card"><div class="l">${esc(i.label)}</div><div class="v">${esc(i.value)}</div></div>`).join("")}</div>`;
  return renderTable(sec);
}

/* ---------- interactions ---------- */

function flash(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

function wireUp(root) {
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-goto],[data-param],[data-risk]");
    if (!t) return;
    if (t.dataset.param) flash($(`#param-${t.dataset.param}`));
    else if (t.dataset.risk) flash($(`#risk-${CSS.escape(t.dataset.risk)}`));
    else if (t.dataset.goto) $(`#sec-${t.dataset.goto}`)?.scrollIntoView({ behavior: "smooth" });
  });

  // condition tick-off
  $$("input[data-done]", root).forEach((cb) => cb.addEventListener("change", () => {
    try { cb.checked ? localStorage.setItem(cb.dataset.done, "1") : localStorage.removeItem(cb.dataset.done); } catch {}
    cb.closest(".cond").classList.toggle("done", cb.checked);
    const k = $(".kpis", root);
    if (k) k.outerHTML = renderKpis();
  }));

  // parameter filter + search
  const tb = $('.toolbar[data-for="params"]', root);
  if (tb) {
    let status = "", q = "";
    const apply = () => $$(".param", root).forEach((p) => {
      const ok = (!status || p.dataset.status === status) && (!q || p.dataset.text.includes(q));
      p.classList.toggle("hidden", !ok);
    });
    $$(".chip", tb).forEach((ch) => ch.addEventListener("click", () => {
      $$(".chip", tb).forEach((c) => c.classList.remove("on"));
      ch.classList.add("on"); status = ch.dataset.filter; apply();
    }));
    $("input[type=search]", tb).addEventListener("input", (e) => { q = e.target.value.toLowerCase().trim(); apply(); });
  }

  // highlight current section in nav
  const links = $$(".secnav a", root);
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.dataset.sec === en.target.id.slice(4)));
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  $$("section.block", root).forEach((s) => obs.observe(s));
}

/* ---------- boot ---------- */

const dz = $("#dropzone");
$("#file-input").addEventListener("change", (e) => { upload(e.target.files); e.target.value = ""; });
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => upload(e.dataTransfer.files));
// allow dropping anywhere on the page
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { if (!dz.contains(e.target)) { e.preventDefault(); upload(e.dataTransfer.files); } });

loadList();
