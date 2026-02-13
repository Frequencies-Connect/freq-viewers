// ===== UTILITAIRES =====

async function loadJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function loadData(pathFromDataRoot) {
  const candidates = [
    `./data/${pathFromDataRoot}`,
    `../data/${pathFromDataRoot}`,
  ];
  let lastErr = null;
  for (const url of candidates) {
    try { return await loadJSON(url); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function escapeHtml(s) {
  return (s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

const POS_MAP = {
  FOR: { label: "Pour", css: "pour" },
  AGAINST: { label: "Contre", css: "contre" },
  ABSTAIN: { label: "Abstention", css: "abstention" },
  NONVOTING: { label: "Non-votant", css: "nonvotant" },
};

function voteBadgeHtml(position) {
  const p = POS_MAP[position] ?? { label: escapeHtml(position ?? ""), css: "" };
  return p.css ? `<span class="vote-badge ${p.css}">${p.label}</span>` : p.label;
}

function resultBadgeHtml(status) {
  if (status === "adopted") return `<span class="badge badge-adopted">Adopté</span>`;
  if (status === "rejected") return `<span class="badge badge-rejected">Rejeté</span>`;
  return escapeHtml(status ?? "");
}

// ===== ÉTAT GLOBAL =====

let INDEX = null;
let THEMES = null;
let DEPUTIES = null;
let GROUPS = null;
let CURRENT_DETAIL = null;
let CURRENT_DEPUTY = null;
let CURRENT_GROUP = null;

// Cache des fichiers scrutins par mois déjà chargés
const SCRUTIN_CACHE = {};

// ===== HELPER : charger tous les scrutins (on-demand, par mois) =====

async function loadAllScrutins() {
  const months = INDEX.months ?? [];
  const promises = months.map(async m => {
    if (!SCRUTIN_CACHE[m]) {
      SCRUTIN_CACHE[m] = await loadData(`scrutins/${m}.json`);
    }
    return SCRUTIN_CACHE[m];
  });
  return Promise.all(promises);
}

function getAllScrutinsFromCache() {
  const all = [];
  for (const pack of Object.values(SCRUTIN_CACHE)) {
    all.push(...(pack.scrutins ?? []));
  }
  return all;
}

// ===== HELPER : fermer un overlay =====

function closeOverlay(id) {
  document.querySelector(id).classList.add("hidden");
  // remettre le scroll seulement si aucun overlay n'est ouvert
  const anyOpen = document.querySelectorAll(".overlay:not(.hidden)");
  if (anyOpen.length === 0) {
    document.body.classList.remove("overlay-open");
  }
}

function openOverlay(id) {
  document.querySelector(id).classList.remove("hidden");
  document.body.classList.add("overlay-open");
}

// ===== NAVIGATION =====

function setupNavigation() {
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;
      document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".view-panel").forEach(p => p.classList.add("hidden"));
      document.getElementById(`view-${view}`).classList.remove("hidden");
    });
  });
}

// ===== VUE : SCRUTINS =====

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
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.date}</td>
      <td>${escapeHtml(s.title)}</td>
      <td>${resultBadgeHtml(s.result_status)}</td>
      <td class="vote-pour">${safeNum(counts.for)}</td>
      <td class="vote-contre">${safeNum(counts.against)}</td>
      <td><span class="id-code">${escapeHtml(s.id)}</span></td>
      <td><button class="btn btn-primary btn-sm" data-id="${s.id}" data-date="${s.date}">Voir votes</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", () => openScrutinDetail(btn.dataset.id, btn.dataset.date));
  });
}

// ===== OVERLAY : DÉTAIL SCRUTIN =====

