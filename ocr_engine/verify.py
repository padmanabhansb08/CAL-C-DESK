"""Cross-checks over a whole scoreboard. These add warnings and review flags; they never invent values.

Each panel gets `review` (readable sentences) and `flags` (the same findings as {code, player, text}),
so the review screen can keep a flag until the organizer has looked at it."""

HIGH_KILLS = 30


def _flag(panel, code, text, player=None):
    panel.setdefault('flags', []).append({'code': code, 'player': player, 'text': text})
    panel.setdefault('review', []).append(text)

def verify_rows(result):
    warnings = result.setdefault('warnings', [])
    panels = result['panels']
    seen = {}
    for panel in panels:
        place = panel['placement']
        if place is not None:
            seen.setdefault(place, []).append(panel)
    for place, group in seen.items():
        if len(group) > 1:
            warnings.append(f'Placement {place} was assigned to {len(group)} panels; check the placement numbers.')
            for p in group:
                _flag(p, 'duplicate_placement', f'Placement {place} was also found on another panel')
    placed = sorted(seen)
    if placed and placed[-1] - placed[0] + 1 != len(placed):
        missing = [p for p in range(placed[0], placed[-1] + 1) if p not in seen]
        warnings.append('Placements ' + ', '.join(map(str, missing)) + ' are missing between the visible panels.')
    claimed = {}
    for panel in panels:
        team = panel.get('team') or {}
        if team.get('id'):
            claimed.setdefault(team['id'], []).append(panel)
    for tid, group in claimed.items():
        if len(group) > 1:
            warnings.append(f"Team {group[0]['team']['name']} matched {len(group)} panels.")
            for p in group:
                _flag(p, 'team_repeated', f"{group[0]['team']['name']} also matched another panel")
    total = 0
    for panel in panels:
        review = panel.setdefault('review', [])
        panel.setdefault('flags', [])
        for index, cell in enumerate(panel['cells']):
            if cell is None:
                continue
            if cell['kills'] is not None:
                total += cell['kills']
            if cell['kills'] is None:
                review.append(f'Player {index + 1}: kill count unreadable' + (f" (candidates {cell['killAlternatives']})" if cell['killAlternatives'] else ''))
            elif cell['killsConf'] < 0.7:
                cell['lowConfidence'] = True
                review.append(f'Player {index + 1}: kill count uncertain')
            if cell['kills'] is not None and cell['kills'] > HIGH_KILLS:
                _flag(panel, 'high_kills', f'Player {index + 1}: {cell["kills"]} kills is unusually high', index)
            if cell.get('clipped'):
                _flag(panel, 'clipped', f'Player {index + 1}: row is cut off at the screen edge', index)
        if sum(1 for c in panel['cells'] if c) < 4 or panel.get('partial'):
            _flag(panel, 'partial', 'Only part of this panel is visible; use another screenshot to cover the rest')
        if panel['placement'] is None:
            _flag(panel, 'placement_unknown', 'Placement could not be determined')
        elif panel.get('placementSource') == 'assumed':
            _flag(panel, 'placement_assumed', 'Placement was assumed from panel order, not read')
        elif panel.get('placementSource') == 'disputed':
            _flag(panel, 'placement_disputed', f"The screen shows placement {panel.get('placementRead')} here, but the row order says {panel['placement']}")
    result['visibleKills'] = total
    cells = [c for p in panels for c in p['cells'] if c]
    result['summary'] = {
        'panels': len(panels),
        'cells': len(cells),
        'killsRead': sum(1 for c in cells if c['kills'] is not None),
        'needsReview': sum(1 for p in panels if p['review']),
    }
    return result
