"""Tournament backup file: only the organizer downloads or restores it, a restore checks the file and keeps a copy of the
data it replaces, and the storage check tells a container disk (wiped on redeploy) from a mounted volume."""
import http.client
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
folder = Path(tempfile.mkdtemp())
os.environ['DB_PATH'] = str(folder / 'backup.sqlite3')
os.environ['BACKUP_HOURS'] = '0'
os.environ['BACKUP_DIR'] = str(folder / 'backups')
import server  # noqa: E402
from ffk_core import backup, policy  # noqa: E402

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


token = 'backup-test-session'
server.session_create(token, time.time() + 3600)
organizer = {'Cookie': 'ffk=' + token}

team = lambda i: {'id': f't{i}', 'name': f'FFK Team {i}', 'players': [{'id': f'p{i}{j}', 'name': f'Player {i}{j}'} for j in range(4)]}
original = {'teams': [team(i) for i in range(1, 4)], 'matches': []}
assert call('POST', '/api/state', original, organizer)[0] == 200
call('POST', '/api/wheel/spin', {'maps': ['Bermuda', 'Solara']}, organizer)

# Download: organizer only; the file holds the tournament and the drawn map.
assert call('GET', '/api/backup')[0] == 401, 'the backup is not public'
_, key = call('POST', '/api/host/access', {}, organizer)
assert call('GET', '/api/backup', headers={'X-Host-Key': key['key']})[0] == 401, 'the host link cannot download it'
status, saved = call('GET', '/api/backup', headers=organizer)
assert status == 200 and saved['format'] == server.BACKUP_FORMAT and saved['state'] == original, saved
assert saved['mapSpin']['result'] in ('Bermuda', 'Solara')

# The tournament changes (or the server is wiped)...
changed = {'teams': [team(9)], 'matches': []}
assert call('POST', '/api/state', changed, organizer)[0] == 200

# Restore: organizer only, refuses anything that is not a valid backup, and changes nothing when it refuses.
assert call('POST', '/api/state/restore', saved)[0] == 401
assert call('POST', '/api/state/restore', {'teams': [], 'matches': []}, organizer)[0] == 400, 'a bare state is not a backup file'
broken = json.loads(json.dumps(saved))
broken['state']['teams'][1]['id'] = 't1'  # duplicate team id
status, body = call('POST', '/api/state/restore', broken, organizer)
assert status == 422 and body['error'].startswith('Not restored'), (status, body)
assert call('GET', '/api/state', headers=organizer)[1] == changed, 'a refused restore changes nothing'

before = len(backup.list_backups(folder / 'backups'))
status, body = call('POST', '/api/state/restore', saved, organizer)
assert status == 200 and body == {'ok': True, 'teams': 3, 'matches': 0}, body
assert call('GET', '/api/state', headers=organizer)[1] == original, 'the backup is back'
assert len(backup.list_backups(folder / 'backups')) == before + 1, 'the replaced data was copied first'

# Storage: an explicit setting wins; on this machine (no container) storage is the real disk.
assert call('GET', '/api/session', headers=organizer)[1]['persistentStorage'] is True
assert 'persistentStorage' not in call('GET', '/api/session')[1], 'only the organizer sees storage details'
os.environ['STORAGE_PERSISTENT'] = '0'
assert server.storage_persistent() is False and call('GET', '/health')[1]['persistentStorage'] is False
os.environ['STORAGE_PERSISTENT'] = '1'
assert server.storage_persistent() is True
os.environ.pop('STORAGE_PERSISTENT')
host.shutdown()
print('PASS: organizer-only backup download and restore, bad files refused without changes, data copied before a restore, storage check.')
