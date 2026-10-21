"""FFK War Desk: one organizer, SQLite persistence, no API keys."""
import hashlib, hmac, json, os, secrets, socket, sqlite3, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import local_ocr
import default_rosters

ROOT = Path(__file__).parent
DB = Path(os.environ.get('DB_PATH', ROOT / 'war.sqlite3'))
sessions = {}

class WarDeskServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can let an old and new process share the same port.
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB)
    db.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    default_rosters.initialize(db)
    db.commit()
    return db

def get(key):
    with connect() as db:
        row = db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return row[0] if row else None

def put(key, value):
    with connect() as db:
        db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, value))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'public'), **kwargs)

    def reply(self, status, payload, cookie=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie: self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        cookies = dict(x.strip().split('=', 1) for x in self.headers.get('Cookie', '').split(';') if '=' in x)
        return sessions.get(cookies.get('ffk', ''), 0) > time.time()

    def do_GET(self):
        if self.path.split('?')[0] in ('/health', '/healthz', '/api/health'):
            return self.reply(200, {'status': 'ok'})
        if self.path == '/api/host/state':
            key = self.headers.get('X-Host-Key', '')
            expected = get('host_access_key')
            if not self.authorized() and not (expected and key and hmac.compare_digest(key, expected)):
                return self.reply(401, {'error': 'Open a current host link from your organizer.'})
            current = json.loads(get('state') or '{"teams":[],"matches":[]}')
            return self.reply(200, {'teams': current['teams'], 'matches': current['matches']})
        if self.path == '/api/session':
            return self.reply(200, {'setup': get('password') is None, 'authenticated': self.authorized()})
        if self.path == '/api/state':
            if not self.authorized(): return self.reply(401, {'error': 'Please sign in.'})
            return self.reply(200, json.loads(get('state') or '{"teams":[],"matches":[]}'))
        if self.path == '/api/ocr/status':
            if not self.authorized(): return self.reply(401, {'error': 'Please sign in.'})
            return self.reply(200, {'available': local_ocr.available()})
        if self.path.startswith('/api/'): return self.reply(404, {'error': 'Not found'})
        super().do_GET()

    def do_POST(self):
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
        try:
            size = int(self.headers.get('Content-Length', 0))
            if size > (12_000_000 if self.path == '/api/ocr' else 2_000_000): return self.reply(413, {'error': 'Request too large'})
            data = json.loads(self.rfile.read(size))
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {'error': 'Invalid request'})
        if self.path == '/api/login':
            password = data.get('password', '')
            stored = get('password')
            if not stored:
                if len(password) < 10: return self.reply(400, {'error': 'Use at least 10 characters.'})
                salt = secrets.token_hex(16)
                stored = salt + ':' + hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
                put('password', stored)
            salt, expected = stored.split(':')
            actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
            if not hmac.compare_digest(actual, expected):
                time.sleep(1)
                return self.reply(401, {'error': 'Incorrect password'})
            token = secrets.token_urlsafe(32)
            sessions[token] = time.time() + 43200
            return self.reply(200, {'ok': True}, f'ffk={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200')
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
                    return self.reply(409, {'error': 'Reopen this set in War manager before deleting its results.'})
                remaining = [m for m in current['matches'] if m.get('id') != match_id]
                if len(remaining) == len(current['matches']):
                    return self.reply(404, {'error': 'This match has already been removed. Refresh the page.'})
                current['matches'] = remaining
                db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('state', json.dumps(current)))
            return self.reply(200, current)
        if self.path == '/api/ocr':
            try:
                result = local_ocr.recognize(data['image'], data['boxes'])
                return self.reply(200, {'readings': result})
            except Exception as error:
                return self.reply(400, {'error': 'Local OCR comparison unavailable: ' + str(error)})
        if self.path == '/api/logout':
            cookies = dict(x.strip().split('=', 1) for x in self.headers.get('Cookie', '').split(';') if '=' in x)
            sessions.pop(cookies.get('ffk', ''), None)
            return self.reply(200, {'ok': True}, 'ffk=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
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
                        return self.reply(409, {'error': 'Reopen Set ' + stage + ' in War manager before changing its results or qualifiers.'})
                db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('state', json.dumps(data)))
            return self.reply(200, {'ok': True})
        self.reply(404, {'error': 'Not found'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8080'))
    print(f'FFK War Desk: http://localhost:{port}', flush=True)
    WarDeskServer(('0.0.0.0', port), Handler).serve_forever()
