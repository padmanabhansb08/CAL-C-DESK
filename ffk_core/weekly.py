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


SLOT_SPLIT = re.compile(r'\s*(?:,|\||\t|\s{2,})\s*')


def parse_slot_list(text):
    """Turn a pasted or OCR-read slot list into ordered slots: one line per slot, four names each.

    Blank lines are skipped, a leading "1." / "1)" slot number is dropped, and names are split on commas,
    pipes, tabs or runs of two spaces. A slot needs at least four names; the first is the IGL (team name)."""
    slots = []
    for raw in str(text or '').splitlines():
        line = re.sub(r'^\s*\d+(?:\s*[.)]\s*|\t+)', '', raw).strip()
        if not line:
            continue
        names = [n.strip() for n in SLOT_SPLIT.split(line) if n.strip()]
        if len(names) < 4:
            raise ValueError(f'slot line needs four players: {raw.strip()!r}')
        slots.append(names[:4])
    if len(slots) < 2:
        raise ValueError('a slot list needs at least two slots')
    return slots


def parse_team_slots(text):
    """A numbered team-name slot list ("1. NORTH BENGAL ESP") as {slot number: team name}.

    Lines without a leading number (a "SLOT LIST" heading, blank lines) are ignored."""
    found = {}
    for raw in str(text or '').splitlines():
        m = re.match(r'^\W*?(\d{1,2})\s*[.):\-]\s*(.+?)\s*\W*$', raw.strip().replace('*', ''))
        if m and m.group(2).strip():
            found.setdefault(int(m.group(1)), m.group(2).strip())
    if not found:
        raise ValueError('no numbered slots found: write one team per line, like "1. TEAM NAME"')
    return found


def apply_lobby(state, entries):
    """Make the slot-wise teams current: each entry is {slot, name, players}.

    The slot number is the team's identity for the event; its name comes from the slot list and its
    players from the lobby. A team already registered under the same name keeps its ID and its players'
    IDs (matched by name), so earlier results stay attached. Returns the teams in slot order."""
    teams = state.setdefault('teams', [])
    taken, week = set(), []
    for entry in sorted(entries, key=lambda e: e['slot']):
        names = [n.strip() for n in entry.get('players', []) if n and n.strip()]
        name = (entry.get('name') or '').strip() or f"Slot {entry['slot']}"
        if not names and not entry.get('name'):
            continue
        team = next((t for t in teams if t['id'] not in taken and key(t['name']) == key(name)), None)
        if team is None:
            team = {'id': str(uuid.uuid4()), 'players': []}
            teams.append(team)
        taken.add(team['id'])
        previous = team.get('players', [])
        players = []
        for i, member in enumerate(names):
            old = next((p for p in previous if key(p['name']) == key(member)), None)
            player = dict(old) if old else {'id': str(uuid.uuid4())}
            player.update(name=member, isCaptain=i == 0)
            players.append(player)
        team.update(name=name, slot=entry['slot'], players=players)
        team.pop('rosterList', None)
        week.append(team)
    state['teams'] = week + [t for t in teams if t['id'] not in taken]
    return week


def apply_set_a(state, slots=None):
    """Make the poster teams current and suggest them as Set A. `slots` defaults to this week's built-in list.

    Returns True when state changed."""
    slots = SET_A if slots is None else slots
    teams = state.setdefault('teams', [])
    taken, week = set(), []
    for members in slots:
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
