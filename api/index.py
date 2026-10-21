"""FFK War Desk - Vercel + Neon edition (Flask + PostgreSQL)."""
import hashlib, hmac, json, os, secrets, sys, time
from flask import Flask, request, jsonify, make_response
import psycopg2

# Ensure api directory is in sys.path so sibling imports work in Vercel serverless environment
_api_dir = os.path.dirname(os.path.abspath(__file__))
if _api_dir not in sys.path:
    sys.path.insert(0, _api_dir)

try:
    import default_rosters_pg as default_rosters
except ImportError:
    from api import default_rosters_pg as default_rosters

app = Flask(__name__)
DATABASE_URL = os.environ.get("DATABASE_URL", "")


# ---------- DB helpers ----------

def connect():
    return psycopg2.connect(DATABASE_URL)


def ensure_tables():
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    expires_at BIGINT NOT NULL
                )
            """)
        db.commit()
        default_rosters.initialize(db)


def db_get(key):
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("SELECT value FROM settings WHERE key=%s", (key,))
            row = cur.fetchone()
            return row[0] if row else None


def db_put(key, value):
    with connect() as db:
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO settings (key,value) VALUES (%s,%s) "
                "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
                (key, value),
            )
        db.commit()


# ---------- Auth helpers ----------

def get_token():
    return request.cookies.get("ffk", "")


def is_authorized():
    token = get_token()
    if not token:
        return False
    with connect() as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT expires_at FROM sessions WHERE token=%s", (token,)
            )
            row = cur.fetchone()
            return bool(row and row[0] > time.time())


def create_session(token, expires_at):
    with connect() as db:
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO sessions (token,expires_at) VALUES (%s,%s) "
                "ON CONFLICT (token) DO UPDATE SET expires_at=EXCLUDED.expires_at",
                (token, int(expires_at)),
            )
        db.commit()


def delete_session(token):
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE token=%s", (token,))
        db.commit()


def reply(data, status=200, cookie=None):
    resp = make_response(jsonify(data), status)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    if cookie:
        resp.headers["Set-Cookie"] = cookie
    return resp


def err(msg, status=400):
    return reply({"error": msg}, status)


def check_origin():
    origin = request.headers.get("Origin")
    host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host")
    if origin and host and origin.split("://", 1)[-1] != host:
        return False
    return True


def require_json():
    ct = request.headers.get("Content-Type", "").split(";")[0]
    if ct != "application/json":
        return err("JSON required", 415)
    return None


# ---------- Routes ----------

@app.route("/api/session", methods=["GET"])
def api_session():
    return reply({"setup": db_get("password") is None, "authenticated": is_authorized()})


@app.route("/api/state", methods=["GET"])
def api_state_get():
    if not is_authorized():
        return err("Please sign in.", 401)
    return reply(json.loads(db_get("state") or '{"teams":[],"matches":[]}'))


@app.route("/api/state", methods=["POST"])
def api_state_post():
    bad = require_json()
    if bad:
        return bad
    if not check_origin():
        return err("Origin rejected", 403)
    if not is_authorized():
        return err("Please sign in.", 401)

    data = request.get_json(silent=True)
    if not data or not isinstance(data.get("teams"), list) or not isinstance(data.get("matches"), list):
        return err("Invalid war data")

    with connect() as db:
        with db.cursor() as cur:
            cur.execute("SELECT value FROM settings WHERE key=%s", ("state",))
            row = cur.fetchone()
        previous = json.loads(row[0]) if row else {}

        old_war = previous.get("war") or {}
        new_war = data.get("war") or {}
        for stage in ("A", "B", "C"):
            if not old_war.get("qualified", {}).get(stage):
                continue
            if not new_war.get("qualified", {}).get(stage):
                if (stage != "C" and new_war.get("qualified", {}).get("C")) or new_war.get("cs"):
                    return err("Reopening a set must clear downstream qualification and CS results.", 409)
                continue
            old_matches = [m for m in previous.get("matches", []) if m.get("stage") == stage]
            new_matches = [m for m in data["matches"] if m.get("stage") == stage]
            old_members = (
                old_war.get("groups", {}).get(stage)
                if stage != "C"
                else sum((old_war.get("qualified", {}).get(s, []) for s in ("A", "B")), [])
            )
            new_members = (
                new_war.get("groups", {}).get(stage)
                if stage != "C"
                else sum((new_war.get("qualified", {}).get(s, []) for s in ("A", "B")), [])
            )
            if (
                old_matches != new_matches
                or old_members != new_members
                or old_war["qualified"][stage] != new_war["qualified"][stage]
            ):
                return err("Reopen Set " + stage + " in War manager before changing its results or qualifiers.", 409)

        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO settings (key,value) VALUES (%s,%s) "
                "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
                ("state", json.dumps(data)),
            )
        db.commit()

    return reply({"ok": True})


@app.route("/api/login", methods=["POST"])
def api_login():
    bad = require_json()
    if bad:
        return bad
    if not check_origin():
        return err("Origin rejected", 403)

    size = request.content_length or 0
    if size > 2_000_000:
        return err("Request too large", 413)

    data = request.get_json(silent=True) or {}
    password = data.get("password", "")
    stored = db_get("password")

    if not stored:
        if len(password) < 10:
            return err("Use at least 10 characters.")
        salt = secrets.token_hex(16)
        stored = salt + ":" + hashlib.scrypt(
            password.encode(), salt=salt.encode(), n=16384, r=8, p=1
        ).hex()
        db_put("password", stored)

    salt, expected = stored.split(":")
    actual = hashlib.scrypt(
        password.encode(), salt=salt.encode(), n=16384, r=8, p=1
    ).hex()
    if not hmac.compare_digest(actual, expected):
        time.sleep(1)
        return err("Incorrect password", 401)

    token = secrets.token_urlsafe(32)
    expires = time.time() + 43200
    create_session(token, expires)
    return reply({"ok": True}, cookie=f"ffk={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200")


@app.route("/api/logout", methods=["POST"])
def api_logout():
    bad = require_json()
    if bad:
        return bad
    if not check_origin():
        return err("Origin rejected", 403)
    token = get_token()
    if token:
        delete_session(token)
    return reply({"ok": True}, cookie="ffk=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")


@app.route("/api/host/state", methods=["GET"])
def api_host_state():
    key = request.headers.get("X-Host-Key", "")
    expected = db_get("host_access_key")
    if not is_authorized() and not (expected and key and hmac.compare_digest(key, expected)):
        return err("Open a current host link from your organizer.", 401)
    current = json.loads(db_get("state") or '{"teams":[],"matches":[]}')
    return reply({"teams": current["teams"], "matches": current["matches"]})


@app.route("/api/host/access", methods=["POST"])
def api_host_access():
    bad = require_json()
    if bad:
        return bad
    if not check_origin():
        return err("Origin rejected", 403)
    if not is_authorized():
        return err("Please sign in.", 401)
    data = request.get_json(silent=True) or {}
    key = db_get("host_access_key")
    if data.get("rotate") or not key:
        key = secrets.token_urlsafe(32)
        db_put("host_access_key", key)
    return reply({"key": key})


@app.route("/api/matches/delete", methods=["POST"])
def api_matches_delete():
    bad = require_json()
    if bad:
        return bad
    if not check_origin():
        return err("Origin rejected", 403)
    if not is_authorized():
        return err("Please sign in.", 401)

    data = request.get_json(silent=True) or {}
    match_id = data.get("id")
    if not isinstance(match_id, str) or not match_id:
        return err("Select a saved match.")

    with connect() as db:
        with db.cursor() as cur:
            cur.execute("SELECT value FROM settings WHERE key=%s", ("state",))
            row = cur.fetchone()
        current = json.loads(row[0]) if row else {"teams": [], "matches": []}
        target = next((m for m in current["matches"] if m.get("id") == match_id), None)
        if target and current.get("war", {}).get("qualified", {}).get(target.get("stage")):
            return err("Reopen this set in War manager before deleting its results.", 409)
        remaining = [m for m in current["matches"] if m.get("id") != match_id]
        if len(remaining) == len(current["matches"]):
            return err("This match has already been removed. Refresh the page.", 404)
        current["matches"] = remaining
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO settings (key,value) VALUES (%s,%s) "
                "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
                ("state", json.dumps(current)),
            )
        db.commit()

    return reply(current)


@app.route("/api/ocr/status", methods=["GET"])
def api_ocr_status():
    if not is_authorized():
        return err("Please sign in.", 401)
    return reply({"available": False})  # Server-side OCR not available on Vercel


@app.route("/api/ocr", methods=["POST"])
def api_ocr():
    return err("Server-side OCR is not available in this deployment.", 400)


# Initialise tables on first cold start
try:
    ensure_tables()
except Exception as e:
    print("DB init deferred:", e)
