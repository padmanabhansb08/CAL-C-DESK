"""Server-side checks for the whole war state.

The browser already enforces these rules, but a signed-in client (or a bug) can send anything. The
server refuses a save that would introduce a problem: malformed teams or results, broken references,
impossible scores or placements, or a tournament advancement that does not follow the bracket.

Problems that already exist in the stored state are not held against a save (an install with older,
imperfect data must still be able to save), but a save may never add a new one.
"""

import json
from collections import Counter


SETS = ('A', 'B', 'C')
PLAYOFF_FORMAT = 'page-playoff-v1'
PLAYOFF_KEYS = ('q1', 'eliminator', 'q2', 'final')
MAX_TEAMS, MAX_MATCHES = 200, 1000


def _is_text(value, low=1, high=200):
    return isinstance(value, str) and low <= len(value.strip()) and len(value) <= high


def _is_int(value, low, high):
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


class _Problem(str):
    """Readable to callers, but compare the exact field and bad value for legacy saves."""
    def __new__(cls, message, path, code, value):
        obj = super().__new__(cls, message)
        obj.key = (tuple(path), code, json.dumps(value, sort_keys=True, ensure_ascii=False))
        return obj


class _Issues(list):
    def add(self, path, code, message, value):
        self.append(_Problem(message, path, code, value))


def _mapping(value):
    return value if isinstance(value, dict) else {}


def _list(value):
    return value if isinstance(value, list) else []


def _texts(value):
    return isinstance(value, list) and all(_is_text(v, 1, 100) for v in value)


def _identity(value, index):
    return value if _is_text(value, 1, 100) else f'item-{index}'


def _historical_players(previous):
    """Only preserve a removed player in the exact match/team where they already appeared."""
    found = {}
    previous_matches = _mapping(previous).get('matches', [])
    for match in previous_matches if isinstance(previous_matches, list) else []:
        if not isinstance(match, dict) or not _is_text(match.get('id'), 1, 100):
            continue
        for row in match.get('rows', []) if isinstance(match.get('rows'), list) else []:
            if not isinstance(row, dict) or not _is_text(row.get('teamId'), 1, 100):
                continue
            ids = {p['playerId'] for p in row.get('players', []) if isinstance(p, dict) and _is_text(p.get('playerId'), 1, 200)} if isinstance(row.get('players'), list) else set()
            found.setdefault((match['id'], row['teamId']), set()).update(ids)
    return found


