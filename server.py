"""FFK War Desk: one organizer, SQLite persistence, no API keys."""
import base64, hmac, json, os, secrets, socket, sqlite3, threading, time
from contextlib import contextmanager
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import local_ocr
import default_rosters
from ffk_core import policy, backup, logs, validate
from ffk_core.scan_gate import ScanGate, Busy, TimedOut

ROOT = Path(__file__).parent
DB = Path(os.environ.get('DB_PATH', ROOT / 'war.sqlite3'))
throttle = policy.Throttle()
limiter = policy.RateLimiter()
# The reader runs in its own process so a stuck read can be stopped for real (SCAN_ISOLATE=0 uses a thread).
scan_gate = ScanGate(float(os.environ.get('SCAN_WAIT_SECONDS', '25')), float(os.environ.get('SCAN_TIMEOUT_SECONDS', '120')),
                     isolate=os.environ.get('SCAN_ISOLATE', '1') != '0')
MAX_CONNECTIONS = int(os.environ.get('MAX_CONNECTIONS', '64'))
log = logs.setup()


def scanner():
    # Imported lazily: the OCR stack is heavy and optional.
    try:
        import ocr_engine
        return ocr_engine if ocr_engine.available() else None
    except Exception:
        return None

class WarDeskServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can let an old and new process share the same port.
    allow_reuse_address = os.name != 'nt'
    request_queue_size = 64
    _slots = threading.BoundedSemaphore(MAX_CONNECTIONS)

    def process_request(self, request, client_address):
        # A flood of idle connections must not exhaust threads: refuse beyond the cap.
        if not self._slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

@contextmanager
def _open(setup):
    """One connection per use: committed (or rolled back) and always closed, so no file handle lingers."""
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=30)
    try:
        setup(db)
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def _full_setup(db):
    db.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires REAL NOT NULL)')
    default_rosters.initialize(db)
    db.commit()


def connect():
    return _open(_full_setup)


def init_db():
    with connect() as db:
        # Write-ahead logging lets reads and the periodic backup run alongside saves.
        db.execute('PRAGMA journal_mode=WAL')


def quick():
    """Light connection for per-request session checks (no roster bootstrap)."""
    return _open(lambda db: db.execute('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires REAL NOT NULL)'))


def session_valid(token):
    if not token:
        return False
    try:
        with quick() as db:
            row = db.execute('SELECT expires FROM sessions WHERE token_hash=?', (policy.hash_token(token),)).fetchone()
        return bool(row) and row[0] > time.time()
    except sqlite3.Error:
        return False


def session_create(token, expires):
    with quick() as db:
        db.execute('DELETE FROM sessions WHERE expires <= ?', (time.time(),))
        db.execute('INSERT OR REPLACE INTO sessions VALUES (?,?)', (policy.hash_token(token), expires))


def session_delete(token):
    with quick() as db:
        db.execute('DELETE FROM sessions WHERE token_hash=?', (policy.hash_token(token),))

def get(key):
    with connect() as db:
        row = db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return row[0] if row else None

def put(key, value):
    with connect() as db:
        db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, value))


def put_if_absent(key, value):
    """Store a setting only if it does not exist yet; True when this call stored it (atomic)."""
    with connect() as db:
        return db.execute('INSERT OR IGNORE INTO settings VALUES (?,?)', (key, value)).rowcount == 1

