"""Server-side checks for the whole war state.

The browser already enforces these rules, but a signed-in client (or a bug) can send anything. The
server refuses a save that would introduce a problem: malformed teams or results, broken references,
impossible scores or placements, or a tournament advancement that does not follow the bracket.

Problems that already exist in the stored state are not held against a save (an install with older,
imperfect data must still be able to save), but a save may never add a new one.
"""

SETS = ('A', 'B', 'C')
PLAYOFF_FORMAT = 'page-playoff-v1'
PLAYOFF_KEYS = ('q1', 'eliminator', 'q2', 'final')
MAX_TEAMS, MAX_MATCHES = 200, 1000


def _is_text(value, low=1, high=200):
    return isinstance(value, str) and low <= len(value.strip()) and len(value) <= high


def _is_int(value, low, high):
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def problems(state):
    """Every rule the state breaks, as readable sentences (empty when the state is valid)."""
    out = []
    if not isinstance(state, dict):
        return ['The war data must be an object.']
    teams, matches, war = state.get('teams'), state.get('matches'), state.get('war')
    if not isinstance(teams, list) or not isinstance(matches, list):
        return ['Teams and matches must be lists.']
    if len(teams) > MAX_TEAMS or len(matches) > MAX_MATCHES:
        return ['Too many teams or matches.']
    unknown = set(state) - {'teams', 'matches', 'war'}
    if unknown:
        out.append('Unknown war data: ' + ', '.join(sorted(unknown)) + '.')

    team_ids, names, player_ids = set(), set(), set()
    for index, team in enumerate(teams):
        if not isinstance(team, dict):
            out.append(f'Team {index + 1} is not a team.')
            continue
        tid = team.get('id')
        if not _is_text(tid, 1, 100):
            out.append(f'Team {index + 1} has no ID.')
            continue
        if tid in team_ids:
            out.append(f'Team ID {tid} is used twice.')
        team_ids.add(tid)
        if not _is_text(team.get('name'), 1, 70):
            out.append(f'Team {index + 1} needs a name of up to 70 characters.')
        else:
            key = team['name'].strip().lower()
            if key in names:
                out.append(f'Team name {team["name"]} is used twice.')
            names.add(key)
        players = team.get('players')
        if not isinstance(players, list) or len(players) > 8:
            out.append(f'Team {team.get("name", index + 1)} has an invalid player list.')
            continue
        for player in players:
            if not isinstance(player, dict) or not _is_text(player.get('id'), 1, 100) or not _is_text(player.get('name'), 1, 90):
                out.append(f'Team {team.get("name", index + 1)} has an invalid player.')
                continue
            if player['id'] in player_ids:
                out.append(f'Player ID {player["id"]} is used twice.')
            player_ids.add(player['id'])
            aliases = player.get('ocrAliases', [])
            if not isinstance(aliases, list) or len(aliases) > 50 or not all(_is_text(a, 1, 120) for a in aliases):
                out.append(f'Player {player["name"]} has invalid name corrections.')

    match_ids, adjustment_ids = set(), set()
    staged = {s: [] for s in SETS}
    for index, match in enumerate(matches):
        label = f'Match {index + 1}'
        if not isinstance(match, dict):
            out.append(f'{label} is not a match.')
            continue
        mid = match.get('id')
        if not _is_text(mid, 1, 100):
            out.append(f'{label} has no ID.')
        elif mid in match_ids:
            out.append(f'Match ID {mid} is used twice.')
        match_ids.add(mid)
        if _is_text(match.get('name'), 1, 120):
            label = match['name']
        else:
            out.append(f'{label} needs a name.')
        stage = match.get('stage')
        if stage is not None and stage not in SETS:
            out.append(f'{label} has an unknown tournament set.')
        elif stage:
            staged[stage].append(match)
        rows = match.get('rows')
        if not isinstance(rows, list) or len(rows) != 12:
            out.append(f'{label} must contain 12 team results.')
            continue
        places, row_teams = set(), set()
        for row in rows:
            if not isinstance(row, dict):
                out.append(f'{label} has an invalid team result.')
                continue
            place, tid = row.get('placement'), row.get('teamId')
            if not _is_int(place, 1, 12) or place in places:
                out.append(f'{label}: every placement from 1 to 12 must appear once.')
            places.add(place)
            if tid not in team_ids:
                out.append(f'{label} refers to a team that is not registered.')
            elif tid in row_teams:
                out.append(f'{label} lists a team twice.')
            row_teams.add(tid)
            players = row.get('players')
            if not isinstance(players, list) or len(players) != 4:
                out.append(f'{label}: each team result needs exactly four players.')
                continue
            seen = set()
            for player in players:
                if not isinstance(player, dict) or not _is_text(player.get('playerId'), 1, 200) or not isinstance(player.get('name'), str) or len(player['name']) > 90:
                    out.append(f'{label}: a player entry is incomplete.')
                    continue
                if not _is_int(player.get('kills'), 0, 99):
                    out.append(f'{label}: kills must be whole numbers from 0 to 99.')
                if player['playerId'] in seen:
                    out.append(f'{label}: the same player appears twice in one team.')
                seen.add(player['playerId'])
            adjustments = row.get('adjustments', [])
            if not isinstance(adjustments, list):
                out.append(f'{label}: adjustments must be a list.')
                continue
            for adjustment in adjustments:
                if not isinstance(adjustment, dict) or not _is_int(adjustment.get('value'), -999, 999) or adjustment['value'] == 0 or not _is_text(adjustment.get('reason'), 1, 200):
                    out.append(f'{label}: each adjustment needs non-zero whole points and a reason.')
                    continue
                aid = adjustment.get('id')
                if aid is not None:
                    if aid in adjustment_ids:
                        out.append(f'{label}: the same adjustment was recorded twice.')
                    adjustment_ids.add(aid)
        corrections = match.get('corrections', [])
        if not isinstance(corrections, list) or not all(isinstance(c, dict) and _is_text(c.get('reason'), 1, 200) for c in corrections):
            out.append(f'{label}: corrections need a reason.')

    if war is not None:
        out.extend(_war_problems(war, team_ids, staged))
    return out


