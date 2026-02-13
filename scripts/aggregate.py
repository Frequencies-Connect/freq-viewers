"""
Agrégation des données par député et par groupe politique.
Produit des statistiques de vote pré-calculées pour le frontend.
"""


def aggregate_deputies(scrutins: list[dict]) -> list[dict]:
    """
    Pour chaque député, calcule ses stats de vote et son historique.
    """
    dep_map: dict = {}

    for s in scrutins:
        for v in s.get("votes", []):
            pid = v["person_id"]
            if pid not in dep_map:
                dep_map[pid] = {
                    "person_id": pid,
                    "name": v.get("name"),
                    "group": v.get("group"),
                    "group_acronym": v.get("group_acronym"),
                    "group_name": v.get("group_name"),
                    "chamber": s["chamber"],
                    "counts": {"FOR": 0, "AGAINST": 0, "ABSTAIN": 0, "NONVOTING": 0},
                }

            d = dep_map[pid]
            # garder le nom/groupe le plus récent
            if v.get("name"):
                d["name"] = v["name"]
            if v.get("group"):
                d["group"] = v["group"]
                d["group_acronym"] = v.get("group_acronym")
                d["group_name"] = v.get("group_name")

            pos = v["position"]
            if pos in d["counts"]:
                d["counts"][pos] += 1

    result = []
    for d in dep_map.values():
        c = d["counts"]
        total = sum(c.values())
        stats = {
            "total_votes": total,
            "for": c["FOR"],
            "against": c["AGAINST"],
            "abstain": c["ABSTAIN"],
            "nonvoting": c["NONVOTING"],
        }
        if total > 0:
            stats["pct_for"] = round(c["FOR"] / total * 100, 1)
            stats["pct_against"] = round(c["AGAINST"] / total * 100, 1)
            stats["pct_abstain"] = round(c["ABSTAIN"] / total * 100, 1)
            stats["pct_nonvoting"] = round(c["NONVOTING"] / total * 100, 1)
            stats["participation_rate"] = round((total - c["NONVOTING"]) / total * 100, 1)
        else:
            stats.update({
                "pct_for": 0, "pct_against": 0,
                "pct_abstain": 0, "pct_nonvoting": 0,
                "participation_rate": 0,
            })

        result.append({
            "person_id": d["person_id"],
            "name": d["name"],
            "group": d["group"],
            "group_acronym": d.get("group_acronym"),
            "group_name": d.get("group_name"),
            "chamber": d["chamber"],
            "stats": stats,
        })

    result.sort(key=lambda x: (x.get("name") or "", x["person_id"]))
    return result


def aggregate_groups(scrutins: list[dict], deputies: list[dict]) -> list[dict]:
    """
    Pour chaque groupe politique, calcule les stats agrégées,
    la cohésion et la liste des membres.
    """
    group_map: dict = {}

    # init groupes depuis les fiches députés
    for dep in deputies:
        gid = dep.get("group")
        if not gid:
            continue
        if gid not in group_map:
            group_map[gid] = {
                "group_id": gid,
                "acronym": dep.get("group_acronym", ""),
                "name": dep.get("group_name", "Groupe inconnu"),
                "members": {},
                "counts": {"FOR": 0, "AGAINST": 0, "ABSTAIN": 0, "NONVOTING": 0},
                "per_scrutin_data": {},
            }
        group_map[gid]["members"][dep["person_id"]] = dep["name"]

    # accumuler les votes par scrutin par groupe
    pos_key_map = {
        "FOR": "for", "AGAINST": "against",
        "ABSTAIN": "abstain", "NONVOTING": "nonvoting",
    }

    for s in scrutins:
        for v in s.get("votes", []):
            gid = v.get("group")
            if not gid or gid not in group_map:
                continue
            g = group_map[gid]
            pos = v["position"]
            if pos in g["counts"]:
                g["counts"][pos] += 1

            sid = s["id"]
            if sid not in g["per_scrutin_data"]:
                g["per_scrutin_data"][sid] = {
                    "scrutin_id": sid,
                    "date": s["date"],
                    "title": s["title"],
                    "for": 0, "against": 0, "abstain": 0, "nonvoting": 0,
                }
            pk = pos_key_map.get(pos)
            if pk:
                g["per_scrutin_data"][sid][pk] += 1

    # calcul stats, cohésion, finalisation
    positions = ["for", "against", "abstain", "nonvoting"]
    result = []

    for g in group_map.values():
        c = g["counts"]
        total = sum(c.values())
        stats = {
            "total_group_votes": total,
            "for": c["FOR"],
            "against": c["AGAINST"],
            "abstain": c["ABSTAIN"],
            "nonvoting": c["NONVOTING"],
        }
        if total > 0:
            stats["pct_for"] = round(c["FOR"] / total * 100, 1)
            stats["pct_against"] = round(c["AGAINST"] / total * 100, 1)
            stats["pct_abstain"] = round(c["ABSTAIN"] / total * 100, 1)
            stats["pct_nonvoting"] = round(c["NONVOTING"] / total * 100, 1)
        else:
            stats.update({
                "pct_for": 0, "pct_against": 0,
                "pct_abstain": 0, "pct_nonvoting": 0,
            })

        # cohésion : pour chaque scrutin, part de la position majoritaire
        cohesion_scores = []
        per_scrutin = []
        for psd in g["per_scrutin_data"].values():
            counts = [psd[p] for p in positions]
            total_in_scrutin = sum(counts)
            majority_pos = None
            if total_in_scrutin > 0:
                majority = max(counts)
                cohesion_scores.append(majority / total_in_scrutin)
                majority_pos = positions[counts.index(majority)]

            per_scrutin.append({
                "scrutin_id": psd["scrutin_id"],
                "date": psd["date"],
                "title": psd["title"],
                "group_counts": {p: psd[p] for p in positions},
                "majority_position": majority_pos,
            })

        per_scrutin.sort(key=lambda x: (x["date"], x["scrutin_id"]), reverse=True)

        cohesion = round(
            sum(cohesion_scores) / len(cohesion_scores) * 100, 1
        ) if cohesion_scores else 0

        members_list = [
            {"person_id": pid, "name": name}
            for pid, name in g["members"].items()
        ]
        members_list.sort(key=lambda x: (x["name"] or "", x["person_id"]))

        result.append({
            "group_id": g["group_id"],
            "acronym": g["acronym"],
            "name": g["name"],
            "member_count": len(members_list),
            "stats": stats,
            "cohesion": cohesion,
            "members": members_list,
        })

    result.sort(key=lambda x: (-x["member_count"], x["name"]))
    return result
