"""Check first-run protection, login lockout, body limits and cookie flags on a temporary database."""
import http.client
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server
from ffk_core import policy

# --- pure policy rules
assert policy.parse_content_length('-1', '/api/login')[1] == 'Invalid request'
assert policy.parse_content_length('abc', '/api/login')[1] == 'Invalid request'
assert policy.parse_content_length('2000001', '/api/state')[1] == 'Request too large'
assert policy.parse_content_length('12000000', '/api/ocr/scan')[1] is None
assert policy.parse_content_length(None, '/api/login') == (0, None)
assert policy.via_proxy({'X-Forwarded-For': '1.2.3.4'}) and not policy.via_proxy({'Host': 'localhost'})
# Forwarded headers are client-controlled: ignored unless a trusted proxy count is configured.
os.environ.pop('TRUST_PROXY', None); os.environ.pop('VERCEL', None)
assert policy.client_ip({'X-Forwarded-For': '9.9.9.9'}, '10.0.0.2') == '10.0.0.2'
assert policy.client_ip({}, '192.168.1.5') == '192.168.1.5'
os.environ['TRUST_PROXY'] = '1'
# One trusted proxy: the last entry is what that proxy saw; earlier entries were supplied by the client.
assert policy.client_ip({'X-Forwarded-For': '6.6.6.6, 9.9.9.9'}, '10.0.0.2') == '9.9.9.9'
assert policy.client_ip({'X-Forwarded-For': '6.6.6.6, 9.9.9.9'}, '10.0.0.2') != '6.6.6.6'
os.environ['TRUST_PROXY'] = '2'
assert policy.client_ip({'X-Forwarded-For': '6.6.6.6, 9.9.9.9, 10.1.1.1'}, '10.0.0.2') == '9.9.9.9'
os.environ.pop('TRUST_PROXY')
rl = policy.RateLimiter()
assert all(rl.allow('k', 3, 60, now=100 + i) for i in range(3)) and not rl.allow('k', 3, 60, now=104) and rl.allow('k', 3, 60, now=170)
names = dict(policy.security_headers({'X-Forwarded-Proto': 'https'}))
assert "frame-ancestors 'none'" in names['Content-Security-Policy'] and "object-src 'none'" in names['Content-Security-Policy']
assert names['X-Frame-Options'] == 'DENY' and 'Strict-Transport-Security' in names
assert 'Strict-Transport-Security' not in dict(policy.security_headers({}))
assert policy.hash_token('abc') != 'abc' and len(policy.hash_token('abc')) == 64
assert 'Secure' in policy.session_cookie('t', {'X-Forwarded-Proto': 'https'})
assert 'Secure' not in policy.session_cookie('t', {})
t = policy.Throttle()
for _ in range(policy.FAILURES_BEFORE_LOCK):
    assert t.retry_after('a', now=100) == 0
    t.failed('a', now=100)
assert t.retry_after('a', now=101) > 0 and t.retry_after('b', now=101) == 0
assert t.retry_after('a', now=100 + policy.LOCK_SECONDS + 1) == 0
t.failed('c', now=0); t.succeeded('c'); assert t.retry_after('c', now=1) == 0

