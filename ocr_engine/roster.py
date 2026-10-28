"""Match recognised names to the registered roster, using the whole scoreboard as evidence.

Per panel, the four recognised names are assigned to the four players of every
candidate team (best of all 24 pairings). Then one global assignment gives each
registered team to at most one panel, so a team cannot appear twice in a match
and a weak reading is settled by what the other panels already claimed.
"""
import itertools
import re
import unicodedata

# Common look-alike letters from decorative Unicode names (Cyrillic/Greek).
_LOOKALIKES = str.maketrans({
    'а': 'a', 'α': 'a', 'е': 'e', 'ε': 'e', 'ο': 'o', 'о': 'o', 'р': 'p', 'ρ': 'p', 'с': 'c',
    'х': 'x', 'χ': 'x', 'і': 'i', 'ι': 'i', 'ј': 'j', 'к': 'k', 'κ': 'k', 'м': 'm', 'μ': 'm',
    'т': 't', 'τ': 't', 'ν': 'v', 'υ': 'y', 'у': 'y', 'ѕ': 's', 'β': 'b', 'ß': 'b',
})
# Decorative digit-for-letter substitutions, used only as a second, slightly penalised comparison.
_LEET = str.maketrans({'0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b'})


def normalize(text):
    text = unicodedata.normalize('NFKD', str(text or '')).lower()
    text = ''.join(c for c in text if not unicodedata.combining(c)).translate(_LOOKALIKES)
    text = text.replace('ffk', '')
    return re.sub(r'[^0-9a-zÀ-￿]', '', text)


def _lev(a, b):
    row = list(range(len(a) + 1))
    for i in range(1, len(b) + 1):
        nxt = [i]
        for j in range(1, len(a) + 1):
            nxt.append(min(nxt[j - 1] + 1, row[j] + 1, row[j - 1] + (b[i - 1] != a[j - 1])))
        row = nxt
    return row[-1]


def _best_substring_distance(a, b):
    """Smallest edit distance between b and any substring of a."""
    prev = [0] * (len(a) + 1)
    for i in range(1, len(b) + 1):
        cur = [i]
        for j in range(1, len(a) + 1):
            cur.append(min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (b[i - 1] != a[j - 1])))
        prev = cur
    return min(prev)


def _score(observed, registered, a, b):
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    words = [normalize(w) for w in re.split(r'[^\w]+', str(observed or '')) if normalize(w)]
    if len(b) >= 3 and b in words:
        return 0.98
    if len(b) >= 4 and b in a:
        return 0.96
    if len(b) <= 3:
        # Very short names need a whole word, or a small clan-tag remnant in front.
        # "Ram01" for RAM: the whole name plus a short decorative number.
        if len(b) == 3 and any(w.startswith(b) and 1 <= len(w) - len(b) <= 2 and w[len(b):].isdigit() for w in words):
            return 0.94
        return 0.94 if len(b) == 3 and a.endswith(b) and len(a) - len(b) <= 2 else 0.0
    ratio = 1 - _lev(a, b) / max(len(a), len(b))
    if len(b) >= 3:
        ratio = max(ratio, 1 - _best_substring_distance(a, b) / len(b))
    letters_a, letters_b = re.sub(r'\d', '', a), re.sub(r'\d', '', b)
    if len(letters_b) >= 4 and letters_b in letters_a:
        ratio = max(ratio, 0.9)
    return min(0.89, ratio)


def _identity(text):
    return re.sub(r'^ko(?=[a-z]{3})', '', text)


def similarity(observed, registered):
    """0..1 score that the recognised text is this registered player."""
    a, b = normalize(observed), normalize(registered)
    if not a or not b:
        return 0.0
    best = _score(observed, registered, a, b)
    ia, ib = _identity(a), _identity(b)
    if (ia, ib) != (a, b) and len(ib) >= 3 and ia not in ('ko', 'ffk', ''):
        best = max(best, 0.97 * _score(ia, ib, ia, ib))
    fa, fb = a.translate(_LEET), b.translate(_LEET)
    if (fa, fb) != (a, b) and len(fb) >= 4:
        best = max(best, 0.95 * _score(fa, fb, fa, fb))
    return min(best, 1.0)