def problems(state, previous=None):
    """Every broken rule, with field-specific identities for safe legacy comparisons."""
    out = _Issues()
    if not isinstance(state, dict):
        out.add((), 'object', 'The war data must be an object.', state)
        return out
    teams, matches, war = state.get('teams'), state.get('matches'), state.get('war')
    if not isinstance(teams, list) or not isinstance(matches, list):
        out.add((), 'lists', 'Teams and matches must be lists.', [teams, matches])
        return out
    if len(teams) > MAX_TEAMS or len(matches) > MAX_MATCHES:
        out.add((), 'limit', 'Too many teams or matches.', [len(teams), len(matches)])
    unknown = set(state) - {'teams', 'matches', 'war'}
    if unknown:
        out.add((), 'unknown', 'Unknown war data: ' + ', '.join(sorted(unknown)) + '.', sorted(unknown))
    team_ids, names, player_ids, rosters = set(), set(), set(), {}
    for index, team in enumerate(teams):
        path = ('teams', _identity(_mapping(team).get('id'), index))
        if not isinstance(team, dict):
            out.add(path, 'team', f'Team {index + 1} is not a team.', team)
            continue
        tid = team.get('id')
        if not _is_text(tid, 1, 100):
            out.add(path, 'id', f'Team {index + 1} has no ID.', tid)
            continue
        if tid in team_ids:
            out.add(path + (index,), 'duplicate', f'Team ID {tid} is used twice.', tid)
        team_ids.add(tid)
        if not _is_text(team.get('name'), 1, 70):
            out.add(path, 'name', f'Team {index + 1} needs a name of up to 70 characters.', team.get('name'))
        else:
            key = team['name'].strip().lower()
            if key in names:
                out.add(path, 'duplicate-name', f'Team name {team["name"]} is used twice.', team['name'])
            names.add(key)
        players = team.get('players')
        if not isinstance(players, list) or not 4 <= len(players) <= 5:
            out.add(path, 'players', f'Team {team.get("name", index + 1)} has an invalid player list.', players)
            continue
        rosters[tid] = set()
        for j, player in enumerate(players):
            pp = path + ('players', _identity(_mapping(player).get('id'), j))
            if not isinstance(player, dict) or not _is_text(player.get('id'), 1, 100) or not _is_text(player.get('name'), 1, 90):
                out.add(pp, 'player', f'Team {team.get("name", index + 1)} has an invalid player.', player)
                continue
            if player['id'] in player_ids:
                out.add(pp, 'duplicate', f'Player ID {player["id"]} is used twice.', player['id'])
            player_ids.add(player['id'])
            rosters[tid].add(player['id'])
            aliases = player.get('ocrAliases', [])
            if not isinstance(aliases, list) or len(aliases) > 50 or not all(_is_text(a, 1, 120) for a in aliases):
                out.add(pp, 'aliases', f'Player {player["name"]} has invalid name corrections.', aliases)
    historical = _historical_players(previous)
    match_ids, adjustment_ids = set(), set()
    staged = {s: [] for s in SETS}
    for index, match in enumerate(matches):
        label = f'Match {index + 1}'
        path = ('matches', _identity(_mapping(match).get('id'), index))
        if not isinstance(match, dict):
            out.add(path, 'match', f'{label} is not a match.', match)
            continue
        mid = match.get('id')
        if not _is_text(mid, 1, 100):
            out.add(path, 'id', f'{label} has no ID.', mid)
        elif mid in match_ids:
            out.add(path + (index,), 'duplicate', f'Match ID {mid} is used twice.', mid)
        else:
            match_ids.add(mid)
        if _is_text(match.get('name'), 1, 120):
            label = match['name']
        else:
            out.add(path, 'name', f'{label} needs a name.', match.get('name'))
        stage = match.get('stage')
        if stage is not None and (not isinstance(stage, str) or stage not in SETS):
            out.add(path, 'stage', f'{label} has an unknown tournament set.', stage)
        elif stage:
            staged[stage].append(match)
        rows = match.get('rows')
        if not isinstance(rows, list) or len(rows) != 12:
            out.add(path, 'rows', f'{label} must contain 12 team results.', rows)
            continue
        places, row_teams, match_players = set(), set(), set()
        row_occurrences = Counter()
        for k, row in enumerate(rows):
            row_key = _identity(_mapping(row).get('teamId'), k)
            row_occurrences[row_key] += 1
            rp = path + ('rows', row_key, row_occurrences[row_key])
            if not isinstance(row, dict):
                out.add(rp, 'row', f'{label} has an invalid team result.', row)
                continue
            place, tid = row.get('placement'), row.get('teamId')
            if not _is_int(place, 1, 12) or place in places:
                out.add(rp, 'placement', f'{label}: every placement from 1 to 12 must appear once.', place)
            if _is_int(place, 1, 12):
                places.add(place)
            if not _is_text(tid, 1, 100) or tid not in team_ids:
                out.add(rp, 'team', f'{label} refers to a team that is not registered.', tid)
            elif tid in row_teams:
                out.add(rp, 'duplicate-team', f'{label} lists a team twice.', tid)
            else:
                row_teams.add(tid)
            players = row.get('players')
            if not isinstance(players, list) or len(players) != 4:
                out.add(rp, 'players', f'{label}: each team result needs exactly four players.', players)
                continue
            seen = set()
            player_occurrences = Counter()
            allowed = rosters.get(tid, set()) if isinstance(tid, str) else set()
            kept = historical.get((mid, tid), set()) if isinstance(mid, str) and isinstance(tid, str) else set()
            for j, player in enumerate(players):
                player_key = _identity(_mapping(player).get('playerId'), j)
                player_occurrences[player_key] += 1
                pp = rp + ('players', player_key, player_occurrences[player_key])
                if not isinstance(player, dict) or not _is_text(player.get('playerId'), 1, 200) or not _is_text(player.get('name'), 1, 90):
                    out.add(pp, 'player', f'{label}: a player entry is incomplete.', player)
                    continue
                pid = player['playerId']
                if not _is_int(player.get('kills'), 0, 99):
                    out.add(pp, 'kills', f'{label}: kills must be whole numbers from 0 to 99.', player.get('kills'))
                if pid in seen:
                    out.add(pp, 'duplicate-player', f'{label}: the same player appears twice in one team.', pid)
                if pid in match_players and pid not in seen:
                    out.add(pp, 'cross-team-player', f'{label}: the same player appears for more than one team.', pid)
                seen.add(pid)
                match_players.add(pid)
                if not player.get('isSubstitute') and pid not in allowed and pid not in kept:
                    out.add(pp, 'roster', f'{label}: a player does not belong to this team; mark a match-only substitute explicitly.', pid)
            adjustments = row.get('adjustments', [])
            if not isinstance(adjustments, list):
                out.add(rp, 'adjustments', f'{label}: adjustments must be a list.', adjustments)
                continue
            for j, adjustment in enumerate(adjustments):
                ap = rp + ('adjustments', j)
                if not isinstance(adjustment, dict) or not _is_int(adjustment.get('value'), -999, 999) or adjustment['value'] == 0 or not _is_text(adjustment.get('reason'), 1, 200):
                    out.add(ap, 'adjustment', f'{label}: each adjustment needs non-zero whole points and a reason.', adjustment)
                    continue
                aid = adjustment.get('id')
                if aid is not None:
                    if not _is_text(aid, 1, 200):
                        out.add(ap, 'id', f'{label}: an adjustment ID is invalid.', aid)
                    elif aid in adjustment_ids:
                        out.add(ap, 'duplicate', f'{label}: the same adjustment was recorded twice.', aid)
                    else:
                        adjustment_ids.add(aid)
        corrections = match.get('corrections', [])
        if not isinstance(corrections, list) or not all(isinstance(c, dict) and _is_text(c.get('reason'), 1, 200) for c in corrections):
            out.add(path, 'corrections', f'{label}: corrections need a reason.', corrections)
    if war is not None:
        _war_problems(war, team_ids, staged, out)
    elif any(staged.values()):
        out.add(('war',), 'missing', 'Tournament matches need tournament data.', None)
    return out


