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
assert policy.client_ip({'X-Forwarded-For': '9.9.9.9, 10.0.0.1'}, '10.0.0.2') == '9.9.9.9'
assert policy.client_ip({}, '192.168.1.5') == '192.168.1.5'
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
    server.sessions.clear()
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

    # First-run setup: refused through a proxy without a token, allowed directly.
    status, body, _ = call('GET', '/api/session', headers={'X-Forwarded-For': '8.8.8.8'})
    assert body['setup'] and body['setupRequiresToken']
    status, body, _ = call('POST', '/api/login', {'password': 'a-long-password'}, {'X-Forwarded-For': '8.8.8.8'})
    assert status == 403 and 'SETUP_TOKEN' in body['error']
    assert server.get('password') is None

    os.environ['SETUP_TOKEN'] = 'token-123'
    status, body, _ = call('POST', '/api/login', {'password': 'a-long-password', 'setupToken': 'wrong'}, {'X-Forwarded-For': '8.8.8.8'})
    assert status == 403
    server.sessions['expired'] = time.time() - 5
    status, body, cookie = call('POST', '/api/login', {'password': 'a-long-password', 'setupToken': 'token-123'},
                                {'X-Forwarded-For': '8.8.8.8', 'X-Forwarded-Proto': 'https'})
    assert status == 200 and 'Secure' in cookie and 'HttpOnly' in cookie, (status, cookie)
    assert 'expired' not in server.sessions
    os.environ.pop('SETUP_TOKEN')

    # Lockout after repeated wrong passwords, even for the right one.
    for _ in range(policy.FAILURES_BEFORE_LOCK):
        status, _, _ = call('POST', '/api/login', {'password': 'wrong-password-1'})
        assert status == 401
    status, body, _ = call('POST', '/api/login', {'password': 'a-long-password'})
    assert status == 429 and 'Too many' in body['error']
    host.shutdown()
print('PASS: content-length limits, proxy-gated first-run setup, setup token, Secure cookie, session purge and login lockout.')
