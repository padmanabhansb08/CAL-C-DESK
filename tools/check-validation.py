"""Server-side war-state validation, atomic first setup, and the post-resize image limit."""
import copy
import json
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ffk_core import validate  # noqa: E402


def team(i, size=4):
    return {'id': f't{i}', 'name': f'FFK Team {i}', 'players': [{'id': f'p{i}-{j}', 'name': f'Player {i}.{j}'} for j in range(size)]}


def match(n, ids, stage=None):
    m = {'id': f'm{n}', 'name': f'Match {n}', 'map': 'Bermuda', 'created': '2026-10-28T00:00:00Z',
         'rows': [{'placement': k + 1, 'teamId': tid, 'teamName': tid,
                   'players': [{'playerId': f'p{tid[1:]}-{j}', 'name': 'x', 'kills': 1} for j in range(4)],
                   'adjustments': []} for k, tid in enumerate(ids)]}
    if stage:
        m['stage'] = stage
    return m


def base():
    teams = [team(i) for i in range(24)]
    a, b = [f't{i}' for i in range(12)], [f't{i}' for i in range(12, 24)]
    war = {'groups': {'A': a, 'B': b}, 'targets': {'A': 1, 'B': 1, 'C': 1}, 'qualified': {}, 'decisions': {}, 'cs': {}, 'csFormat': 'page-playoff-v1'}
    return {'teams': teams, 'matches': [match(1, a, 'A'), match(2, b, 'B')], 'war': war}


good = base()
assert validate.problems(good) == [], validate.problems(good)


def refused(mutate, expect):
    state = copy.deepcopy(good)
    mutate(state)
    problem = validate.check_update(good, state)
    assert problem and expect in problem, (expect, problem)


# Shapes the audit sent through a signed-in session.
refused(lambda s: s['teams'].append(None), 'is not a team')
refused(lambda s: s['matches'][0]['rows'][0]['players'][0].update(kills=-3), 'kills must be whole numbers')
refused(lambda s: s['matches'][0]['rows'][0]['players'][0].update(kills=1.5), 'kills must be whole numbers')
refused(lambda s: s['matches'][0]['rows'][1].update(placement=1), 'every placement')
refused(lambda s: s['matches'][0]['rows'][0].update(teamId='ghost'), 'not registered')
refused(lambda s: s['war']['qualified'].update(A=['ghost'] * 6), 'qualifiers must be 6 different teams')
refused(lambda s: s['war']['qualified'].update(A=[f't{i}' for i in range(12, 18)]), 'qualifiers must be 6 different teams')
refused(lambda s: s['war']['groups'].update(B=s['war']['groups']['A']), 'both Set A and Set B')
refused(lambda s: s['matches'].append(match(3, [f't{i}' for i in range(12)], 'A')), 'more saved matches than planned')
refused(lambda s: s['matches'][1]['rows'][0].update(teamId='t0', players=copy.deepcopy(s['matches'][0]['rows'][0]['players'])), 'not in Set B')
refused(lambda s: s['matches'][0]['rows'][0]['adjustments'].extend([{'id': 'a1', 'value': -5, 'reason': 'late'}, {'id': 'a1', 'value': -5, 'reason': 'late'}]), 'recorded twice')
refused(lambda s: s['matches'][0]['rows'][0]['adjustments'].append({'value': 0, 'reason': 'x'}), 'non-zero')
refused(lambda s: s['teams'][1].update(name='ffk team 0'), 'used twice')

# A fictional champion: the bracket must be followed from the final four.
qualified = copy.deepcopy(good)
qualified['war']['qualified'] = {'A': [f't{i}' for i in range(6)], 'B': [f't{i}' for i in range(12, 18)],
                                 'C': ['t0', 't1', 't12', 't13']}
# The final-four fixture must have a completed semi-final, with these seeds actually on top.
c_teams = ['t0', 't1', 't12', 't13', 't2', 't3', 't4', 't5', 't14', 't15', 't16', 't17']
qualified['matches'].append(match(3, c_teams, 'C'))
assert validate.problems(qualified) == [], validate.problems(qualified)


def result(teams, scores):
    w = teams[0] if scores[0] > scores[1] else teams[1]
    return {'teams': teams, 'scores': scores, 'winner': w, 'loser': teams[1] if w == teams[0] else teams[0]}