def _war_problems(war, team_ids, staged, out):
    path = ('war',)
    if not isinstance(war, dict):
        out.add(path, 'object', 'Tournament data must be an object.', war)
        return
    groups, qualified, targets = war.get('groups', {}), war.get('qualified', {}), war.get('targets', {})
    if not isinstance(groups, dict) or not isinstance(qualified, dict) or not isinstance(targets, dict):
        out.add(path, 'maps', 'Tournament data is malformed.', [groups, qualified, targets])
        return
    pools = {}
    for s in ('A', 'B'):
        members = groups.get(s, [])
        if not _texts(members) or len(members) > 12 or len(set(members)) != len(members) or any(t not in team_ids for t in members):
            out.add(path + ('groups', s), 'members', f'Set {s} must list up to 12 different registered teams.', members)
        pools[s] = set(members) if _texts(members) else set()
    if pools['A'] & pools['B']:
        out.add(path + ('groups',), 'overlap', 'A team cannot play in both Set A and Set B.', sorted(pools['A'] & pools['B']))
    for s in SETS:
        if s in targets and not _is_int(targets[s], 1, 99):
            out.add(path + ('targets', s), 'target', f'Set {s} needs a planned match count from 1 to 99.', targets[s])
        elif s in targets and len(staged[s]) > targets[s]:
            out.add(path + ('targets', s), 'excess', f'Set {s} has more saved matches than planned.', [len(staged[s]), targets[s]])
    for s in SETS:
        if s in qualified and not _texts(qualified[s]):
            out.add(path + ('qualified', s), 'list', f'Set {s} qualifiers must be a list of team IDs.', qualified[s])
    for s, cut in (('A', 6), ('B', 6)):
        chosen = qualified.get(s)
        if chosen and (not _texts(chosen) or len(chosen) != cut or len(set(chosen)) != cut or not set(chosen) <= pools[s]):
            out.add(path + ('qualified', s), 'qualifiers', f'Set {s} qualifiers must be {cut} different teams from Set {s}.', chosen)
    semi = [t for s in ('A', 'B') for t in (qualified.get(s) or [])] if all(_texts(qualified.get(s) or []) for s in ('A', 'B')) else []
    pools['C'] = set(semi)
    if qualified.get('C'):
        chosen = qualified['C']
        if not (qualified.get('A') and qualified.get('B')):
            out.add(path + ('qualified', 'C'), 'upstream', 'Set C qualifiers need confirmed qualifiers from A and B.', chosen)
        if not _texts(chosen) or len(chosen) != 4 or len(set(chosen)) != 4 or not set(chosen) <= pools['C']:
            out.add(path + ('qualified', 'C'), 'qualifiers', 'The final four must be different Set C teams.', chosen)
    for s in SETS:
        pool = pools[s]
        if staged[s] and len(pool) != 12:
            out.add(path + ('groups', s), 'full-set', f'Set {s} matches need 12 assigned or qualified teams.', sorted(pool))
        for match in staged[s]:
            rows = match.get('rows') or []
            if not isinstance(rows, list):
                continue
            if any(isinstance(r, dict) and (not isinstance(r.get('teamId'), str) or r.get('teamId') not in pool) for r in rows):
                out.add(('matches', match.get('id') if isinstance(match.get('id'), str) else '?'), 'set-member', f'{match.get("name", "A match")} uses a team that is not in Set {s}.', [r.get('teamId') for r in rows if isinstance(r, dict)])
        if qualified.get(s) and _texts(qualified.get(s)):
            _qualification_problems(s, 4 if s == 'C' else 6, pool, staged[s], targets.get(s, 6), qualified[s], _mapping(war.get('decisions')).get(s), out)
    cs = war.get('cs', {})
    if not isinstance(cs, dict):
        out.add(path + ('cs',), 'object', 'Clash Squad results are malformed.', cs)
    elif cs:
        if war.get('csFormat') != PLAYOFF_FORMAT:
            out.add(path + ('csFormat',), 'format', 'New Clash Squad results must use the current playoff format.', [war.get('csFormat'), cs])
        else:
            _playoff_problems(cs, qualified.get('C') or [], out)