# --- the real server on a temporary database
os.environ.pop('SETUP_TOKEN', None)
with tempfile.TemporaryDirectory() as folder:
    server.DB = Path(folder) / 'sec.sqlite3'
    server.init_db()
    server.throttle = policy.Throttle()
    host = server.WarDeskServer(('127.0.0.1', 0), server.Handler)
    threading.Thread(target=host.serve_forever, daemon=True).start()

    def call(method, path, payload=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', host.server_port, timeout=10)
        h = {'Content-Type': 'application/json'}
        h.update(headers or {})
        c.request(method, path, json.dumps(payload) if payload is not None else None, h)
        r = c.getresponse()
        body = json.loads(r.read() or b'{}')
        out = (r.status, body, r.getheader('Set-Cookie'))
        c.close()
        return out

    # Negative Content-Length must be refused without blocking the thread.
    s = socket.create_connection(('127.0.0.1', host.server_port), timeout=5)
    s.sendall(b'POST /api/login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: -1\r\n\r\n{}')
    assert s.recv(200).startswith(b'HTTP/1.0 400'), 'negative Content-Length was not refused'
    s.close()
    status, _, _ = call('POST', '/api/login', {'password': 'x' * 10}, {'Content-Length': '2000001'})
    assert status in (413, 400)

    # First-run setup: allowed directly without requiring a setup token.
    status, body, _ = call('GET', '/api/session', headers={'X-Forwarded-For': '8.8.8.8'})
    assert body['setup'] and not body['setupRequiresToken']

    server.session_create('expired', time.time() - 5)
    status, body, cookie = call('POST', '/api/login', {'password': 'a-long-password'},
                                {'X-Forwarded-For': '8.8.8.8', 'X-Forwarded-Proto': 'https'})
    assert status == 200 and 'Secure' in cookie and 'HttpOnly' in cookie, (status, cookie)
    with server.quick() as db:
        assert db.execute('SELECT COUNT(*) FROM sessions WHERE token_hash=?', (policy.hash_token('expired'),)).fetchone()[0] == 0
        stored = [r[0] for r in db.execute('SELECT token_hash FROM sessions')]
    token = cookie.split('ffk=')[1].split(';')[0]
    assert token not in stored and policy.hash_token(token) in stored, 'only the hash of a session token is stored'
    assert server.session_valid(token) and not server.session_valid('nope')

    # Security headers on pages and API replies; health reports the database.
    status, body, _ = call('GET', '/health')
    assert status == 200 and body['database'] == 'ok' and 'screenshotReader' in body, body
    c = http.client.HTTPConnection('127.0.0.1', host.server_port, timeout=10)
    c.request('GET', '/'); r = c.getresponse(); r.read()
    assert "frame-ancestors 'none'" in r.getheader('Content-Security-Policy') and r.getheader('X-Frame-Options') == 'DENY'
    assert r.getheader('X-Content-Type-Options') == 'nosniff'
    c.close()
    c = http.client.HTTPConnection('127.0.0.1', host.server_port, timeout=10)
    c.request('GET', '/api/session'); r = c.getresponse(); r.read()
    assert len(r.msg.get_all('X-Content-Type-Options')) == 1, 'no duplicated headers'
    c.close()

    # A sign-in survives a restart (the session lives in the database, not in memory).
    status, body, cookie2 = call('POST', '/api/login', {'password': 'a-long-password'})
    session_cookie = cookie2.split(';')[0]
    host.shutdown(); host.server_close()
    host = server.WarDeskServer(('127.0.0.1', 0), server.Handler)
    threading.Thread(target=host.serve_forever, daemon=True).start()
    status, body, _ = call('GET', '/api/session', headers={'Cookie': session_cookie})
    assert body['authenticated'] is True, 'session must persist across a restart'
    status, body, _ = call('GET', '/api/session', headers={'Cookie': 'ffk=forged'})
    assert body['authenticated'] is False

    # Lockout cannot be dodged by sending fake forwarded addresses (no trusted proxy configured).
    server.throttle = policy.Throttle()
    for i in range(policy.FAILURES_BEFORE_LOCK):
        status, _, _ = call('POST', '/api/login', {'password': 'wrong-password-1'}, {'X-Forwarded-For': f'7.7.7.{i}'})
        assert status == 401
    status, body, _ = call('POST', '/api/login', {'password': 'a-long-password'}, {'X-Forwarded-For': '7.7.7.200'})
    assert status == 429, 'a new fake address must not reset the lockout'
    server.throttle = policy.Throttle()

    # Per-address request ceiling.
    server.limiter = policy.RateLimiter()
    codes = [call('GET', '/api/session')[0] for _ in range(policy.API_PER_MINUTE + 5)]
    assert codes[0] == 200 and codes[-1] == 429, (codes[0], codes[-1])
    server.limiter = policy.RateLimiter()

    # Lockout after repeated wrong passwords, even for the right one.
    for _ in range(policy.FAILURES_BEFORE_LOCK):
        status, _, _ = call('POST', '/api/login', {'password': 'wrong-password-1'})
        assert status == 401
    status, body, _ = call('POST', '/api/login', {'password': 'a-long-password'})
    assert status == 429 and 'Too many' in body['error']
    host.shutdown()
print('PASS: content-length limits, proxy-gated first-run setup, setup token, Secure cookie, hashed persistent sessions, spoof-proof lockout, rate limit, security headers and health.')
