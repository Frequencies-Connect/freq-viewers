from datetime import datetime, timezone
from pathlib import Path
import shutil

from sources.an import fetch_an_scrutins
from normalize import normalize_an
from themes import load_themes, assign_themes
from aggregate import aggregate_deputies, aggregate_groups
from export import export_all


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"


def main():
    generated_at = datetime.now(timezone.utc).isoformat()

    cfg = load_themes(DATA_DIR / "themes.json")

    raw_an = fetch_an_scrutins()
    scrutins = normalize_an(raw_an)

    scrutins = assign_themes(scrutins, cfg)
    
    # ✅ CLEAN BUILD: supprimer les anciens fichiers par année
    scrutins_dir = DATA_DIR / "scrutins"
    if scrutins_dir.exists():
        shutil.rmtree(scrutins_dir)
    scrutins_dir.mkdir(parents=True, exist_ok=True)

    # agrégation par député et par groupe
    deputies = aggregate_deputies(scrutins)
    groups = aggregate_groups(scrutins, deputies)

    export_all(DATA_DIR, scrutins, generated_at, deputies, groups)

    print(f"OK: {len(scrutins)} scrutins AN exportés.")
    print(f"OK: {len(deputies)} fiches députés, {len(groups)} fiches groupes.")


if __name__ == "__main__":
    main()