def _qualification_problems(stage, cut, pool, matches, target, chosen, decision, out):
    path = ('war', 'qualified', stage)
    if not _is_int(target, 1, 99) or len(pool) != 12 or len(matches) != target:
        out.add(path, 'prerequisites', f'Save exactly {target} complete matches for Set {stage} before qualification.', [sorted(pool), len(matches), target, chosen])
        return
    totals = {tid: [0, 0, 0, 0] for tid in pool}
    placement_points = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0]
    for match in matches:
        rows = match.get('rows')
        if not isinstance(rows, list) or len(rows) != 12 or any(not isinstance(r, dict) or not isinstance(r.get('teamId'), str) for r in rows) or {r['teamId'] for r in rows} != pool:
            out.add(path, 'complete-matches', f'Every Set {stage} match must contain its 12 teams before qualification.', match)
            return
        if not all(_is_int(r.get('placement'), 1, 12) for r in rows) or {r['placement'] for r in rows} != set(range(1, 13)):
            out.add(path, 'complete-placements', f'Correct Set {stage} placements before qualification.', [r.get('placement') for r in rows])
            return
        for row in rows:
            players, adjustments, place = row.get('players'), row.get('adjustments', []), row.get('placement')
            if not _is_int(place, 1, 12) or not isinstance(players, list) or len(players) != 4 or not all(isinstance(p, dict) and _is_int(p.get('kills'), 0, 99) for p in players) or not isinstance(adjustments, list) or not all(isinstance(a, dict) and _is_int(a.get('value'), -999, 999) for a in adjustments):
                out.add(path, 'complete-values', f'Correct Set {stage} scores before qualification.', row)
                return
            kills = sum(p['kills'] for p in players)
            pp = placement_points[place - 1]
            t = totals[row['teamId']]
            t[0] += kills + pp + sum(a['value'] for a in adjustments)
            t[1] += kills
            t[2] += int(place == 1)
            t[3] += pp
    ranked = sorted(totals, key=lambda tid: totals[tid], reverse=True)
    edge = totals[ranked[cut - 1]]
    safe = {tid for tid in ranked if totals[tid] > edge}
    tied = {tid for tid in ranked if totals[tid] == edge}
    chosen_set = set(chosen)
    if len(chosen) != cut or not safe <= chosen_set or not chosen_set <= safe | tied:
        out.add(path, 'standings', f'Set {stage} qualifiers must follow the saved standings and cutoff tie decision.', chosen)
        return
    if any(totals[chosen[i]] < totals[chosen[i + 1]] for i in range(len(chosen) - 1)):
        out.add(path, 'seed-order', f'Set {stage} qualifier order must follow the standings.', chosen)
    if len(safe) + len(tied) > cut:
        decision = _mapping(decision)
        choices = decision.get('choices')
        if not _is_text(decision.get('reason'), 1, 200) or not _texts(choices) or len(choices) != cut - len(safe) or len(set(choices)) != len(choices) or set(choices) != chosen_set - safe:
            out.add(path, 'tie-decision', f'Set {stage} needs the chosen cutoff-tied teams and a host reason.', decision)


