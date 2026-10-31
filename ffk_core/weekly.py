"""This week's Set A slot list (from the FFK Prasanth poster).

Players change from week to week; the IGL (first name in each slot) is the constant, so a slot is
matched to an existing team by its IGL and the team's players are replaced with the poster's four.
Player identities are kept where the same name is still listed, so earlier results stay attached.
"""
import re
import uuid

VERSION = 'ffk-set-a-week-v1'
SET_A = [
    ['SANJAY', 'VARUN', 'DARK', 'FLASH'],
    ['JEEVAN', 'IZUME', 'VISHAL', 'SASUKE'],
    ['VINI', 'HAKAI', 'PADHU', 'BALA'],
    ['SANJAY 1M', 'SASUKE', 'DINESH', 'SPEED'],
    ['AUTO BOTS', 'SARVESH', 'ITACHI', 'APPU'],
    ['KO OBITO', 'BANKAI', 'TOM', 'ERROR'],
    ['BABIN', 'PRIME', 'DREAM', 'ZOROX'],
    ['KAKASHI', 'RAVI', 'DEMON', 'PRAVEEN'],
    ['PRAGA', 'GOKUL', 'NINJA', 'HARI'],
    ['FLASH', 'AKASH', 'SPIDEY', 'SNIPER'],
    ['RAM', 'BALA', 'ZORO', 'VEGITO'],
    ['CAPS', 'EREN', 'DRAGON', 'VALIANT'],
]
PLAYOFF_FORMAT = 'page-playoff-v1'


def key(value):
    return re.sub(r'[^a-z0-9]', '', value.lower()).replace('ffk', '')


def _find_team(teams, taken, captain):
    exact = 'ffk ' + captain.lower()
    free = [t for t in teams if t['id'] not in taken]
    return (next((t for t in free if ' '.join(t['name'].lower().split()) == exact), None)
            or next((t for t in free if key(t['name']) == key(captain)), None))


def apply_set_a(state):
    """Make the 12 poster teams current and suggest them as Set A. Returns True when state changed."""
    teams = state.setdefault('teams', [])
    taken, week = set(), []
    for members in SET_A:
        team = _find_team(teams, taken, members[0])
        if team is None:
            team = {'id': str(uuid.uuid4()), 'name': 'FFK ' + members[0], 'players': []}
            teams.append(team)
        taken.add(team['id'])
        previous = team.get('players', [])
        players = []
        for i, member in enumerate(members):
            name = 'FFK ' + member
            old = next((p for p in previous if key(p['name']) == key(name)), None)
            player = dict(old) if old else {'id': str(uuid.uuid4())}
            player.update(name=name, isCaptain=i == 0)
            players.append(player)
        team['players'] = players
        week.append(team)
    # Set A teams first, in slot order, so the roster page reads like the poster.
    state['teams'] = week + [t for t in teams if t['id'] not in taken]

    war = state.get('war')
    ids = [t['id'] for t in week]
    started = any(m.get('stage') == 'A' for m in state.get('matches', []))
    if war is None:
        war = {'groups': {'A': [], 'B': []}, 'targets': {'A': 6, 'B': 6, 'C': 6},
               'qualified': {}, 'decisions': {}, 'cs': {}, 'csFormat': PLAYOFF_FORMAT}
    groups = war.setdefault('groups', {'A': [], 'B': []})
    # Only a suggestion: a set that already has saved results or qualifiers keeps its own teams.
    if not started and not (war.get('qualified') or {}).get('A') and not set(ids) & set(groups.get('B') or []):
        groups['A'] = ids
        state['war'] = war
    return True
