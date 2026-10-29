"""PostgreSQL edition (api/index.py) parity: sign-in throttling, atomic first setup and state validation.

Needs a throwaway database: set DATABASE_URL (for example postgresql://user@localhost/ffk_test).
Every table it uses is emptied first. Without DATABASE_URL this check reports SKIP.
"""
import copy
import os
import sys
import threading
from pathlib import Path

if not os.environ.get('DATABASE_URL'):
    print('SKIP: set DATABASE_URL to a throwaway PostgreSQL database to run the PostgreSQL parity check.')
    sys.exit(0)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'api'))
import index  # noqa: E402
from ffk_core import policy  # noqa: E402

index.ensure_tables()
with index.connect() as db:
    with db.cursor() as cur:
        cur.execute('TRUNCATE settings, sessions, login_attempts, login_failures')
index.ensure_tables()

# Global ceiling: eight addresses failing five times each must trip it, even though every one of them
# was reset to zero by its own lockout (the old SUM(failures) counter forgot all forty).
for n in range(8):
    for _ in range(policy.FAILURES_BEFORE_LOCK):
        index.record_failure(f'10.0.0.{n}')
assert index.retry_after('10.9.9.9') >= 60, 'forty failures in a minute must trigger the global ceiling'

# Concurrent failures from one address are all counted (no lost read-modify-write updates).
with index.connect() as db:
    with db.cursor() as cur:
        cur.execute('TRUNCATE login_attempts, login_failures')
threads = [threading.Thread(target=index.record_failure, args=('10.1.1.1',)) for _ in range(4)]
[t.start() for t in threads]; [t.join() for t in threads]
with index.connect() as db:
    with db.cursor() as cur:
        cur.execute("SELECT failures FROM login_attempts WHERE ip='10.1.1.1'")
        assert cur.fetchone()[0] == 4, 'four concurrent failures must count as four'
        cur.execute('SELECT COUNT(*) FROM login_failures')
        assert cur.fetchone()[0] == 4
index.record_failure('10.1.1.1')
assert index.retry_after('10.1.1.1') > 0, 'the fifth failure locks the address'
with index.connect() as db:
    with db.cursor() as cur:
        cur.execute('TRUNCATE login_attempts, login_failures')

# Two first visits at once: exactly one creates the password.
app = index.app
results = []
barrier = threading.Barrier(2)


def setup(pw):
    client = app.test_client()
    barrier.wait()
    r = client.post('/api/login', json={'password': pw}, headers={'Host': 'localhost'})
    results.append((pw, r.status_code))


threads = [threading.Thread(target=setup, args=(pw,)) for pw in ('first-password-1', 'second-password-2')]
[t.start() for t in threads]; [t.join() for t in threads]
assert sorted(code for _, code in results) == [200, 409], results
winner = next(pw for pw, code in results if code == 200)

client = app.test_client()
assert client.post('/api/login', json={'password': winner}).status_code == 200
teams = [{'id': f't{i}', 'name': f'Team {i}', 'players': [{'id': f'p{i}-{j}', 'name': f'P{i}.{j}'} for j in range(4)]} for i in range(12)]
state = {'teams': teams, 'matches': []}
assert client.post('/api/state', json=state).status_code == 200
bad = copy.deepcopy(state)
bad['teams'].append(None)
r = client.post('/api/state', json=bad)
assert r.status_code == 422 and 'Not saved' in r.get_json()['error'], r.get_json()
print('PASS: PostgreSQL edition counts every failed sign-in for the global ceiling, never loses concurrent failures, creates the first password atomically and validates saves.')