def _playoff_problems(cs, seeds, out):
    path = ('war', 'cs')
    if not _texts(seeds) or len(seeds) != 4:
        out.add(path, 'seeds', 'Clash Squad results need the final four first.', seeds)
        return
    unknown = set(cs) - set(PLAYOFF_KEYS)
    if unknown:
        out.add(path, 'unknown', 'Unknown Clash Squad fixtures: ' + ', '.join(sorted(unknown)) + '.', sorted(unknown))
    expected = {'q1': [seeds[0], seeds[1]], 'eliminator': [seeds[2], seeds[3]]}
    for key in PLAYOFF_KEYS:
        if key not in cs:
            continue
        result = cs[key]
        if key == 'q2':
            expected[key] = [_mapping(cs.get('q1')).get('loser'), _mapping(cs.get('eliminator')).get('winner')]
        if key == 'final':
            expected[key] = [_mapping(cs.get('q1')).get('winner'), _mapping(cs.get('q2')).get('winner')]
        pair = expected.get(key)
        if not pair or None in pair:
            out.add(path + (key,), 'prerequisites', f'{key}: the earlier fixtures must be played first.', result)
            continue
        scores = _mapping(result).get('scores')
        if not isinstance(scores, list) or len(scores) != 2 or not all(_is_int(x, 0, 99) for x in scores) or scores[0] == scores[1]:
            out.add(path + (key,), 'scores', f'{key}: scores must be two different whole numbers from 0 to 99.', result)
            continue
        if result.get('teams') != pair:
            out.add(path + (key,), 'teams', f'{key}: the teams do not follow the bracket.', result.get('teams'))
            continue
        winner = pair[0] if scores[0] > scores[1] else pair[1]
        loser = pair[1] if winner == pair[0] else pair[0]
        if result.get('winner') != winner or result.get('loser') != loser:
            out.add(path + (key,), 'winner', f'{key}: the winner does not match the score.', [result.get('winner'), result.get('loser')])


def check_update(previous, new):
    """Allow unchanged historical defects, never a new occurrence or changed invalid value."""
    before = Counter(p.key for p in problems(previous, previous)) if isinstance(previous, dict) and previous else Counter()
    for problem in problems(new, previous):
        if before[problem.key]:
            before[problem.key] -= 1
        else:
            return problem
    return None