champion = copy.deepcopy(qualified)
champion['war']['cs'] = {'final': result(['t5', 't6'], [3, 1])}
assert any('earlier fixtures' in p for p in validate.problems(champion))
played = copy.deepcopy(qualified)
q1, el = result(['t0', 't1'], [3, 1]), result(['t12', 't13'], [1, 3])
q2 = result([q1['loser'], el['winner']], [3, 2])
played['war']['cs'] = {'q1': q1, 'eliminator': el, 'q2': q2, 'final': result([q1['winner'], q2['winner']], [2, 3])}
assert validate.problems(played) == [], validate.problems(played)
liar = copy.deepcopy(played)
liar['war']['cs']['final']['winner'] = 't0'
assert any('winner does not match' in p for p in validate.problems(liar))

# Older data with an existing problem can still be saved, but a save may not add a new one.
legacy = copy.deepcopy(good)
legacy['matches'][0]['rows'][0]['players'][0]['kills'] = 120
assert validate.check_update(legacy, copy.deepcopy(legacy)) is None
worse = copy.deepcopy(legacy)
worse['teams'].append(None)
assert validate.check_update(legacy, worse)

# A legacy problem is local to its field and value, not a reusable free pass for its message.
worse = copy.deepcopy(legacy)
worse['matches'][0]['rows'][1]['players'][0]['kills'] = -5
assert validate.check_update(legacy, worse), 'a second bad kill field cannot hide behind the old message'
worse = copy.deepcopy(legacy)
worse['matches'][0]['rows'][0]['players'][0]['kills'] = -90
assert validate.check_update(legacy, worse), 'an existing invalid value cannot be replaced by another invalid value'
fixed = copy.deepcopy(legacy)
fixed['matches'][0]['rows'][0]['players'][0]['kills'] = 2
assert validate.check_update(legacy, fixed) is None
deleted = copy.deepcopy(legacy)
deleted['matches'].pop(0)
assert validate.check_update(legacy, deleted) is None, 'deleting the invalid result repairs it'
reordered = copy.deepcopy(legacy)
reordered['matches'][0]['rows'].reverse()
assert validate.check_update(legacy, reordered) is None, 'moving a historic row does not create a new invalid value'

# JSON shapes must produce a reason, never an unhashable-ID/.get exception.
malformed = [
    lambda s: s['matches'][0].update(id=[]),
    lambda s: s['matches'][0]['rows'][0].update(placement=[]),
    lambda s: s['matches'][0]['rows'][0].update(teamId={}),
    lambda s: s['war']['groups'].update(A=[{}]),
    lambda s: s['war'].update(groups=[]),
    lambda s: s['war'].update(qualified=[]),
    lambda s: s['war'].update(cs=[]),
    lambda s: s['war'].update(cs={'q1': []}),
    lambda s: s.update(war=['bad']),
    lambda s: s['matches'][0]['rows'][0]['adjustments'].append({'id': [], 'value': -5, 'reason': 'x'}),
]
for mutate in malformed:
    candidate = copy.deepcopy(good)
    mutate(candidate)
    assert validate.check_update(good, candidate), candidate

# Players must have names and belong to their team, except explicit match-only substitutes.
refused(lambda s: s['matches'][0]['rows'][0]['players'][0].update(name='   '), 'incomplete')
refused(lambda s: s['matches'][0]['rows'][0]['players'][0].update(playerId='invented'), 'does not belong')
refused(lambda s: s['matches'][0]['rows'][0]['players'][0].update(playerId='p12-0'), 'does not belong')
refused(lambda s: s['teams'][0].update(players=[]), 'invalid player list')
refused(lambda s: s['teams'][0]['players'].extend([{'id': 'p-extra-1', 'name': 'Extra 1'}, {'id': 'p-extra-2', 'name': 'Extra 2'}]), 'invalid player list')
sub = copy.deepcopy(good)
sub['matches'][0]['rows'][0]['players'][0].update(playerId='sub-match-1', name='Guest', isSubstitute=True)
assert validate.check_update(good, sub) is None
replaced = copy.deepcopy(good)
replaced['teams'][0]['players'][0] = {'id': 'new-person', 'name': 'New person'}
assert validate.check_update(good, replaced) is None, 'historic kills stay with a replaced roster player'
new_match = copy.deepcopy(replaced)
new_match['matches'].append(match(9, [f't{i}' for i in range(12)]))
assert 'does not belong' in validate.check_update(replaced, new_match), 'removed players are not silently re-used in new matches'

