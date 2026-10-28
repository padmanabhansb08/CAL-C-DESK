"""FFK War Desk - Vercel + Neon edition (Flask + PostgreSQL).

Behaviour matches server.py: same body limits, setup protection, login lockout, cookie flags,
and locked read-modify-write of the war state. Server-side OCR is not available on serverless;
the browser reader is used instead.
"""
import hmac, json, os, secrets, sys, time
from flask import Flask, request, jsonify, make_response
import psycopg2

# Sibling imports must work both locally and in the Vercel serverless bundle.
_api_dir = os.path.dirname(os.path.abspath(__file__))
for _path in (_api_dir, os.path.dirname(_api_dir)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

try:
    import default_rosters_pg as default_rosters
except ImportError:
    from api import default_rosters_pg as default_rosters
from ffk_core import policy

app = Flask(__name__)
# Flask refuses oversized bodies itself, before any route code reads them.
app.config["MAX_CONTENT_LENGTH"] = policy.MAX_BODY
DATABASE_URL = os.environ.get("DATABASE_URL", "")
STATE_LOCK = "ffk-war-state"


# ---------- DB helpers ----------

def connect():
    return psycopg2.connect(DATABASE_URL)


def ensure_tables():
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            cur.execute("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires_at BIGINT NOT NULL)")
            cur.execute(
                "CREATE TABLE IF NOT EXISTS login_attempts ("
                "ip TEXT PRIMARY KEY, failures INT NOT NULL, window_start BIGINT NOT NULL, locked_until BIGINT NOT NULL)"
            )
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


def lock_state(cur):
    """Serialise whole-state read-modify-write across serverless instances until commit."""
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (STATE_LOCK,))


# ---------- Auth helpers ----------

def get_token():
    return request.cookies.get("ffk", "")


def is_authorized():
    token = get_token()
    if not token:
        return False
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("SELECT expires_at FROM sessions WHERE token=%s", (token,))
            row = cur.fetchone()
            return bool(row and row[0] > time.time())


def create_session(token, expires_at):
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE expires_at < %s", (int(time.time()),))
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


def caller():
    return policy.client_ip(request.headers, request.remote_addr)


def retry_after(ip):
    now = int(time.time())
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("SELECT locked_until FROM login_attempts WHERE ip=%s", (ip,))
            row = cur.fetchone()
            wait = max(0, row[0] - now) if row else 0
            cur.execute(
                "SELECT COALESCE(SUM(failures),0) FROM login_attempts WHERE window_start > %s", (now - 60,)
            )
            if cur.fetchone()[0] >= policy.GLOBAL_FAILURES_PER_MINUTE:
                wait = max(wait, 60)
            return wait


def record_failure(ip):
    now = int(time.time())
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("SELECT failures, window_start FROM login_attempts WHERE ip=%s", (ip,))
            row = cur.fetchone()
            failures, start = (row if row else (0, now))
            if now - start > policy.WINDOW_SECONDS:
                failures, start = 0, now
            failures += 1
            locked_until = 0
            if failures >= policy.FAILURES_BEFORE_LOCK:
                locked_until, failures = now + policy.LOCK_SECONDS, 0
            cur.execute(
                "INSERT INTO login_attempts (ip,failures,window_start,locked_until) VALUES (%s,%s,%s,%s) "
                "ON CONFLICT (ip) DO UPDATE SET failures=EXCLUDED.failures, "
                "window_start=EXCLUDED.window_start, locked_until=EXCLUDED.locked_until",
                (ip, failures, start, locked_until),
            )
        db.commit()


def clear_failures(ip):
    with connect() as db:
        with db.cursor() as cur:
            cur.execute("DELETE FROM login_attempts WHERE ip=%s", (ip,))
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
    if origin and host:
        origin_host = origin.split("://", 1)[-1].split("/")[0].split(":")[0].lower()
        expected_host = host.split(",")[0].strip().split(":")[0].lower()
        if origin_host != expected_host:
            return False
    return True


