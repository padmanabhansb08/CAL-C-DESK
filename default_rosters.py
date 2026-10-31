"""User supplied defaults. Apply additions once; later roster edits stay saved."""
import json
import re
import uuid

from ffk_core import weekly

VERSION = 'season11-poster-defaults-v1'
VINI_VERSION = 'ffk-vini-default-v1'
VINI_MEMBERS = ['FFK VINI', 'FFK BALA', 'FFK HAKAI', 'FFK PADHU']
# Separate entries preserve the two posters' Autobots/Sarvesh spellings.
LISTS = [
    [
        ['DEEPAK', 'NONAME', 'NARUTO', 'XEBEC'],
        ['KO OBITO', 'TOM', 'ERDOR', 'BANKAI', 'KO TOBI'],
        ['ARTLORD', 'ZEN', 'DEVIL', 'KAIPULLA'],
        ['SANJAY 1M', 'DINESH', 'SPEED', 'NIVASH'],
        ['AUTOBOTS', 'ITACHI', 'APPU', 'SURVESH'],
        ['BABIN', 'PRIME', 'ZOROX', 'LORD'],
        ['PARTHI', 'HUNTER07', 'CRIMINAL', 'SHADOW'],
        ['PRAGA', 'NINJA', 'GOKUL', 'HARISH'],
        ['BOBBY', 'SCARY05', 'WHITE', 'PRAVIN'],
        ['RAM', 'BALA', 'ZORO', 'VEGITO'],
        ['KAKASHI', 'RAVI', 'NOBITA', 'PRAVEEN'],
        ['KARTHIK', 'ROCK', 'AYANAKOJI', 'TOBI'],
    ],
    [
        ['SANJAY', 'VARUN', 'DARK', 'FLASH'],
        ['JEEVAN', 'IZUME', 'VISHAL', 'SASUKE'],
        ['SUHAS', 'KILLER', 'YZZZ', 'GOJO'],
        ['AUTO BOTS', 'ITACHI', 'APPU', 'SARVESH'],
        ['VICKY', 'AURA', 'SNIPER', 'ZORO'],
        ['CAPS', 'EREN', 'DRAGON', 'VALIANT'],
        ['VETRI.15', 'APEX', 'KAVI', 'DRAGEN'],
        ['MANI', 'GOKU', 'SPIDER', 'ALONE'],
        ['GOAT', 'COBRA07', 'PIRAI', 'KAKASHI'],
        ['SELVA', 'ABINES', 'NIVI', 'VASANTH'],
        ['FLASH', 'PRADEEP', 'PIKACHU', 'SNIPER'],
        ['PUGHAL', 'PRIYAN', 'KARTHI', 'JAGU'],
    ],
]


def key(value):
    return re.sub(r'[^a-z0-9]', '', value.lower()).replace('ffk', '')


def initialize(db):
    _initialize_poster_rosters(db)
    _initialize_vini_roster(db)
    _initialize_set_a_week(db)


def _initialize_set_a_week(db):
    if db.execute('SELECT 1 FROM settings WHERE key=?', (weekly.VERSION,)).fetchone():
        return
    row = db.execute("SELECT value FROM settings WHERE key='state'").fetchone()
    state = json.loads(row[0]) if row else {'teams': [], 'matches': []}
    weekly.apply_set_a(state)
    db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('state', json.dumps(state)))
    db.execute('INSERT INTO settings VALUES (?,?)', (weekly.VERSION, 'applied'))


def _initialize_poster_rosters(db):
    if db.execute('SELECT 1 FROM settings WHERE key=?', (VERSION,)).fetchone():
        return
    row = db.execute("SELECT value FROM settings WHERE key='state'").fetchone()
    state = json.loads(row[0]) if row else {'teams': [], 'matches': []}
    remaining = list(state['teams'])
    teams = []
    for list_number, squads in enumerate(LISTS, 1):
        for slot, members in enumerate(squads, 1):
            # Reuse existing identities to preserve references in saved matches.
            captain = key(members[0])
            old = next((t for t in remaining if key(t['name']) == captain), None)
            if old:
                remaining.remove(old)
            team = dict(old) if old else {'id': str(uuid.uuid4())}
            previous = old.get('players', []) if old else []
            team.update(name='FFK ' + members[0], slot=slot,
                        rosterList=list_number, players=[])
            for i, member in enumerate(members):
                name = 'FFK ' + member
                player = next((p for p in previous if key(p['name']) == key(name)), None)
                # Preserve a corrected player's ID when the poster changes spelling.
                if player is None and i < len(previous):
                    candidate = previous[i]
                    if not any(p['id'] == candidate['id'] for p in team['players']):
                        player = candidate
                team['players'].append({'id': player['id'] if player else str(uuid.uuid4()),
                                        'name': name, 'isCaptain': i == 0})
            teams.append(team)
    state['teams'] = teams + remaining
    db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('state', json.dumps(state)))
    db.execute('INSERT INTO settings VALUES (?,?)', (VERSION, 'applied'))


def _initialize_vini_roster(db):
    if db.execute('SELECT 1 FROM settings WHERE key=?', (VINI_VERSION,)).fetchone():
        return
    row = db.execute("SELECT value FROM settings WHERE key='state'").fetchone()
    state = json.loads(row[0]) if row else {'teams': [], 'matches': []}
    teams = state.setdefault('teams', [])
    existing = next((team for team in teams if key(team['name']) == key('FFK VINI')), None)
    changed = False
    if existing is None:
        # This additional roster is available for selection, without taking a
        # slot in either of the two original 12-team tournament lists.
        teams.append({
            'id': str(uuid.uuid4()),
            'name': 'FFK VINI',
            'players': [
                {'id': str(uuid.uuid4()), 'name': name, 'isCaptain': i == 0}
                for i, name in enumerate(VINI_MEMBERS)
            ],
        })
        changed = True
    else:
        # Correct bare requested player names while retaining the organizer's
        # player identities, order, captain choices and any custom players.
        requested = {key(name): name for name in VINI_MEMBERS}
        for player in existing.get('players', []):
            name = player.get('name', '')
            canonical = requested.get(key(name))
            if canonical and not name.strip().upper().startswith('FFK'):
                player['name'] = canonical
                changed = True
    if changed:
        db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('state', json.dumps(state)))
    db.execute('INSERT INTO settings VALUES (?,?)', (VINI_VERSION, 'applied'))