# Completion, ranking and tie decisions are enforced on the server, not just in the browser.
early = copy.deepcopy(good)
early['war']['targets']['A'] = 6
early['war']['qualified']['A'] = [f't{i}' for i in range(6)]
assert 'Save exactly' in validate.check_update(good, early)
wrong = copy.deepcopy(good)
wrong['war']['qualified']['A'] = [f't{i}' for i in range(6, 12)]
assert 'standings' in validate.check_update(good, wrong)
wrong = copy.deepcopy(good)
wrong['war']['qualified']['A'] = [f't{i}' for i in reversed(range(6))]
assert 'order' in validate.check_update(good, wrong)
tie = copy.deepcopy(good)
tie['war']['targets']['A'] = 2
tie_ids = [f't{i}' for i in range(12)]
tie_ids[5], tie_ids[6] = tie_ids[6], tie_ids[5]
tie['matches'].append(match(4, tie_ids, 'A'))
tie['war']['qualified']['A'] = [f't{i}' for i in range(6)]
assert 'host reason' in validate.check_update(good, tie)
tie['war']['decisions']['A'] = {'choices': ['t5'], 'reason': 'Host tie decision'}
assert validate.check_update(good, tie) is None
tie['war']['decisions']['A']['choices'] = ['t7']
assert 'host reason' in validate.check_update(good, tie)
for value in (None, 'single-elimination', 'anything'):
    bypass = copy.deepcopy(champion)
    bypass['war']['csFormat'] = value
    assert 'format' in validate.check_update(qualified, bypass), 'changing format must not bypass bracket checks'
old_format = copy.deepcopy(champion)
old_format['war'].pop('csFormat')
assert validate.check_update(old_format, copy.deepcopy(old_format)) is None, 'unchanged old knockout history still saves'
changed_format = copy.deepcopy(old_format)
changed_format['war']['cs']['final']['winner'] = 'invented-champion'
assert validate.check_update(old_format, changed_format), 'old format cannot hide a changed fictional champion'
changed_format = copy.deepcopy(old_format)
changed_format['war']['cs']['unknown'] = {'winner': 'invented-champion'}
assert validate.check_update(old_format, changed_format), 'old format cannot hide an added fixture'

# --- through the real server
import server  # noqa: E402

with tempfile.TemporaryDirectory() as folder:
    server.DB = Path(folder) / 'v.sqlite3'
    server.init_db()
    host = server.WarDeskServer(('127.0.0.1', 0), server.Handler)
    threading.Thread(target=host.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{host.server_port}'

    def post(path, data, cookie=None):
        req = urllib.request.Request(url + path, json.dumps(data).encode(), {'Content-Type': 'application/json', **({'Cookie': cookie} if cookie else {})})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read()), r.headers.get('Set-Cookie')
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read()), None

    # Two first visits at the same moment: exactly one creates the password.
    results = []
    barrier = threading.Barrier(2)

    def setup(pw):
        barrier.wait()
        results.append((pw, post('/api/login', {'password': pw})))

    threads = [threading.Thread(target=setup, args=(pw,)) for pw in ('first-password-1', 'second-password-2')]
    [t.start() for t in threads]; [t.join() for t in threads]
    codes = sorted(r[1][0] for r in results)
    assert codes == [200, 409], codes
    winner = next(pw for pw, r in results if r[0] == 200)
    loser = next(pw for pw, r in results if r[0] == 409)
    assert server.policy.verify_password(winner, server.get('password'))
    assert not server.policy.verify_password(loser, server.get('password'))

    status, _, cookie = post('/api/login', {'password': winner})
    cookie = cookie.split(';')[0]
    status, body, _ = post('/api/state', good, cookie)
    assert status == 200, body
    bad = copy.deepcopy(good)
    bad['teams'].append(None)
    status, body, _ = post('/api/state', bad, cookie)
    assert status == 422 and 'Not saved' in body['error'], (status, body)
    assert json.loads(server.get('state')) == good, 'a refused save stores nothing'
    for mutate in malformed:
        candidate = copy.deepcopy(good)
        mutate(candidate)
        status, body, _ = post('/api/state', candidate, cookie)
        assert status == 422 and 'Not saved' in body['error'], (status, body)
        assert json.loads(server.get('state')) == good
    host.shutdown()
    host.server_close()

# --- the image limit is checked after resizing to the reader's working width
try:
    from ocr_engine.engine import working_scale
except ImportError:
    working_scale = None
if working_scale:
    for size in ((100, 10000), (10000, 100), (3000, 20000)):
        try:
            working_scale(*size)
            raise AssertionError(f'{size} must be refused')
        except ValueError:
            pass
    assert working_scale(1600, 900) == 1.0 and working_scale(800, 450) > 1

print('PASS: malformed teams/results, impossible scores and placements, set membership, qualifiers and bracket checked server-side; legacy data still saves; first setup is atomic; huge images refused after scaling.')
