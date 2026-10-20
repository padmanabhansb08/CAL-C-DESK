"""Verify incremental roster defaults using in-memory databases only."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import default_rosters


def database(state=None, poster_applied=False):
    db = sqlite3.connect(':memory:')
    db.execute('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    if state is not None:
        save(db, state)
    if poster_applied:
        db.execute('INSERT INTO settings VALUES (?,?)', (default_rosters.VERSION, 'applied'))
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


# A fresh database gets the original 24 teams plus an unassigned VINI roster.
with database() as db:
    default_rosters.initialize(db)
    fresh = read(db)
    assert len(fresh['teams']) == 25
    assert sum(team.get('rosterList') == 1 for team in fresh['teams']) == 12
    assert sum(team.get('rosterList') == 2 for team in fresh['teams']) == 12
    vini = vini_teams(fresh)[0]
    assert [player['name'] for player in vini['players']] == default_rosters.VINI_MEMBERS
    assert [player['isCaptain'] for player in vini['players']] == [True, False, False, False]
    assert 'slot' not in vini and 'rosterList' not in vini
    assert fresh['matches'] == [] and 'war' not in fresh
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


print('PASS: fresh and existing defaults, VINI deduplication, HAKAI prefix, edit/ID/reference preservation, and repeated initialization.')