async function openScrutinDetail(scrutinId, dateStr) {
  const month = dateStr.slice(0, 7); // "YYYY-MM"
  const pack = await loadData(`scrutins/${month}.json`);
  const s = pack.scrutins.find(x => x.id === scrutinId);
  if (!s) { alert(`Scrutin introuvable`); return; }

  CURRENT_DETAIL = s;
  openOverlay("#overlay");

  document.querySelector("#detail-title").textContent = s.title;
  const counts = s.counts ?? {};
  document.querySelector("#detail-sub").textContent = [
    s.date, s.scrutin_type ?? "", s.result_status ?? "",
    `pour: ${safeNum(counts.for)}`, `contre: ${safeNum(counts.against)}`
  ].filter(Boolean).join(" — ");

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
  if (groupQ) votes = votes.filter(v => {
    return (v.group_acronym ?? v.group_name ?? v.group ?? "").toLowerCase().includes(groupQ);
  });
  if (q) votes = votes.filter(v => {
    return (v.name ?? "").toLowerCase().includes(q) || (v.person_id ?? "").toLowerCase().includes(q);
  });

  votes = [...votes].sort((a, b) => {
    const ga = a.group_acronym ?? a.group ?? "";
    const gb = b.group_acronym ?? b.group ?? "";
    if (ga < gb) return -1;
    if (ga > gb) return 1;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  const tbody = document.querySelector("#votesTable tbody");
  tbody.innerHTML = "";

  for (const v of votes) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a href="#" class="deputy-link" data-pid="${v.person_id}"><strong>${escapeHtml(v.name ?? "")}</strong></a></td>
      <td><a href="#" class="group-link" data-gid="${v.group}"><span class="group-badge">${escapeHtml(v.group_acronym ?? "")}</span></a></td>
      <td>${voteBadgeHtml(v.position)}</td>
      <td>${escapeHtml(v.constituency ?? "")}</td>
      <td><span class="id-code">${escapeHtml(v.person_id ?? "")}</span></td>
    `;
    tbody.appendChild(tr);
  }

  // cross-links
  tbody.querySelectorAll(".deputy-link").forEach(el => {
    el.addEventListener("click", e => { e.preventDefault(); openDeputyProfile(el.dataset.pid); });
  });
  tbody.querySelectorAll(".group-link").forEach(el => {
    el.addEventListener("click", e => { e.preventDefault(); openGroupProfile(el.dataset.gid); });
  });

  document.querySelector("#votesMeta").textContent =
    `${votes.length} votes affichés (sur ${(CURRENT_DETAIL.votes ?? []).length})`;
}

// ===== VUE : DÉPUTÉS =====

function applyDeputyFilters() {
  if (!DEPUTIES) return;
  const q = document.querySelector("#dep-q").value.trim().toLowerCase();
  const groupFilter = document.querySelector("#dep-group-filter").value;

  let deps = DEPUTIES.deputies;
  if (q) deps = deps.filter(d => (d.name ?? "").toLowerCase().includes(q));
  if (groupFilter) deps = deps.filter(d => d.group === groupFilter);

  document.querySelector("#dep-meta").innerHTML =
    `<span class="meta-badge">${deps.length} députés</span>`;

  const tbody = document.querySelector("#deputesTable tbody");
  tbody.innerHTML = "";

  for (const d of deps) {
    const s = d.stats;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a href="#" class="deputy-link" data-pid="${d.person_id}"><strong>${escapeHtml(d.name)}</strong></a></td>
      <td><a href="#" class="group-link" data-gid="${d.group}"><span class="group-badge">${escapeHtml(d.group_acronym ?? "")}</span></a></td>
      <td>${s.total_votes}</td>
      <td class="vote-pour">${s.pct_for}%</td>
      <td class="vote-contre">${s.pct_against}%</td>
      <td>${s.pct_abstain}%</td>
      <td>${s.participation_rate}%</td>
      <td><button class="btn btn-primary btn-sm" data-pid="${d.person_id}">Fiche</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".deputy-link, button[data-pid]").forEach(el => {
    el.addEventListener("click", e => { e.preventDefault(); openDeputyProfile(el.dataset.pid); });
  });
  tbody.querySelectorAll(".group-link").forEach(el => {
    el.addEventListener("click", e => { e.preventDefault(); openGroupProfile(el.dataset.gid); });
  });
}

// ===== OVERLAY : FICHE DÉPUTÉ =====

async function openDeputyProfile(personId) {
  if (!DEPUTIES) return;
  const dep = DEPUTIES.deputies.find(d => d.person_id === personId);
  if (!dep) return;

  CURRENT_DEPUTY = { ...dep, votes: null }; // votes loaded async
  openOverlay("#deputy-overlay");

  document.querySelector("#deputy-name").textContent = dep.name;
  document.querySelector("#deputy-group-info").innerHTML =
    `<a href="#" class="group-link" data-gid="${dep.group}" style="color:inherit;text-decoration:none;">
      <span class="group-badge">${escapeHtml(dep.group_acronym ?? "")}</span>
      ${escapeHtml(dep.group_name ?? "")}
    </a>`;

  document.querySelector("#deputy-group-info .group-link")?.addEventListener("click", e => {
    e.preventDefault();
    openGroupProfile(dep.group);
  });

  const s = dep.stats;
  document.querySelector("#deputy-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${s.total_votes}</div>
      <div class="stat-label">Scrutins</div>
    </div>
    <div class="stat-card stat-pour">
      <div class="stat-value">${s.pct_for}%</div>
      <div class="stat-label">Pour</div>
    </div>
    <div class="stat-card stat-contre">
      <div class="stat-value">${s.pct_against}%</div>
      <div class="stat-label">Contre</div>
    </div>
    <div class="stat-card stat-abstention">
      <div class="stat-value">${s.pct_abstain}%</div>
      <div class="stat-label">Abstention</div>
    </div>
    <div class="stat-card stat-nonvotant">
      <div class="stat-value">${s.nonvoting}</div>
      <div class="stat-label">Non-votant</div>
    </div>
    <div class="stat-card stat-participation">
      <div class="stat-value">${s.participation_rate}%</div>
      <div class="stat-label">Participation</div>
    </div>
  `;

  document.querySelector("#deputy-vq").value = "";
  document.querySelector("#deputy-vpos").value = "";

  // Afficher un message de chargement pendant le chargement des votes
  const tbody = document.querySelector("#deputyVotesTable tbody");
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:24px">Chargement de l'historique...</td></tr>`;

  // Charger tous les scrutins et extraire les votes de ce député
  await loadAllScrutins();
  const allScrutins = getAllScrutinsFromCache();
  const deputyVotes = [];
  for (const sc of allScrutins) {
    const vote = (sc.votes ?? []).find(v => v.person_id === personId);
    if (vote) {
      deputyVotes.push({
        scrutin_id: sc.id,
        date: sc.date,
        title: sc.title,
        position: vote.position,
        result_status: sc.result_status,
      });
    }
  }
  deputyVotes.sort((a, b) => {
    if (a.date > b.date) return -1;
    if (a.date < b.date) return 1;
    return a.scrutin_id > b.scrutin_id ? -1 : 1;
  });

  CURRENT_DEPUTY.votes = deputyVotes;
  renderDeputyVotes();
}

function renderDeputyVotes() {
  if (!CURRENT_DEPUTY || !CURRENT_DEPUTY.votes) return;
  const q = document.querySelector("#deputy-vq").value.trim().toLowerCase();
  const pos = document.querySelector("#deputy-vpos").value;

  let votes = CURRENT_DEPUTY.votes;
  if (pos) votes = votes.filter(v => v.position === pos);
  if (q) votes = votes.filter(v => (v.title ?? "").toLowerCase().includes(q));

  const tbody = document.querySelector("#deputyVotesTable tbody");
  tbody.innerHTML = "";

  for (const v of votes) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.date}</td>
      <td>${escapeHtml(v.title)}</td>
      <td>${voteBadgeHtml(v.position)}</td>
      <td>${resultBadgeHtml(v.result_status)}</td>
    `;
    tbody.appendChild(tr);
  }

  document.querySelector("#deputy-votes-meta").textContent =
    `${votes.length} votes affichés (sur ${CURRENT_DEPUTY.votes.length})`;
}

// ===== VUE : GROUPES =====

function renderGroupsList() {
  if (!GROUPS) return;
  const container = document.querySelector("#groupesList");
  container.innerHTML = "";

  for (const g of GROUPS.groups) {
    const s = g.stats;
    const card = document.createElement("div");
    card.className = "group-card";
    card.dataset.gid = g.group_id;
    card.innerHTML = `
      <div class="group-card-header">
        <div class="group-card-acronym">${escapeHtml(g.acronym)}</div>
        <div>
          <div class="group-card-name">${escapeHtml(g.name)}</div>
          <div class="group-card-members">${g.member_count} membres · Cohésion ${g.cohesion}%</div>
        </div>
      </div>
      <div class="group-card-stats">
        <div class="group-card-stat">
          <span class="group-card-stat-value vote-pour">${s.pct_for ?? 0}%</span>
          <span class="group-card-stat-label">Pour</span>
        </div>
        <div class="group-card-stat">
          <span class="group-card-stat-value vote-contre">${s.pct_against ?? 0}%</span>
          <span class="group-card-stat-label">Contre</span>
        </div>
        <div class="group-card-stat">
          <span class="group-card-stat-value">${s.pct_abstain ?? 0}%</span>
          <span class="group-card-stat-label">Abst.</span>
        </div>
        <div class="group-card-stat">
          <span class="group-card-stat-value" style="color:#6b7280">${s.pct_nonvoting ?? 0}%</span>
          <span class="group-card-stat-label">Non-vot.</span>
        </div>
      </div>
    `;
    card.addEventListener("click", () => openGroupProfile(g.group_id));
    container.appendChild(card);
  }
}

// ===== OVERLAY : FICHE GROUPE =====

async function openGroupProfile(groupId) {
  if (!GROUPS) return;
  const g = GROUPS.groups.find(x => x.group_id === groupId);
  if (!g) return;

  CURRENT_GROUP = { ...g, per_scrutin: null };
  openOverlay("#group-overlay");

  document.querySelector("#group-name").textContent = `${g.acronym} — ${g.name}`;
  document.querySelector("#group-sub").textContent = `${g.member_count} membres · Cohésion: ${g.cohesion}%`;

  const s = g.stats;
  document.querySelector("#group-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${s.total_group_votes}</div>
      <div class="stat-label">Votes totaux</div>
    </div>
    <div class="stat-card stat-pour">
      <div class="stat-value">${s.pct_for ?? 0}%</div>
      <div class="stat-label">Pour</div>
    </div>
    <div class="stat-card stat-contre">
      <div class="stat-value">${s.pct_against ?? 0}%</div>
      <div class="stat-label">Contre</div>
    </div>
    <div class="stat-card stat-abstention">
      <div class="stat-value">${s.pct_abstain ?? 0}%</div>
      <div class="stat-label">Abstention</div>
    </div>
    <div class="stat-card stat-nonvotant">
      <div class="stat-value">${s.pct_nonvoting ?? 0}%</div>
      <div class="stat-label">Non-votant</div>
    </div>
    <div class="stat-card stat-participation">
      <div class="stat-value">${g.cohesion}%</div>
      <div class="stat-label">Cohésion</div>
    </div>
  `;

  // Membres
  const membersEl = document.querySelector("#group-members");
  membersEl.innerHTML = "";
  for (const m of g.members) {
    const chip = document.createElement("button");
    chip.className = "member-chip";
    chip.textContent = m.name;
    chip.addEventListener("click", () => openDeputyProfile(m.person_id));
    membersEl.appendChild(chip);
  }

  // Chargement on-demand des votes du groupe
  const tbody = document.querySelector("#groupVotesTable tbody");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:24px">Chargement des votes...</td></tr>`;

  await loadAllScrutins();
  const allScrutins = getAllScrutinsFromCache();

  // Construire le per_scrutin pour ce groupe
  const memberIds = new Set(g.members.map(m => m.person_id));
  const perScrutin = [];
  const positions = ["for", "against", "abstain", "nonvoting"];
  const posKeyMap = { FOR: "for", AGAINST: "against", ABSTAIN: "abstain", NONVOTING: "nonvoting" };

  for (const sc of allScrutins) {
    const counts = { for: 0, against: 0, abstain: 0, nonvoting: 0 };
    let hasVotes = false;
    for (const v of (sc.votes ?? [])) {
      if (v.group === groupId || memberIds.has(v.person_id)) {
        const pk = posKeyMap[v.position];
        if (pk) { counts[pk]++; hasVotes = true; }
      }
    }
    if (!hasVotes) continue;

    const total = counts.for + counts.against + counts.abstain + counts.nonvoting;
    let majorityPos = null;
    if (total > 0) {
      const maxVal = Math.max(...positions.map(p => counts[p]));
      majorityPos = positions.find(p => counts[p] === maxVal);
    }

    perScrutin.push({
      scrutin_id: sc.id,
      date: sc.date,
      title: sc.title,
      group_counts: counts,
      majority_position: majorityPos,
    });
  }

  perScrutin.sort((a, b) => {
    if (a.date > b.date) return -1;
    if (a.date < b.date) return 1;
    return a.scrutin_id > b.scrutin_id ? -1 : 1;
  });

  CURRENT_GROUP.per_scrutin = perScrutin;

  tbody.innerHTML = "";
  for (const ps of perScrutin) {
    const gc = ps.group_counts;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${ps.date}</td>
      <td>${escapeHtml(ps.title)}</td>
      <td class="vote-pour">${gc.for}</td>
      <td class="vote-contre">${gc.against}</td>
      <td>${gc.abstain}</td>
      <td>${voteBadgeHtml(ps.majority_position ? ps.majority_position.toUpperCase() : "")}</td>
    `;
    tbody.appendChild(tr);
  }
  document.querySelector("#group-votes-meta").textContent =
    `${perScrutin.length} scrutins`;
}

// ===== INIT =====

async function init() {
  INDEX = await loadData("index.json");
  THEMES = await loadData("themes.json");

  // charger deputies et groups (pas bloquant si absent)
  try { DEPUTIES = await loadData("deputies.json"); } catch { DEPUTIES = null; }
  try { GROUPS = await loadData("groups.json"); } catch { GROUPS = null; }

  // thèmes dropdown
  const labelMap = {};
  for (const t of (THEMES.themes ?? [])) labelMap[t.slug] = t.label ?? t.slug;
  labelMap["autre"] = "Autre";
  const dataThemes = new Set();
  for (const s of (INDEX.scrutins ?? [])) {
    for (const t of (s.themes ?? [])) dataThemes.add(t);
  }
  const allSlugs = uniq([...Object.keys(labelMap), ...dataThemes]);
  const themeSel = document.querySelector("#theme");
  for (const slug of allSlugs) {
    const opt = document.createElement("option");
    opt.value = slug;
    opt.textContent = labelMap[slug] ?? slug;
    themeSel.appendChild(opt);
  }

  // groupe filter dropdown (vue députés)
  if (GROUPS) {
    const groupSel = document.querySelector("#dep-group-filter");
    for (const g of GROUPS.groups) {
      const opt = document.createElement("option");
      opt.value = g.group_id;
      opt.textContent = `${g.acronym} — ${g.name}`;
      groupSel.appendChild(opt);
    }
  }

  // navigation
  setupNavigation();

  // scrutins filters
  ["q", "result", "theme"].forEach(id => {
    const el = document.querySelector(`#${id}`);
    el.addEventListener("input", applyScrutinFilters);
    el.addEventListener("change", applyScrutinFilters);
  });

  // deputies filters
  ["dep-q", "dep-group-filter"].forEach(id => {
    const el = document.querySelector(`#${id}`);
    if (el) {
      el.addEventListener("input", applyDeputyFilters);
      el.addEventListener("change", applyDeputyFilters);
    }
  });

  // scrutin overlay
  document.querySelector("#close").addEventListener("click", () => {
    closeOverlay("#overlay");
    CURRENT_DETAIL = null;
  });
  document.querySelector("#overlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) { closeOverlay("#overlay"); CURRENT_DETAIL = null; }
  });
  document.querySelector("#vq").addEventListener("input", () => CURRENT_DETAIL && renderVotes());
  document.querySelector("#vpos").addEventListener("change", () => CURRENT_DETAIL && renderVotes());
  document.querySelector("#vgroup").addEventListener("input", () => CURRENT_DETAIL && renderVotes());

  // deputy overlay
  document.querySelector("#deputy-close").addEventListener("click", () => {
    closeOverlay("#deputy-overlay");
    CURRENT_DEPUTY = null;
  });
  document.querySelector("#deputy-overlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) { closeOverlay("#deputy-overlay"); CURRENT_DEPUTY = null; }
  });
  document.querySelector("#deputy-vq").addEventListener("input", () => CURRENT_DEPUTY && renderDeputyVotes());
  document.querySelector("#deputy-vpos").addEventListener("change", () => CURRENT_DEPUTY && renderDeputyVotes());

  // group overlay
  document.querySelector("#group-close").addEventListener("click", () => {
    closeOverlay("#group-overlay");
    CURRENT_GROUP = null;
  });
  document.querySelector("#group-overlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) { closeOverlay("#group-overlay"); CURRENT_GROUP = null; }
  });

  // render initial views
  applyScrutinFilters();
  applyDeputyFilters();
  renderGroupsList();
}

init().catch(err => {
  document.querySelector("#meta").textContent = `Erreur: ${err.message}`;
});