def _war_problems(war, team_ids, staged):
    out = []
    if not isinstance(war, dict):
        return ['Tournament data must be an object.']
    groups = war.get('groups') or {}
    qualified = war.get('qualified') or {}
    targets = war.get('targets') or {}
    if not isinstance(groups, dict) or not isinstance(qualified, dict) or not isinstance(targets, dict):
        return ['Tournament data is malformed.']
    for s in ('A', 'B'):
        members = groups.get(s, [])
        if not isinstance(members, list) or len(members) > 12 or len(set(members)) != len(members) or any(t not in team_ids for t in members):
            out.append(f'Set {s} must list up to 12 different registered teams.')
    a, b = set(groups.get('A') or []), set(groups.get('B') or [])
    if a & b:
        out.append('A team cannot play in both Set A and Set B.')
    for s in SETS:
        if s in targets and not _is_int(targets[s], 1, 99):
            out.append(f'Set {s} needs a planned match count from 1 to 99.')
        elif s in targets and len(staged[s]) > targets[s]:
            out.append(f'Set {s} has more saved matches than planned.')
    for s, cut, pool in (('A', 6, a), ('B', 6, b)):
        chosen = qualified.get(s)
        if chosen:
            if not isinstance(chosen, list) or len(chosen) != cut or len(set(chosen)) != cut or not set(chosen) <= pool:
                out.append(f'Set {s} qualifiers must be {cut} different teams from Set {s}.')
    semi = list(qualified.get('A') or []) + list(qualified.get('B') or [])
    if qualified.get('C'):
        chosen = qualified['C']
        if not (qualified.get('A') and qualified.get('B')):
            out.append('Set C qualifiers need confirmed qualifiers from A and B.')
        if not isinstance(chosen, list) or len(chosen) != 4 or len(set(chosen)) != 4 or not set(chosen) <= set(semi):
            out.append('The final four must be different Set C teams.')
    # Saved set matches may only use that set's teams.
    for s, pool in (('A', a), ('B', b), ('C', set(semi))):
        if not pool:
            continue
        for match in staged[s]:
            if any(isinstance(r, dict) and r.get('teamId') not in pool for r in match.get('rows') or []):
                out.append(f'{match.get("name", "A match")} uses a team that is not in Set {s}.')
    cs = war.get('cs') or {}
    if not isinstance(cs, dict):
        out.append('Clash Squad results are malformed.')
    elif war.get('csFormat') == PLAYOFF_FORMAT and cs:
        out.extend(_playoff_problems(cs, qualified.get('C') or []))
    return out


def _playoff_problems(cs, seeds):
    out = []
    if len(seeds) != 4:
        return ['Clash Squad results need the final four first.']
    unknown = set(cs) - set(PLAYOFF_KEYS)
    if unknown:
        out.append('Unknown Clash Squad fixtures: ' + ', '.join(sorted(unknown)) + '.')
    expected = {'q1': [seeds[0], seeds[1]], 'eliminator': [seeds[2], seeds[3]]}
    for key in PLAYOFF_KEYS:
        if key not in cs:
            continue
        result = cs[key]
        if key == 'q2':
            expected['q2'] = [cs.get('q1', {}).get('loser'), cs.get('eliminator', {}).get('winner')]
        if key == 'final':
            expected['final'] = [cs.get('q1', {}).get('winner'), cs.get('q2', {}).get('winner')]
        pair = expected.get(key)
        if not pair or None in pair:
            out.append(f'{key}: the earlier fixtures must be played first.')
            continue
        scores = result.get('scores') if isinstance(result, dict) else None
        if not isinstance(scores, list) or len(scores) != 2 or not all(_is_int(x, 0, 99) for x in scores) or scores[0] == scores[1]:
            out.append(f'{key}: scores must be two different whole numbers from 0 to 99.')
            continue
        if result.get('teams') != pair:
            out.append(f'{key}: the teams do not follow the bracket.')
            continue
        winner = pair[0] if scores[0] > scores[1] else pair[1]
        loser = pair[1] if winner == pair[0] else pair[0]
        if result.get('winner') != winner or result.get('loser') != loser:
            out.append(f'{key}: the winner does not match the score.')
    return out


def check_update(previous, new):
    """The first problem this save would add, or None when it may be stored."""
    before = set(problems(previous)) if isinstance(previous, dict) and previous else set()
    for problem in problems(new):
        if problem not in before:
            return problem
    return None
