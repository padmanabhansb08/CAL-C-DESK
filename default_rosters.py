"""User supplied Season 11 posters. Seed once; later roster edits stay saved."""
import json
import re
import uuid

VERSION = 'season11-poster-defaults-v1'
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