def player_similarity(observed, player):
    key = normalize(observed)
    if len(key) >= 4 and any(normalize(al) == key for al in player.get('aliases', [])):
        return 1.0
    return similarity(observed, player['name'])


def _assign_players(names, team):
    """Best pairing of up to four recognised names to the team's players."""
    players = team['players']
    best = (-1.0, [])
    idx = range(len(players))
    for perm in itertools.permutations(idx, min(4, len(players))):
        total = sum(player_similarity(names[i], players[j]) if names[i] else 0.0 for i, j in enumerate(perm))
        if total > best[0]:
            best = (total, list(perm))
    return best[0] / 4, best[1]


def _hungarian(cost):
    """Minimum-cost assignment for a rectangular matrix (rows <= cols), O(n^2 m)."""
    n, m = len(cost), len(cost[0])
    inf = float('inf')
    u, v, p, way = [0.0] * (n + 1), [0.0] * (m + 1), [0] * (m + 1), [0] * (m + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0
        minv, used = [inf] * (m + 1), [False] * (m + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], inf, 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    result = [None] * n
    for j in range(1, m + 1):
        if p[j]:
            result[p[j] - 1] = j - 1
    return result


def _team_ok(score, strong, anchors, margin):
    """Accept a team only on distinct-player evidence that clearly beats the runner-up."""
    if margin < 0.12:
        return False
    return strong >= 2 or (anchors >= 1 and score >= 0.45)


def match_rosters(result, roster):
    teams = roster.get('teams', [])
    panels = result['panels']
    if not teams or not panels:
        return result
    # Panel x team score matrix with the per-cell player pairing.
    table = []
    for panel in panels:
        names = [(c['rawName'] or c['name']) if c else '' for c in panel['cells']]
        row = []
        for team in teams:
            if len(team['players']) < 4 and len(team['players']) == 0:
                row.append((0.0, []))
            else:
                row.append(_assign_players(names, team))
        table.append(row)
    n, m = len(panels), len(teams)
    size = max(n, m)
    cost = [[1.0 - (table[i][j][0] if i < n and j < m else 0.0) for j in range(size)] for i in range(size)]
    chosen = _hungarian(cost)
    for i, panel in enumerate(panels):
        j = chosen[i] if i < len(chosen) else None
        scores = sorted(((table[i][k][0], k) for k in range(m)), reverse=True)
        own = table[i][j][0] if j is not None and j < m else 0.0
        # Margin against the best team that a *different* panel is not already holding more strongly.
        rival = next((s for s, k in scores if k != j), 0.0)
        pairing = table[i][j][1] if j is not None and j < m else []
        team = teams[j] if j is not None and j < m else None
        player_scores = []
        if team:
            names = [(c['rawName'] or c['name']) if c else '' for c in panel['cells']]
            for ci, pj in enumerate(pairing):
                player_scores.append(player_similarity(names[ci], team['players'][pj]) if names[ci] else 0.0)
        strong = sum(1 for s in player_scores if s >= 0.7)
        anchors = sum(1 for s in player_scores if s >= 0.94)
        ok = bool(team) and _team_ok(own, strong, anchors, own - rival)
        # A globally forced choice (the best team was taken by a stronger panel) needs stronger evidence.
        taken_better = team is not None and scores and scores[0][1] != j and scores[0][0] > own + 0.05
        panel['team'] = {
            'id': team['id'] if ok else '',
            'name': team['name'] if ok else '',
            'score': round(own, 3),
            'margin': round(own - rival, 3),
            'resolvedGlobally': bool(ok and taken_better),
            'alternatives': [{'id': teams[k]['id'], 'name': teams[k]['name'], 'score': round(s, 3)} for s, k in scores[:3] if s > 0],
        } if team else {'id': '', 'name': '', 'score': 0, 'margin': 0, 'resolvedGlobally': False, 'alternatives': []}
        if ok:
            for ci, pj in enumerate(pairing):
                cell = panel['cells'][ci]
                if not cell:
                    continue
                s = player_scores[ci]
                others = [player_similarity(cell['rawName'] or cell['name'], p) for k, p in enumerate(team['players']) if k != pj]
                cell['matchScore'] = round(s, 3)
                if s >= 0.7 and s - max([0.0] + others) >= 0.12:
                    cell['playerId'] = team['players'][pj]['id']
                    cell['playerName'] = team['players'][pj]['name']
    return result
