"""Add missing squads from the user's October 3/10 posters without replacing existing teams."""
import json
from pathlib import Path
import re
import sqlite3
import sys
from datetime import datetime
import uuid

ROOT = Path(__file__).resolve().parent.parent
# October 10 spells the duplicated Autobots squad's fourth player SARVESH;
# October 3 spells it SURVESH. Use the newer poster, keeping both source spellings here.
SQUADS = [
    ('FFK KO OBITO', ['KO OBITO', 'TOM', 'ERDOR', 'BANKAI']),
    ('FFK SANJAY 1M', ['SANJAY 1M', 'DINESH', 'SPEED', 'NIVASH']),
    ('FFK AUTO BOTS', ['AUTO BOTS', 'ITACHI', 'APPU', 'SARVESH']),
    ('FFK PARTHI', ['PARTHI', 'HUNTER07', 'CRIMINAL', 'SHADOW']),
    ('FFK BOBBY', ['BOBBY', 'SCARY05', 'WHITE', 'PRAWIN']),
    ('FFK KAKASHI', ['KAKASHI', 'RAVI', 'NOBITA', 'PRAVEEN']),
    ('FFK KARTHIK', ['KARTHIK', 'ROCK', 'AYANAKOJI', 'TOBI']),
    ('FFK JEEVAN', ['JEEVAN', 'IZUME', 'VISHAL', 'SASUKE']),
    ('FFK MANI', ['MANI', 'GOKU', 'SPIDER', 'ALONE']),
    ('FFK GOAT', ['GOAT', 'COBRA07', 'PIRAI', 'KAKASHI']),
    ('FFK FLASH', ['FLASH', 'PRADEEP', 'PIKACHU', 'SNIPER']),
    ('FFK PUGHAL', ['PUGHAL', 'PRIYAN', 'KARTHI', 'JAGU']),
]

def key(name):
    return re.sub(r'[^a-z0-9]', '', name.lower()).replace('ffk', '')

def main():
    with sqlite3.connect(ROOT / 'war.sqlite3') as db:
        if '--apply' in sys.argv:
            backup_dir = ROOT / '.ocr-cache'
            backup_dir.mkdir(exist_ok=True)
            backup = backup_dir / ('roster-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
            with sqlite3.connect(backup) as destination:
                db.backup(destination)
        db.execute('BEGIN IMMEDIATE')
        original = db.execute('SELECT value FROM settings WHERE key=?', ('state',)).fetchone()[0]
        state = json.loads(original)
        previous_teams = json.dumps(state['teams'], sort_keys=True)
        previous_matches = json.dumps(state['matches'], sort_keys=True)
        count = len(state['teams'])
        added = []
        for name, members in SQUADS:
            players = ['FFK ' + member for member in members]
            member_keys = set(map(key, players))
            if any(key(team['name']) == key(name) or len(member_keys & {key(p['name']) for p in team['players']}) >= 3 for team in state['teams']):
                continue
            slot = max([t.get('slot', 0) for t in state['teams']] + [0]) + 1
            team = {'id': str(uuid.uuid4()), 'name': name, 'slot': slot,
                    'players': [{'id': str(uuid.uuid4()), 'name': player, 'isCaptain': i == 0} for i, player in enumerate(players)]}
            state['teams'].append(team)
            added.append(name)
        assert json.dumps(state['teams'][:count], sort_keys=True) == previous_teams
        assert json.dumps(state['matches'], sort_keys=True) == previous_matches
        if '--apply' in sys.argv and added:
            db.execute('UPDATE settings SET value=? WHERE key=?', (json.dumps(state), 'state'))
        print(json.dumps({'applied': '--apply' in sys.argv, 'added': added, 'totalTeams': len(state['teams']), 'preservedMatches': len(state['matches'])}, indent=2))

if __name__ == '__main__':
    main()
