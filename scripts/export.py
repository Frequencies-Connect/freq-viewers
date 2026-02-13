import json
from pathlib import Path
from collections import defaultdict


def _write_json(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def export_all(data_dir: Path, scrutins: list[dict], generated_at: str,
               deputies: list[dict] = None, groups: list[dict] = None):
    """
    Ecrit:
    - data/index.json (liste filtrable)
    - data/people.json (référentiel minimal)
    - data/scrutins/YYYY.json (détails + votes)
    """
    # index léger
    index_items = []
    for s in scrutins:
        index_items.append(
            {
                "id": s["id"],
                "chamber": s["chamber"],
                "date": s["date"],
                "title": s["title"],
                "scrutin_type": s.get("scrutin_type"),
                "result_status": s.get("result_status"),
                "counts": s.get("counts"),
                "themes": s.get("themes", []),
                "source_url": s.get("source_url"),
            }
        )
    index_items.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
    # liste des mois disponibles pour le chargement on-demand
    months = sorted(set(s["date"][:7] for s in scrutins))
    _write_json(data_dir / "index.json", {
        "generated_at": generated_at,
        "months": months,
        "scrutins": index_items,
    })

    # people minimal (on enrichira plus tard)
    people_map = {}
    for s in scrutins:
        for v in s.get("votes", []):
            pid = v["person_id"]
            if pid not in people_map:
                people_map[pid] = {"person_id": pid, "name": v.get("name"), "chamber": s["chamber"]}
            if v.get("group"):
                people_map[pid]["group"] = v["group"]
            if v.get("constituency"):
                people_map[pid]["constituency"] = v["constituency"]
            if v.get("name"):
                people_map[pid]["name"] = v["name"]

    people_list = sorted(people_map.values(), key=lambda p: ((p.get("name") or ""), p["person_id"]))
    _write_json(data_dir / "people.json", {"generated_at": generated_at, "people": people_list})

    # détails par mois (YYYY-MM) pour éviter les fichiers > 100 Mo
    by_month = defaultdict(list)
    for s in scrutins:
        month_key = s["date"][:7]  # "2025-03"
        by_month[month_key].append(s)

    for month_key, items in by_month.items():
        items.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
        _write_json(data_dir / "scrutins" / f"{month_key}.json",
                    {"month": month_key, "scrutins": items})

    # fiches députés
    if deputies is not None:
        _write_json(data_dir / "deputies.json", {
            "generated_at": generated_at,
            "deputies": deputies,
        })

    # fiches groupes
    if groups is not None:
        _write_json(data_dir / "groups.json", {
            "generated_at": generated_at,
            "groups": groups,
        })