def require_json():
    ct = request.headers.get("Content-Type", "").split(";")[0]
    if ct != "application/json":
        return err("JSON required", 415)
    return None


@app.errorhandler(413)
def too_large(_error):
    return err("Request too large", 413)


def guard():
    """JSON content type, same-origin, and a sane Content-Length for every state-changing route."""
    bad = require_json()
    if bad:
        return bad
    if not check_origin():
        return err("Origin rejected", 403)
    _size, problem = policy.parse_content_length(request.headers.get("Content-Length"), request.path)
    if problem:
        return err(problem, 413 if "large" in problem else 400)
    return None


# ---------- Routes ----------

@app.route("/health", methods=["GET"])
@app.route("/healthz", methods=["GET"])
@app.route("/api/health", methods=["GET"])
def api_health():
    return reply({"status": "ok"})


@app.route("/api/session", methods=["GET"])
def api_session():
    setup = db_get("password") is None
    return reply({
        "setup": setup,
        "authenticated": is_authorized(),
        "setupRequiresToken": setup and policy.setup_requires_token(request.headers),
    })


@app.route("/api/state", methods=["GET"])
def api_state_get():
    if not is_authorized():
        return err("Please sign in.", 401)
    return reply(json.loads(db_get("state") or '{"teams":[],"matches":[]}'))


@app.route("/api/state", methods=["POST"])
def api_state_post():
    bad = guard()
    if bad:
        return bad
    if not is_authorized():
        return err("Please sign in.", 401)

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("teams"), list) or not isinstance(data.get("matches"), list):
        return err("Invalid war data")

    with connect() as db:
        with db.cursor() as cur:
            lock_state(cur)
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

            cur.execute(
                "INSERT INTO settings (key,value) VALUES (%s,%s) "
                "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
                ("state", json.dumps(data)),
            )
        db.commit()

    return reply({"ok": True})


@app.route("/api/login", methods=["POST"])
def api_login():
    bad = guard()
    if bad:
        return bad

    ip = caller()
    wait = retry_after(ip)
    if wait:
        return err(f"Too many attempts. Try again in {max(1, wait // 60)} minute(s).", 429)

    data = request.get_json(silent=True) or {}
    password = data.get("password", "")
    if not isinstance(password, str):
        return err("Invalid request")
    stored = db_get("password")

    if not stored:
        allowed, message = policy.setup_allowed(request.headers, data.get("setupToken"))
        if not allowed:
            return err(message, 403)
        if len(password) < 10:
            return err("Use at least 10 characters.")
        stored = policy.hash_password(password)
        db_put("password", stored)

    if not policy.verify_password(password, stored):
        record_failure(ip)
        time.sleep(1)
        return err("Incorrect password", 401)

    clear_failures(ip)
    token = secrets.token_urlsafe(32)
    create_session(token, time.time() + policy.SESSION_SECONDS)
    return reply({"ok": True}, cookie=policy.session_cookie(token, request.headers))


@app.route("/api/logout", methods=["POST"])
def api_logout():
    bad = guard()
    if bad:
        return bad
    token = get_token()
    if token:
        delete_session(token)
    return reply({"ok": True}, cookie=policy.session_cookie("", request.headers, 0))


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
    bad = guard()
    if bad:
        return bad
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
    bad = guard()
    if bad:
        return bad
    if not is_authorized():
        return err("Please sign in.", 401)

    data = request.get_json(silent=True) or {}
    match_id = data.get("id")
    if not isinstance(match_id, str) or not match_id:
        return err("Select a saved match.")

    with connect() as db:
        with db.cursor() as cur:
            lock_state(cur)
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
    return reply({"available": False, "scan": False})  # Server-side OCR is not available on serverless


@app.route("/api/ocr", methods=["POST"])
@app.route("/api/ocr/scan", methods=["POST"])
def api_ocr():
    return err("Server-side OCR is not available in this deployment.", 400)


# Initialise tables on first cold start
try:
    ensure_tables()
except Exception as e:
    print("DB init deferred:", e)
