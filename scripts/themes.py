import json
from pathlib import Path


def load_themes(path: Path) -> dict:
    """
    Charge data/themes.json.
    Si le fichier n'existe pas, retourne une config vide.
    """
    if not path.exists():
        return {"themes": [], "overrides": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def assign_themes(scrutins: list[dict], cfg: dict) -> list[dict]:
    """
    Assigne des thèmes par mots-clés + overrides manuels.
    - overrides: { "AN-17-1234": ["budget"] }
    - themes: [{slug,label,keywords:[...]}]
    """
    themes = cfg.get("themes", [])
    overrides = cfg.get("overrides", {})

    for s in scrutins:
        sid = s["id"]

        # 1) override manuel
        if sid in overrides:
            s["themes"] = overrides[sid]
            continue

        # 2) mots-clés
        hay = f'{s.get("title","")} {s.get("object","")}'.lower()
        found = []
        for t in themes:
            for kw in t.get("keywords", []):
                if kw.lower() in hay:
                    found.append(t["slug"])
                    break

        s["themes"] = sorted(set(found)) if found else ["autre"]

    return scrutins