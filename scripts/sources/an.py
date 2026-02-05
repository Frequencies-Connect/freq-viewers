import zipfile
from pathlib import Path
import json

import httpx
from lxml import etree

AN_LEGISLATURE = "17"

AN_ZIP_URL = (
    "http://data.assemblee-nationale.fr/static/openData/repository/"
    "17/loi/scrutins/Scrutins.xml.zip"
)

AN_ACTEURS_URL = (
    "https://data.assemblee-nationale.fr/static/openData/repository/"
    "17/amo/deputes_actifs_mandats_actifs_organes/"
    "AMO10_deputes_actifs_mandats_actifs_organes.json.zip"
)


# ---------------------------------------------------------------------------
# Utils
# ---------------------------------------------------------------------------

def _cache_dir() -> Path:
    return Path(".cache") / "an"


def _download(url: str, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"📥 Téléchargement de {dest.name}...")
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    print(f"✅ {dest.name} téléchargé")


def _date_only(s: str | None) -> str | None:
    if not s:
        return None
    return s.strip().split("T")[0]


def _norm_result(s: str | None) -> str | None:
    if not s:
        return None
    low = s.strip().lower()
    if "adopt" in low:
        return "adopted"
    if "rejet" in low:
        return "rejected"
    return low


def _first_text(node, local_name: str) -> str | None:
    v = node.xpath(f"string(.//*[local-name()='{local_name}'][1])")
    v = v.strip() if isinstance(v, str) else ""
    return v or None


# ---------------------------------------------------------------------------
# Votes
# ---------------------------------------------------------------------------

