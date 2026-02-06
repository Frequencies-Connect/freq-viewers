async function loadJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// ✅ robuste: marche si le site est publié à la racine OU dans /src
async function loadData(pathFromDataRoot) {
  const candidates = [
    `./data/${pathFromDataRoot}`,
    `../data/${pathFromDataRoot}`,
  ];

  let lastErr = null;
  for (const url of candidates) {
    try {
      return await loadJSON(url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function escapeHtml(s) {
  return (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function uniq(arr) {
  return [...new Set(arr)].filter(Boolean).sort();
}

function getYear(dateStr) {
  return parseInt(dateStr.slice(0, 4), 10);
}

function safeNum(n) {
  return (typeof n === "number" && Number.isFinite(n)) ? n : "";
}

let INDEX = null;
let THEMES = null;
let CURRENT_DETAIL = null;

function applyScrutinFilters() {
  const q = document.querySelector("#q").value.trim().toLowerCase();
  const result = document.querySelector("#result").value;
  const theme = document.querySelector("#theme").value;

  let rows = INDEX.scrutins;

  if (q) rows = rows.filter(s => (s.title ?? "").toLowerCase().includes(q));
  if (result) rows = rows.filter(s => (s.result_status ?? "") === result);
  if (theme) rows = rows.filter(s => (s.themes ?? []).includes(theme));

  document.querySelector("#meta").innerHTML =
    `<span class="meta-badge">${rows.length} scrutins</span> &nbsp; données générées: ${INDEX.generated_at}`;

  const tbody = document.querySelector("#scrutinsTable tbody");
  tbody.innerHTML = "";

  for (const s of rows) {
    const counts = s.counts ?? {};
    const status = s.result_status ?? "";
    const badgeClass = status === "adopted" ? "badge-adopted" : status === "rejected" ? "badge-rejected" : "";
    const badgeLabel = status === "adopted" ? "Adopté" : status === "rejected" ? "Rejeté" : escapeHtml(status);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.date}</td>
      <td>${escapeHtml(s.title)}</td>
      <td>${badgeClass ? `<span class="badge ${badgeClass}">${badgeLabel}</span>` : badgeLabel}</td>
      <td class="vote-pour">${safeNum(counts.for)}</td>
      <td class="vote-contre">${safeNum(counts.against)}</td>
      <td><span class="id-code">${escapeHtml(s.id)}</span></td>
      <td><button class="btn btn-primary" data-id="${s.id}" data-date="${s.date}">Voir votes</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", () => openDetail(btn.dataset.id, btn.dataset.date));
  });
}

async function openDetail(scrutinId, dateStr) {
  const year = getYear(dateStr);

  // ✅ charge depuis data/ quel que soit le niveau du HTML
  const pack = await loadData(`scrutins/${year}.json`);

  const s = pack.scrutins.find(x => x.id === scrutinId);
  if (!s) {
    alert(`Scrutin introuvable dans data/scrutins/${year}.json`);
    return;
  }

  CURRENT_DETAIL = s;

  // si tu as gardé l'overlay: remplace par "#overlay".classList.add("open")
  const detailEl = document.querySelector("#detail");
  if (detailEl) detailEl.classList.remove("hidden");

  document.querySelector("#detail-title").textContent = s.title;

  const counts = s.counts ?? {};
  const sub = [
    s.date,
    s.scrutin_type ?? "",
    s.result_status ?? "",
    `pour: ${safeNum(counts.for)}`,
    `contre: ${safeNum(counts.against)}`
  ].filter(Boolean).join(" — ");

  document.querySelector("#detail-sub").textContent = sub;

  document.querySelector("#vq").value = "";
  document.querySelector("#vpos").value = "";
  document.querySelector("#vgroup").value = "";

  renderVotes();
}

function renderVotes() {
  const q = document.querySelector("#vq").value.trim().toLowerCase();
  const pos = document.querySelector("#vpos").value;
  const groupQ = document.querySelector("#vgroup").value.trim().toLowerCase();

  let votes = CURRENT_DETAIL.votes ?? [];

  if (pos) votes = votes.filter(v => v.position === pos);

  if (groupQ) {
    votes = votes.filter(v => {
      const g = (v.group_acronym ?? v.group_name ?? v.group ?? "").toLowerCase();
      return g.includes(groupQ);
    });
  }

  if (q) {
    votes = votes.filter(v => {
      const name = (v.name ?? "").toLowerCase();
      const pid = (v.person_id ?? "").toLowerCase();
      return name.includes(q) || pid.includes(q);
    });
  }

  votes = [...votes].sort((a, b) => {
    const ga = (a.group_acronym ?? a.group ?? "");
    const gb = (b.group_acronym ?? b.group ?? "");
    if (ga < gb) return -1;
    if (ga > gb) return 1;
    const na = (a.name ?? "");
    const nb = (b.name ?? "");
    return na.localeCompare(nb);
  });

  const tbody = document.querySelector("#votesTable tbody");
  tbody.innerHTML = "";

  const posMap = {
    FOR: { label: "Pour", css: "pour" },
    AGAINST: { label: "Contre", css: "contre" },
    ABSTAIN: { label: "Abstention", css: "abstention" },
    NONVOTING: { label: "Non-votant", css: "nonvotant" },
  };

  for (const v of votes) {
    const p = posMap[v.position] ?? { label: escapeHtml(v.position ?? ""), css: "" };
    const voteBadge = p.css
      ? `<span class="vote-badge ${p.css}">${p.label}</span>`
      : p.label;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(v.name ?? "")}</strong></td>
      <td>${escapeHtml(v.group_acronym ?? "")}</td>
      <td>${voteBadge}</td>
      <td>${escapeHtml(v.constituency ?? "")}</td>
      <td><span class="id-code">${escapeHtml(v.person_id ?? "")}</span></td>
    `;
    tbody.appendChild(tr);
  }

  const meta = document.querySelector("#votesMeta");
  if (meta) {
    meta.textContent = `${votes.length} votes affichés (sur ${(CURRENT_DETAIL.votes ?? []).length})`;
  }
}

async function init() {
  // ✅ charge data/index.json et data/themes.json avec fallback
  INDEX = await loadData("index.json");
  THEMES = await loadData("themes.json");

  // map slug → label depuis themes.json
  const labelMap = {};
  for (const t of (THEMES.themes ?? [])) {
    labelMap[t.slug] = t.label ?? t.slug;
  }
  labelMap["autre"] = "Autre";

  // collecter tous les thèmes réellement présents dans les données
  const dataThemes = new Set();
  for (const s of (INDEX.scrutins ?? [])) {
    for (const t of (s.themes ?? [])) dataThemes.add(t);
  }

  // fusionner : thèmes déclarés + thèmes trouvés dans les données
  const allSlugs = uniq([...Object.keys(labelMap), ...dataThemes]);

  const themeSel = document.querySelector("#theme");
  for (const slug of allSlugs) {
    const opt = document.createElement("option");
    opt.value = slug;
    opt.textContent = labelMap[slug] ?? slug;
    themeSel.appendChild(opt);
  }

  ["q", "result", "theme"].forEach(id => {
    const el = document.querySelector(`#${id}`);
    el.addEventListener("input", applyScrutinFilters);
    el.addEventListener("change", applyScrutinFilters);
  });

  document.querySelector("#close").addEventListener("click", () => {
    // si overlay: "#overlay".classList.remove("open")
    const detailEl = document.querySelector("#detail");
    if (detailEl) detailEl.classList.add("hidden");
    CURRENT_DETAIL = null;
  });

  document.querySelector("#vq").addEventListener("input", () => CURRENT_DETAIL && renderVotes());
  document.querySelector("#vpos").addEventListener("change", () => CURRENT_DETAIL && renderVotes());
  document.querySelector("#vgroup").addEventListener("input", () => CURRENT_DETAIL && renderVotes());

  applyScrutinFilters();
}

init().catch(err => {
  document.querySelector("#meta").textContent = `Erreur: ${err.message}`;
});