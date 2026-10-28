"""Cross-checks over a whole scoreboard. These add warnings and review flags; they never invent values."""

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
                p.setdefault('review', []).append('Duplicate placement')
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
    total = 0
    for panel in panels:
        review = panel.setdefault('review', [])
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
            if cell['kills'] is not None and cell['kills'] > 30:
                review.append(f'Player {index + 1}: {cell["kills"]} kills is unusually high')
            if cell.get('clipped'):
                review.append(f'Player {index + 1}: row is cut off at the screen edge')
        if sum(1 for c in panel['cells'] if c) < 4 or panel.get('partial'):
            review.append('Only part of this panel is visible; use another screenshot to cover the rest')
        if panel['placement'] is None:
            review.append('Placement could not be determined')
        elif panel.get('placementSource') in ('assumed',):
            review.append('Placement was assumed from panel order')
    result['visibleKills'] = total
    cells = [c for p in panels for c in p['cells'] if c]
    result['summary'] = {
        'panels': len(panels),
        'cells': len(cells),
        'killsRead': sum(1 for c in cells if c['kills'] is not None),
        'needsReview': sum(1 for p in panels if p['review']),
    }
    return result