class Handler(SimpleHTTPRequestHandler):
    timeout = 30  # a client that stalls mid-request is dropped instead of holding a thread

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'public'), **kwargs)

    def end_headers(self):
        # self.headers is missing when the request line itself was malformed.
        for name, value in policy.security_headers(getattr(self, 'headers', None) or {}):
            self.send_header(name, value)
        super().end_headers()

    def log_message(self, fmt, *args):
        quiet = getattr(self, 'path', '').split('?')[0] in ('/health', '/healthz', '/api/health')
        who = self.caller() if getattr(self, 'headers', None) else self.client_address[0]
        (log.debug if quiet else log.info)('http %s %s', who, fmt % args)

    def reply(self, status, payload, cookie=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        if cookie: self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def cookies(self):
        return dict(x.strip().split('=', 1) for x in self.headers.get('Cookie', '').split(';') if '=' in x)

    def authorized(self):
        return session_valid(self.cookies().get('ffk', ''))

    def throttled(self):
        if policy.rate_limited(limiter, self.caller(), self.path.split('?')[0]):
            self.reply(429, {'error': 'Too many requests. Wait a moment and try again.', 'busy': True})
            return True
        return False

    def caller(self):
        return policy.client_ip(self.headers, self.client_address[0])

    def do_GET(self):
        if self.path.split('?')[0] in ('/health', '/healthz', '/api/health'):
            return self.health()
        if self.throttled():
            return
        if self.path == '/api/host/state':
            key = self.headers.get('X-Host-Key', '')
            expected = get('host_access_key')
            if not self.authorized() and not (expected and key and hmac.compare_digest(key, expected)):
                return self.reply(401, {'error': 'Open a current host link from your organizer.'})
            current = json.loads(get('state') or '{"teams":[],"matches":[]}')
            return self.reply(200, policy.host_view(current))
        if self.path == '/api/session':
            setup = get('password') is None
            return self.reply(200, {'setup': setup, 'authenticated': self.authorized(),
                                    'setupRequiresToken': setup and policy.setup_requires_token(self.headers)})
        if self.path == '/api/state':
            if not self.authorized(): return self.reply(401, {'error': 'Please sign in.'})
            return self.reply(200, json.loads(get('state') or '{"teams":[],"matches":[]}'))
        if self.path == '/api/ocr/status':
            if not self.authorized(): return self.reply(401, {'error': 'Please sign in.'})
            return self.reply(200, {'available': local_ocr.available(), 'scan': scanner() is not None})
        if self.path.startswith('/api/'): return self.reply(404, {'error': 'Not found'})
        super().do_GET()

    def health(self):
        try:
            with quick() as db:
                db.execute('SELECT 1 FROM settings LIMIT 1').fetchall()
            database = 'ok'
        except sqlite3.Error as error:
            return self.reply(503, {'status': 'error', 'database': str(error)})
        age = backup.latest_backup_age(DB)
        self.reply(200, {'status': 'ok', 'database': database, 'screenshotReader': scanner() is not None,
                         'lastBackupSecondsAgo': None if age is None else int(age)})

    def do_POST(self):
        if self.throttled():
            return
        # Same-origin JSON requests prevent cross-site form submissions.
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': 'JSON required'})
        origin = self.headers.get('Origin')
        host = self.headers.get('X-Forwarded-Host') or self.headers.get('Host')
        if origin and host:
            origin_host = origin.split('://', 1)[-1].split('/')[0].split(':')[0].lower()
            expected_host = host.split(',')[0].strip().split(':')[0].lower()
            if origin_host != expected_host:
                return self.reply(403, {'error': 'Origin rejected'})
        size, problem = policy.parse_content_length(self.headers.get('Content-Length'), self.path)
        if problem:
            return self.reply(413 if 'large' in problem else 400, {'error': problem})
        try:
            data = json.loads(self.rfile.read(size))
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {'error': 'Invalid request'})
        if not isinstance(data, dict):
            return self.reply(400, {'error': 'Invalid request'})
        if self.path == '/api/login':
            ip = self.caller()
            wait = throttle.retry_after(ip)
            if wait:
                log.warning('login locked out ip=%s', ip)
                return self.reply(429, {'error': f'Too many attempts. Try again in {max(1, wait // 60)} minute(s).'})
            password = data.get('password', '')
            if not isinstance(password, str):
                return self.reply(400, {'error': 'Invalid request'})
            stored = get('password')
            if not stored:
                allowed, message = policy.setup_allowed(self.headers, data.get('setupToken'))
                if not allowed:
                    return self.reply(403, {'error': message})
                if len(password) < 10: return self.reply(400, {'error': 'Use at least 10 characters.'})
                # Two first visits at once: only one password can be created; the other request loses.
                if not put_if_absent('password', policy.hash_password(password)):
                    return self.reply(409, {'error': 'The organizer password was just created on another device. Sign in with that password.'})
                stored = get('password')
                log.info('organizer password created ip=%s', ip)
            if not policy.verify_password(password, stored):
                throttle.failed(ip)
                log.warning('login failed ip=%s', ip)
                time.sleep(1)
                return self.reply(401, {'error': 'Incorrect password'})
            throttle.succeeded(ip)
            token = secrets.token_urlsafe(32)
            session_create(token, time.time() + policy.SESSION_SECONDS)
            return self.reply(200, {'ok': True}, policy.session_cookie(token, self.headers))
        if not self.authorized(): return self.reply(401, {'error': 'Please sign in.'})
        if self.path == '/api/host/access':
            key = get('host_access_key')
            if data.get('rotate') or not key:
                key = secrets.token_urlsafe(32)
                put('host_access_key', key)
            return self.reply(200, {'key': key})
        if self.path == '/api/matches/delete':
            match_id = data.get('id')
            if not isinstance(match_id, str) or not match_id:
                return self.reply(400, {'error': 'Select a saved match.'})
            # Read the latest roster/results in the same transaction as deletion.
            # A stale browser must never overwrite newer teams or other matches.
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT value FROM settings WHERE key=?', ('state',)).fetchone()
                current = json.loads(row[0]) if row else {'teams': [], 'matches': []}
                target = next((m for m in current['matches'] if m.get('id') == match_id), None)
                if target and current.get('war', {}).get('qualified', {}).get(target.get('stage')):
                    return self.reply(409, {'error': 'Reopen this set in Tournament before deleting its results.'})
                remaining = [m for m in current['matches'] if m.get('id') != match_id]
                if len(remaining) == len(current['matches']):
                    return self.reply(404, {'error': 'This match has already been removed. Refresh the page.'})
                current['matches'] = remaining
                db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('state', json.dumps(current)))
            return self.reply(200, current)
        if self.path == '/api/ocr':
            # The comparison reader shares the screenshot reader's queue and time limit.
            try:
                result = scan_gate.run(local_ocr.recognize, data['image'], data['boxes'])
                return self.reply(200, {'readings': result})
            except Busy:
                return self.reply(429, {'error': 'Another screenshot is still being read. Trying again shortly.', 'busy': True})
            except TimedOut:
                return self.reply(504, {'error': 'The comparison reader took too long.'})
            except Exception as error:
                return self.reply(400, {'error': 'Local OCR comparison unavailable: ' + str(error)})
        if self.path == '/api/ocr/scan':
            engine = scanner()
            if engine is None:
                return self.reply(503, {'error': 'The screenshot reader is not installed on this server.'})
            try:
                image = data['image']
                raw = base64.b64decode(image.split(',', 1)[-1], validate=True)
                started = time.time()
                result = scan_gate.run(engine.scan, raw, data.get('roster'), data.get('regions'))
                log.info('scan ok seconds=%.1f panels=%d warnings=%d', time.time() - started,
                         len(result.get('panels', [])), len(result.get('warnings', [])))
                return self.reply(200, result)
            except Busy:
                return self.reply(429, {'error': 'Another screenshot is still being read. Trying again shortly.', 'busy': True})
            except TimedOut:
                log.error('scan timed out; reader stopped')
                return self.reply(504, {'error': 'Reading this screenshot took too long, so it was stopped. Try a smaller or cropped image, or enter results by hand.'})
            except (KeyError, ValueError, TypeError) as error:
                return self.reply(400, {'error': 'Could not read this screenshot: ' + str(error)})
            except Exception as error:
                log.exception('scan failed')
                return self.reply(500, {'error': 'The screenshot reader failed: ' + str(error)})
        if self.path == '/api/logout':
            session_delete(self.cookies().get('ffk', ''))
            return self.reply(200, {'ok': True}, policy.session_cookie('', self.headers, 0))
        if self.path == '/api/state':
            if not isinstance(data.get('teams'), list) or not isinstance(data.get('matches'), list):
                return self.reply(400, {'error': 'Invalid war data'})
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT value FROM settings WHERE key=?', ('state',)).fetchone()
                previous = json.loads(row[0]) if row else {}
                old_war, new_war = previous.get('war') or {}, data.get('war') or {}
                for stage in ('A', 'B', 'C'):
                    if not old_war.get('qualified', {}).get(stage):
                        continue
                    if not new_war.get('qualified', {}).get(stage):
                        # Reopening an upstream set must invalidate dependent results.
                        if (stage != 'C' and new_war.get('qualified', {}).get('C')) or new_war.get('cs'):
                            return self.reply(409, {'error': 'Reopening a set must clear downstream qualification and CS results.'})
                        continue
                    old_matches = [m for m in previous.get('matches', []) if m.get('stage') == stage]
                    new_matches = [m for m in data['matches'] if m.get('stage') == stage]
                    old_members = old_war.get('groups', {}).get(stage) if stage != 'C' else sum((old_war.get('qualified', {}).get(s, []) for s in ('A', 'B')), [])
                    new_members = new_war.get('groups', {}).get(stage) if stage != 'C' else sum((new_war.get('qualified', {}).get(s, []) for s in ('A', 'B')), [])
                    if old_matches != new_matches or old_members != new_members or old_war['qualified'][stage] != new_war['qualified'][stage]:
                        return self.reply(409, {'error': 'Reopen Set ' + stage + ' in Tournament before changing its results or qualifiers.'})
                problem = validate.check_update(previous, data)
                if problem:
                    log.warning('state save refused: %s', problem)
                    return self.reply(422, {'error': 'Not saved: ' + problem})
                db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('state', json.dumps(data)))
            return self.reply(200, {'ok': True})
        self.reply(404, {'error': 'Not found'})