def _extract_votes(scrutin_node) -> list[dict]:
    votes = []

    bucket_to_pos = {
        "pour": "FOR",
        "pours": "FOR",
        "contre": "AGAINST",
        "contres": "AGAINST",
        "abstention": "ABSTAIN",
        "abstentions": "ABSTAIN",
        "nonVotant": "NONVOTING",
        "nonvotant": "NONVOTING",
        "nonVotants": "NONVOTING",
    }

    actor_nodes = scrutin_node.xpath(".//*[local-name()='acteurRef']")
    for a in actor_nodes:
        pid = (a.text or "").strip()
        if not pid:
            continue

        pos = None
        group = None

        cur = a
        for _ in range(30):
            cur = cur.getparent()
            if cur is None:
                break

            lname = cur.tag.split("}")[-1]

            if pos is None and lname in bucket_to_pos:
                pos = bucket_to_pos[lname]

            if group is None:
                g = cur.xpath("string(.//*[local-name()='organeRef'][1])")
                g = g.strip() if isinstance(g, str) else ""
                if g:
                    group = g

            if pos and group:
                break

        if not pos:
            continue

        votes.append(
            {
                "person_id": pid,
                "position": pos,
                "group": group,
                "constituency": None,
                "name": None,
            }
        )

    # dédoublonnage
    seen = set()
    uniq = []
    for v in votes:
        k = (v["person_id"], v["position"], v["group"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(v)

    return uniq


# ---------------------------------------------------------------------------
# Scrutin XML
# ---------------------------------------------------------------------------

def _parse_one_xml(fileobj) -> list[dict]:
    try:
        tree = etree.parse(fileobj)
        el = tree.getroot()

        numero = _first_text(el, "numero") or "UNKNOWN"
        date = _date_only(_first_text(el, "dateScrutin")) or "1970-01-01"
        title = _first_text(el, "objet") or "(sans titre)"

        scrutin_type = (
            el.xpath(
                "string(.//*[local-name()='typeScrutin']"
                "//*[local-name()='libelle'][1])"
            ).strip()
            or None
        )

        result_status = _norm_result(
            el.xpath(
                "string(.//*[local-name()='syntheseVote']"
                "//*[local-name()='resultat'][1])"
            ).strip()
            or None
        )

        counts = {}

        def count_of(name: str):
            v = el.xpath(
                f"string(.//*[local-name()='decompte']"
                f"//*[local-name()='{name}'][1])"
            )
            v = v.strip() if isinstance(v, str) else ""
            return int(v) if v.isdigit() else None

        for k, lname in [
            ("for", "pour"),
            ("against", "contre"),
            ("abstention", "abstention"),
            ("nonvoting", "nonVotant"),
        ]:
            c = count_of(lname)
            if c is not None:
                counts[k] = c

        votes = _extract_votes(el)

        return [
            {
                "id": f"AN-{AN_LEGISLATURE}-{numero}",
                "date": date,
                "title": title,
                "object": None,
                "scrutin_type": scrutin_type,
                "result_status": result_status,
                "counts": counts or None,
                "source_url": None,
                "votes": votes,
            }
        ]

    except Exception:
        return []


# ---------------------------------------------------------------------------
# Acteurs & organes
# ---------------------------------------------------------------------------

def fetch_an_acteurs() -> tuple[dict, dict]:
    """
    Télécharge et parse le(s) dump(s) AN pour:
    - acteurs (députés) : uid -> name
    - organes (groupes) : uid -> name + acronym

    IMPORTANT: selon les dépôts AN, le ZIP peut contenir:
      1) un JSON composite unique (souvent enveloppé dans `export`)
      2) des milliers de JSON unitaires: `json/acteur/PAxxxx.json`, `json/organe/POxxxx.json`, etc.

    Cette fonction gère les deux formats.
    """

    def get_text(x) -> str:
        if isinstance(x, dict):
            return (x.get("#text") or "").strip()
        if isinstance(x, str):
            return x.strip()
        return ""

    def as_list(x):
        if x is None:
            return []
        if isinstance(x, list):
            return x
        return [x]

    cache = _cache_dir()
    zip_path = cache / "Acteurs.json.zip"

    if not zip_path.exists():
        _download(AN_ACTEURS_URL, zip_path)

    acteurs: dict[str, dict] = {}
    organes: dict[str, dict] = {}

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()

        # --- Cas 1: JSON composite unique ---
        json_files = [n for n in names if n.lower().endswith(".json")]
        if json_files:
            # Heuristique: si le ZIP contient très peu de JSON, c'est probablement un composite.
            # (Sinon, on bascule sur le mode multi-fichiers plus bas.)
            if len(json_files) <= 5:
                with zf.open(json_files[0]) as f:
                    data = json.load(f)

                root = data.get("export", data)

                # acteurs
                for a in as_list((root.get("acteurs") or {}).get("acteur")):
                    if not isinstance(a, dict):
                        continue
                    uid = get_text(a.get("uid"))
                    if not uid:
                        continue
                    ident = ((a.get("etatCivil") or {}).get("ident") or {})
                    prenom = get_text(ident.get("prenom"))
                    nom = get_text(ident.get("nom"))
                    full_name = f"{prenom} {nom}".strip()
                    acteurs[uid] = {"name": full_name or "Inconnu"}

                # organes
                for o in as_list((root.get("organes") or {}).get("organe")):
                    if not isinstance(o, dict):
                        continue
                    oid = get_text(o.get("uid"))
                    if not oid:
                        continue
                    libelle = get_text(o.get("libelle"))
                    libelle_abrege = get_text(o.get("libelleAbrege")) or get_text(o.get("libelleAbrev"))
                    organes[oid] = {
                        "name": libelle or "Groupe inconnu",
                        "acronym": libelle_abrege or "",
                    }

                print(f"✅ {len(acteurs)} acteurs chargés")
                print(f"✅ {len(organes)} organes chargés")
                return acteurs, organes

        # --- Cas 2: ZIP multi-fichiers (json/acteur/*.json, json/organe/*.json) ---
        acteur_files = [n for n in names if n.lower().startswith("json/acteur/") and n.lower().endswith(".json")]
        organe_files = [n for n in names if n.lower().startswith("json/organe/") and n.lower().endswith(".json")]

        # Fallback si l'arborescence est légèrement différente
        if not acteur_files:
            acteur_files = [n for n in names if "/acteur/" in n.lower() and n.lower().endswith(".json")]
        if not organe_files:
            organe_files = [n for n in names if "/organe/" in n.lower() and n.lower().endswith(".json")]

        # Parse acteurs unitaires
        for name in acteur_files:
            with zf.open(name) as f:
                data = json.load(f)
            a = data.get("acteur")
            if not isinstance(a, dict):
                continue

            uid = get_text(a.get("uid"))
            if not uid:
                continue

            ident = ((a.get("etatCivil") or {}).get("ident") or {})
            prenom = get_text(ident.get("prenom"))
            nom = get_text(ident.get("nom"))
            full_name = f"{prenom} {nom}".strip()

            acteurs[uid] = {"name": full_name or "Inconnu"}

        # Parse organes unitaires
        for name in organe_files:
            with zf.open(name) as f:
                data = json.load(f)
            o = data.get("organe")
            if not isinstance(o, dict):
                continue

            oid = get_text(o.get("uid"))
            if not oid:
                continue

            libelle = get_text(o.get("libelle"))
            libelle_abrege = get_text(o.get("libelleAbrege")) or get_text(o.get("libelleAbrev"))

            organes[oid] = {
                "name": libelle or "Groupe inconnu",
                "acronym": libelle_abrege or "",
            }

    print(f"✅ {len(acteurs)} acteurs chargés")
    print(f"✅ {len(organes)} organes chargés")
    return acteurs, organes


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_an_scrutins(limit: int = 200) -> list[dict]:
    print("📥 Chargement acteurs / organes…")
    acteurs, organes = fetch_an_acteurs()

    cache = _cache_dir()
    zip_path = cache / "Scrutins.xml.zip"
    if not zip_path.exists():
        _download(AN_ZIP_URL, zip_path)

    scrutins = []
    with zipfile.ZipFile(zip_path) as zf:
        xml_files = [n for n in zf.namelist() if n.endswith(".xml")]
        for i, name in enumerate(xml_files):
            if i % 500 == 0:
                print(f"   … {i}/{len(xml_files)}")
            with zf.open(name) as f:
                scrutins.extend(_parse_one_xml(f))

    print(f"✅ {len(scrutins)} scrutins parsés")

    for s in scrutins:
        for v in s["votes"]:
            pid = v["person_id"]
            gid = v["group"]
            v["name"] = acteurs.get(pid, {}).get("name", "Inconnu")
            if gid:
                v["group_name"] = organes.get(gid, {}).get("name")
                v["group_acronym"] = organes.get(gid, {}).get("acronym")

    uniq = {s["id"]: s for s in scrutins}
    scrutins = sorted(
        uniq.values(),
        key=lambda s: (s["date"], s["id"]),
        reverse=True,
    )

    return scrutins[:limit]