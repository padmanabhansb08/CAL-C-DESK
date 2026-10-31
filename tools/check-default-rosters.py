"""Verify incremental roster defaults using in-memory databases only."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import default_rosters
from ffk_core import weekly


def database(state=None, poster_applied=False, week_applied=True):
    db = sqlite3.connect(':memory:')
    db.execute('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    if state is not None:
        save(db, state)
    if poster_applied:
        db.execute('INSERT INTO settings VALUES (?,?)', (default_rosters.VERSION, 'applied'))
    if week_applied:
        db.execute('INSERT INTO settings VALUES (?,?)', (weekly.VERSION, 'applied'))
    return db


def save(db, state):
    db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('state', json.dumps(state)))


def read(db):
    return json.loads(db.execute("SELECT value FROM settings WHERE key='state'").fetchone()[0])


def vini_teams(state):
    return [team for team in state['teams'] if default_rosters.key(team['name']) == 'vini']


def assert_repeat_stable(db):
    before = db.execute('SELECT key, value FROM settings ORDER BY key').fetchall()
    default_rosters.initialize(db)
    after = db.execute('SELECT key, value FROM settings ORDER BY key').fetchall()
    assert after == before, 'Repeated initialization changed saved settings'


# A fresh database gets the original 24 teams plus VINI, with this week's Set A suggested.
with database(week_applied=False) as db:
    default_rosters.initialize(db)
    fresh = read(db)
    assert len(fresh['teams']) == 25
    assert sum(team.get('rosterList') == 1 for team in fresh['teams']) == 12
    assert sum(team.get('rosterList') == 2 for team in fresh['teams']) == 12
    vini = vini_teams(fresh)[0]
    assert sorted(player['name'] for player in vini['players']) == sorted(default_rosters.VINI_MEMBERS)
    assert [player['isCaptain'] for player in vini['players']] == [True, False, False, False]
    assert 'slot' not in vini and 'rosterList' not in vini
    assert fresh['matches'] == []
    week_ids = [team['id'] for team in fresh['teams'][:12]]
    assert [team['name'] for team in fresh['teams'][:12]] == ['FFK ' + m[0] for m in weekly.SET_A], 'Set A teams lead, in slot order'
    assert fresh['war']['groups'] == {'A': week_ids, 'B': []}, 'Set A is only suggested, not played'
    assert fresh['war']['qualified'] == {} and fresh['war']['cs'] == {}
    identities = [team['id'] for team in fresh['teams']]
    identities.extend(player['id'] for team in fresh['teams'] for player in team['players'])
    assert len(set(identities)) == len(identities)
    assert_repeat_stable(db)


# Existing poster installations retain all edits and tournament references.
original = {
    'teams': [{
        'id': 'ram-team', 'name': 'My corrected RAM', 'rosterList': 1, 'slot': 10,
        'players': [{'id': 'ram-player', 'name': 'RAM custom spelling', 'isCaptain': True}],
        'notes': 'Keep the organizer edit',
    }],
    'matches': [{'id': 'match-1', 'stage': 'A', 'rows': [{'teamId': 'ram-team', 'kills': 7}]}],
    'war': {'groups': {'A': ['ram-team'], 'B': []}, 'qualified': {'A': ['ram-team']}},
    'customSetting': {'untouched': True},
}
with database(original, poster_applied=True) as db:
    default_rosters.initialize(db)
    upgraded = read(db)
    expected = deepcopy(original)
    expected['teams'].append(vini_teams(upgraded)[0])
    assert upgraded == expected
    assert 'rosterList' not in upgraded['teams'][-1]
    assert 'slot' not in upgraded['teams'][-1]
    assert_repeat_stable(db)
    # User changes and removal after the migration remain saved.
    upgraded['teams'][-1]['name'] = 'My renamed Vini squad'
    upgraded['teams'][-1]['players'][0]['name'] = 'My captain'
    save(db, upgraded)
    assert_repeat_stable(db)
    upgraded['teams'].pop()
    save(db, upgraded)
    assert_repeat_stable(db)


# A manually registered VINI team is reused without losing its own choices.
for team_name, poster_applied in [('FFK VINI', True), ('vini', True), ('FFK-VINI', False)]:
    custom = deepcopy(original)
    custom_vini = {
        'id': 'vini-existing', 'name': team_name, 'slot': 4, 'rosterList': 2,
        'players': [
            {'id': 'p1', 'name': 'FFK VINI', 'isCaptain': False},
            {'id': 'p2', 'name': 'FFK PADHU', 'isCaptain': True},
            {'id': 'p3', 'name': 'FFK BALA', 'isCaptain': False},
            {'id': 'p4', 'name': 'HAKAI', 'isCaptain': False},
            {'id': 'p5', 'name': 'Custom reserve', 'isCaptain': False, 'note': 'keep'},
        ],
        'notes': 'Preserve this squad',
    }
    custom['teams'].append(custom_vini)
    custom['war']['groups']['B'].append('vini-existing')
    with database(custom, poster_applied=poster_applied) as db:
        default_rosters.initialize(db)
        migrated = read(db)
        matches = vini_teams(migrated)
        assert len(matches) == 1, 'Existing VINI roster was duplicated'
        expected_vini = deepcopy(custom_vini)
        expected_vini['players'][3]['name'] = 'FFK HAKAI'
        assert matches[0] == expected_vini
        assert migrated['matches'] == custom['matches']
        assert migrated['war'] == custom['war']
        assert migrated['customSetting'] == custom['customSetting']
        if poster_applied:
            expected = deepcopy(custom)
            expected['teams'][-1] = expected_vini
            assert migrated == expected
        assert_repeat_stable(db)


# This week's Set A: teams are found by their IGL; players are replaced but kept where still listed.
def before_week():
    db = database(week_applied=False)
    db.execute('INSERT INTO settings VALUES (?,?)', (weekly.VERSION, 'applied'))
    default_rosters.initialize(db)
    state = read(db)
    db.execute('DELETE FROM settings WHERE key=?', (weekly.VERSION,))
    return db, state


def by_name(state, name):
    return next(team for team in state['teams'] if team['name'] == name)


db, old = before_week()
with db:
    assert 'war' not in old
    default_rosters.initialize(db)
    new = read(db)
    assert len(new['teams']) == 25, 'every Set A team already existed, none duplicated'
    for old_name, new_name in [('FFK SANJAY 1M', 'FFK SANJAY 1M'), ('FFK AUTO BOTS', 'FFK AUTO BOTS'), ('FFK FLASH', 'FFK FLASH'), ('FFK RAM', 'FFK RAM')]:
        assert by_name(new, new_name)['id'] == by_name(old, old_name)['id'], new_name + ' kept its identity'
    assert by_name(new, 'FFK AUTO BOTS')['id'] != by_name(old, 'FFK AUTOBOTS')['id'], 'AUTO BOTS is not confused with AUTOBOTS'
    sanjay_old, sanjay_new = by_name(old, 'FFK SANJAY 1M'), by_name(new, 'FFK SANJAY 1M')
    assert [p['name'] for p in sanjay_new['players']] == ['FFK SANJAY 1M', 'FFK SASUKE', 'FFK DINESH', 'FFK SPEED']
    kept = {p['name']: p['id'] for p in sanjay_old['players']}
    assert all(p['id'] == kept[p['name']] for p in sanjay_new['players'] if p['name'] in kept), 'unchanged players keep their IDs'
    assert [p['isCaptain'] for p in sanjay_new['players']] == [True, False, False, False]
    assert all(len(team['players']) == 4 for team in new['teams'][:12]), 'the old fifth player is gone'
    assert [p['name'] for p in by_name(new, 'FFK KO OBITO')['players']] == ['FFK KO OBITO', 'FFK BANKAI', 'FFK TOM', 'FFK ERROR']
    assert new['war']['groups']['A'] == [team['id'] for team in new['teams'][:12]]
    assert_repeat_stable(db)

# A set that has already started keeps its own teams; the roster is still brought up to date.
db, old = before_week()
with db:
    played = [by_name(old, 'FFK ' + m[0])['id'] for m in weekly.SET_A[:11]] + [by_name(old, 'FFK PUGHAL')['id']]
    old['matches'] = [{'id': 'm1', 'stage': 'A', 'rows': []}]
    old['war'] = {'groups': {'A': played, 'B': []}, 'targets': {'A': 6, 'B': 6, 'C': 6}, 'qualified': {}, 'decisions': {}, 'cs': {}}
    save(db, old)
    default_rosters.initialize(db)
    new = read(db)
    assert new['war']['groups']['A'] == played and new['matches'] == old['matches']
    assert by_name(new, 'FFK BABIN')['players'][2]['name'] == 'FFK DREAM'

# Teams already in Set B are never suggested for Set A.
db, old = before_week()
with db:
    old['war'] = {'groups': {'A': [], 'B': [by_name(old, 'FFK RAM')['id']]}, 'targets': {'A': 6, 'B': 6, 'C': 6}, 'qualified': {}, 'decisions': {}, 'cs': {}}
    save(db, old)
    default_rosters.initialize(db)
    assert read(db)['war']['groups']['A'] == []

# A team that does not exist yet is created with the poster's four players.
db, old = before_week()
with db:
    old['teams'] = [team for team in old['teams'] if team['name'] != 'FFK CAPS']
    save(db, old)
    default_rosters.initialize(db)
    caps = by_name(read(db), 'FFK CAPS')
    assert [p['name'] for p in caps['players']] == ['FFK CAPS', 'FFK EREN', 'FFK DRAGON', 'FFK VALIANT'] and caps['players'][0]['isCaptain']

print('PASS: fresh and existing defaults, VINI deduplication, HAKAI prefix, edit/ID/reference preservation, Set A week roster by IGL, and repeated initialization.')
