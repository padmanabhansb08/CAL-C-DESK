"""PostgreSQL-compatible port of default_rosters.py for Vercel + Neon."""
import json
import re
import uuid

from ffk_core import weekly

VERSION = "season11-poster-defaults-v1"
VINI_VERSION = "ffk-vini-default-v1"
VINI_MEMBERS = ["FFK VINI", "FFK BALA", "FFK HAKAI", "FFK PADHU"]

LISTS = [
    [
        ["DEEPAK", "NONAME", "NARUTO", "XEBEC"],
        ["KO OBITO", "TOM", "ERDOR", "BANKAI", "KO TOBI"],
        ["ARTLORD", "ZEN", "DEVIL", "KAIPULLA"],
        ["SANJAY 1M", "DINESH", "SPEED", "NIVASH"],
        ["AUTOBOTS", "ITACHI", "APPU", "SURVESH"],
        ["BABIN", "PRIME", "ZOROX", "LORD"],
        ["PARTHI", "HUNTER07", "CRIMINAL", "SHADOW"],
        ["PRAGA", "NINJA", "GOKUL", "HARISH"],
        ["BOBBY", "SCARY05", "WHITE", "PRAVIN"],
        ["RAM", "BALA", "ZORO", "VEGITO"],
        ["KAKASHI", "RAVI", "NOBITA", "PRAVEEN"],
        ["KARTHIK", "ROCK", "AYANAKOJI", "TOBI"],
    ],
    [
        ["SANJAY", "VARUN", "DARK", "FLASH"],
        ["JEEVAN", "IZUME", "VISHAL", "SASUKE"],
        ["SUHAS", "KILLER", "YZZZ", "GOJO"],
        ["AUTO BOTS", "ITACHI", "APPU", "SARVESH"],
        ["VICKY", "AURA", "SNIPER", "ZORO"],
        ["CAPS", "EREN", "DRAGON", "VALIANT"],
        ["VETRI.15", "APEX", "KAVI", "DRAGEN"],
        ["MANI", "GOKU", "SPIDER", "ALONE"],
        ["GOAT", "COBRA07", "PIRAI", "KAKASHI"],
        ["SELVA", "ABINES", "NIVI", "VASANTH"],
        ["FLASH", "PRADEEP", "PIKACHU", "SNIPER"],
        ["PUGHAL", "PRIYAN", "KARTHI", "JAGU"],
    ],
]


def key(value):
    return re.sub(r"[^a-z0-9]", "", value.lower()).replace("ffk", "")


def _pg_get(db, k):
    with db.cursor() as cur:
        cur.execute("SELECT value FROM settings WHERE key=%s", (k,))
        row = cur.fetchone()
        return row[0] if row else None


def _pg_put(db, k, v):
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO settings (key,value) VALUES (%s,%s) "
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
            (k, v),
        )


def initialize(db):
    _initialize_poster_rosters(db)
    _initialize_vini_roster(db)
    _initialize_set_a_week(db)
    db.commit()


def _initialize_set_a_week(db):
    if _pg_get(db, weekly.VERSION):
        return
    raw = _pg_get(db, "state")
    state = json.loads(raw) if raw else {"teams": [], "matches": []}
    weekly.apply_set_a(state)
    _pg_put(db, "state", json.dumps(state))
    _pg_put(db, weekly.VERSION, "applied")


def _initialize_poster_rosters(db):
    if _pg_get(db, VERSION):
        return
    raw = _pg_get(db, "state")
    state = json.loads(raw) if raw else {"teams": [], "matches": []}
    remaining = list(state["teams"])
    teams = []

    for list_number, squads in enumerate(LISTS, 1):
        for slot, members in enumerate(squads, 1):
            captain = key(members[0])
            old = next((t for t in remaining if key(t["name"]) == captain), None)
            if old:
                remaining.remove(old)
            team = dict(old) if old else {"id": str(uuid.uuid4())}
            previous = old.get("players", []) if old else []
            team.update(name="FFK " + members[0], slot=slot, rosterList=list_number, players=[])
            for i, member in enumerate(members):
                name = "FFK " + member
                player = next((p for p in previous if key(p["name"]) == key(name)), None)
                if player is None and i < len(previous):
                    candidate = previous[i]
                    if not any(p["id"] == candidate["id"] for p in team["players"]):
                        player = candidate
                team["players"].append(
                    {"id": player["id"] if player else str(uuid.uuid4()), "name": name, "isCaptain": i == 0}
                )
            teams.append(team)

    state["teams"] = teams + remaining
    _pg_put(db, "state", json.dumps(state))
    _pg_put(db, VERSION, "applied")


def _initialize_vini_roster(db):
    if _pg_get(db, VINI_VERSION):
        return
    raw = _pg_get(db, "state")
    state = json.loads(raw) if raw else {"teams": [], "matches": []}
    teams = state.setdefault("teams", [])
    existing = next((t for t in teams if key(t["name"]) == key("FFK VINI")), None)
    changed = False

    if existing is None:
        teams.append({
            "id": str(uuid.uuid4()),
            "name": "FFK VINI",
            "players": [
                {"id": str(uuid.uuid4()), "name": name, "isCaptain": i == 0}
                for i, name in enumerate(VINI_MEMBERS)
            ],
        })
        changed = True
    else:
        requested = {key(name): name for name in VINI_MEMBERS}
        for player in existing.get("players", []):
            name = player.get("name", "")
            canonical = requested.get(key(name))
            if canonical and not name.strip().upper().startswith("FFK"):
                player["name"] = canonical
                changed = True

    if changed:
        _pg_put(db, "state", json.dumps(state))
    _pg_put(db, VINI_VERSION, "applied")
