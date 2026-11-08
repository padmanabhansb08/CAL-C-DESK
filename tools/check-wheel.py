"""Final-map wheel API: only the organizer spins, the host link only watches, the pool is validated, and the server's draw
is random over the chosen maps and identical for every screen."""
import http.client
import json
import os
import sys
import tempfile
import threading
import time
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
os.environ['DB_PATH'] = str(Path(tempfile.mkdtemp()) / 'wheel.sqlite3')
os.environ['BACKUP_HOURS'] = '0'
import server  # noqa: E402
from ffk_core import policy  # noqa: E402

server.init_db()
server.limiter = policy.RateLimiter()
host = server.WarDeskServer(('127.0.0.1', 0), server.Handler)
threading.Thread(target=host.serve_forever, daemon=True).start()


def call(method, path, payload=None, headers=None):
    c = http.client.HTTPConnection('127.0.0.1', host.server_port, timeout=10)
    h = {'Content-Type': 'application/json'}
    h.update(headers or {})
    c.request(method, path, json.dumps(payload) if payload is not None else None, h)
    r = c.getresponse()
    body = json.loads(r.read() or b'{}')
    c.close()
    return r.status, body


token = 'wheel-test-session'
server.session_create(token, time.time() + 3600)
organizer = {'Cookie': 'ffk=' + token}

assert call('GET', '/api/wheel')[0] == 401, 'the wheel is not public'
status, body = call('GET', '/api/wheel', headers=organizer)
assert status == 200 and body['spin'] is None and body['maps'] == server.WHEEL_MAPS, body

status, body = call('POST', '/api/host/access', {}, organizer)
key = body['key']
assert call('GET', '/api/wheel', headers={'X-Host-Key': key})[0] == 200, 'the broadcast link may watch'
assert call('GET', '/api/wheel', headers={'X-Host-Key': 'wrong'})[0] == 401
assert call('POST', '/api/wheel/spin', {}, {'X-Host-Key': key})[0] == 401, 'the host link cannot spin'

assert call('POST', '/api/wheel/spin', {'maps': ['Bermuda']}, organizer)[0] == 400, 'one map is not a draw'
assert call('POST', '/api/wheel/spin', {'maps': 'Bermuda'}, organizer)[0] == 400
assert call('POST', '/api/wheel/spin', {'maps': ['Bermuda', 'Erangel']}, organizer)[0] == 400, 'unknown maps are dropped'

# Every chosen map can come up, nothing else does, and the order on the wheel is the canonical one.
results = Counter()
server.limiter = policy.RateLimiter()  # stay under the per-address request ceiling
for _ in range(150):
    status, body = call('POST', '/api/wheel/spin', {'maps': ['Solara', 'Bermuda', 'Kalahari']}, organizer)
    assert status == 200, body
    spin = body['spin']
    assert spin['maps'] == ['Bermuda', 'Kalahari', 'Solara'] and spin['result'] in spin['maps'], spin
    results[spin['result']] += 1
assert set(results) == {'Bermuda', 'Kalahari', 'Solara'} and min(results.values()) > 25, results

# Every screen reads the same stored spin.
_, a = call('GET', '/api/wheel', headers=organizer)
_, b = call('GET', '/api/wheel', headers={'X-Host-Key': key})
assert a['spin'] == b['spin'] == spin, 'all screens see the same draw'
host.shutdown()
print('PASS: organizer-only spin, host link watches, pool validated, fair server draw over the chosen maps, same spin on every screen.')