def lan_address():
    """This computer's address on the local network (other devices use it to open the desk)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(('10.255.255.255', 1))
            return probe.getsockname()[0]
    except OSError:
        return None


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8080'))
    init_db()
    backup.start_scheduler(DB, log.info)
    print(f'FFK War Desk: http://localhost:{port}', flush=True)
    lan = lan_address()
    if lan and not lan.startswith('127.'):
        print(f'Other devices on this network: http://{lan}:{port}', flush=True)
    print('Screenshot reader: ' + ('ready (server-side OCR)' if scanner() else
          'not installed, the browser reader will be used. Install it with: pip install -r requirements-docker.txt'), flush=True)
    if get('password') is None:
        print('First visit: create the organizer password.' + (' A setup token is required.' if os.environ.get('SETUP_TOKEN') else ''), flush=True)
    if os.environ.get('BACKUP_HOURS', '6') not in ('0', '0.0'):
        print(f'Backups: every {os.environ.get("BACKUP_HOURS", "6")} h into {backup.backup_dir(DB)} (keeping {os.environ.get("BACKUP_KEEP", "30")})', flush=True)
    if os.environ.get('RENDER') or os.environ.get('FLY_APP_NAME') or os.environ.get('TRUST_PROXY'):
        print(f'Trusting {policy.trusted_hops()} reverse proxy hop(s) for client addresses.', flush=True)
    WarDeskServer(('0.0.0.0', port), Handler).serve_forever()
