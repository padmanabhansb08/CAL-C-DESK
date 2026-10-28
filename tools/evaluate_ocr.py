"""Evaluate the scoreboard OCR against the labelled screenshots in ocr-data/.

Usage: python tools/evaluate_ocr.py [--verbose] [--split train|held-out]
Reports, per field, whether the accepted kill count equals the manual label,
was left unresolved, or was accepted wrongly.
"""
import io
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ocr_engine import scan  # noqa: E402
import default_rosters  # noqa: E402

NAMES = {'21': '20.02.21', '22': '20.02.22', '30': '20.02.30', '30 (1)': '20.02.30 (1)', '31': '20.02.31',
         '31 (1)': '20.02.31 (1)', '39': '20.02.39', '39 (1)': '20.02.39 (1)', '47': '20.02.47', '48': '20.02.48'}


def image_path(key):
    return ROOT / 'ocr-data' / 'images' / f'WhatsApp Image 2026-10-18 at {NAMES[key]}.jpeg'


def default_roster():
    teams = []
    for squads in default_rosters.LISTS:
        for members in squads:
            teams.append({'id': members[0], 'name': 'FFK ' + members[0],
                          'players': [{'id': f'{members[0]}-{i}', 'name': 'FFK ' + m} for i, m in enumerate(members)]})
    teams.append({'id': 'VINI', 'name': 'FFK VINI', 'players': [{'id': f'VINI-{i}', 'name': n} for i, n in enumerate(default_rosters.VINI_MEMBERS)]})
    return {'teams': teams}


def degrade(data, kind):
    """Re-encode a screenshot the way real uploads get damaged."""
    from PIL import Image, ImageFilter
    im = Image.open(io.BytesIO(data)).convert('RGB')
    if kind == 'half-size':
        im = im.resize((im.width // 2, im.height // 2), Image.BILINEAR)
    elif kind == 'upscaled':
        im = im.resize((int(im.width * 1.6), int(im.height * 1.6)), Image.BICUBIC)
    elif kind == 'jpeg-q30':
        pass
    elif kind == 'blur':
        im = im.filter(ImageFilter.GaussianBlur(1.2))
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=30 if kind == 'jpeg-q30' else 85)
    return out.getvalue()


def stress():
    """Accuracy on re-encoded copies of the held-out screenshots."""
    labels = json.loads((ROOT / 'ocr-data' / 'labels.json').read_text())
    for kind in ('half-size', 'upscaled', 'jpeg-q30', 'blur'):
        fields = correct = wrong = 0
        for match in labels['matches']:
            if match['split'] != 'held-out':
                continue
            for key in match['files']:
                result = scan(degrade(image_path(key).read_bytes(), kind))
                for panel in result['panels']:
                    place = panel['placement']
                    if not place or place > 12:
                        continue
                    for ci, cell in enumerate(panel['cells']):
                        if cell is None:
                            continue
                        fields += 1
                        if cell['kills'] == match['kills'][place - 1][ci]:
                            correct += 1
                        elif cell['kills'] is not None:
                            wrong += 1
        print(f'{kind:10s}: {fields} fields | correct {correct} ({100*correct/max(1,fields):.1f}%) | wrong {wrong} | unresolved {fields-correct-wrong}')


def main():
    if '--stress' in sys.argv:
        return stress()
    verbose = '--verbose' in sys.argv
    split = sys.argv[sys.argv.index('--split') + 1] if '--split' in sys.argv else None
    labels = json.loads((ROOT / 'ocr-data' / 'labels.json').read_text())
    totals = {}
    team_labels = json.loads((ROOT / 'ocr-data' / 'team-labels.json').read_text())['frames']
    roster = default_roster()
    team_stats = {'panels': 0, 'correct': 0, 'wrong': 0, 'unmatched': 0}
    for match in labels['matches']:
        if split and match['split'] != split:
            continue
        t = totals.setdefault(match['split'], {'fields': 0, 'correct': 0, 'wrong': 0, 'unresolved': 0, 'placements_wrong': 0, 'secs': 0.0, 'frames': 0})
        for key in match['files']:
            start = time.time()
            result = scan(image_path(key).read_bytes(), roster)
            t['secs'] += time.time() - start
            t['frames'] += 1
            for panel in result['panels']:
                place = panel['placement']
                truth = team_labels.get(key, {}).get(str(place))
                if truth:
                    team_stats['panels'] += 1
                    got = (panel.get('team') or {}).get('id')
                    if not got:
                        team_stats['unmatched'] += 1
                        if verbose:
                            print(f'  frame {key} place {place}: team unmatched (expected {truth}); alts={(panel.get("team") or {}).get("alternatives")}')
                    elif got.upper().startswith(truth.upper().replace(' ', '')[:4]) or truth.upper().startswith(got.upper()[:4]):
                        team_stats['correct'] += 1
                    else:
                        team_stats['wrong'] += 1
                        print(f'  frame {key} place {place}: team WRONG expected {truth} got {got}')
                if not place or place > 12:
                    continue
                for ci, cell in enumerate(panel['cells']):
                    if cell is None:
                        continue
                    expected = match['kills'][place - 1][ci]
                    t['fields'] += 1
                    if cell['kills'] is None:
                        t['unresolved'] += 1
                        status = 'UNRESOLVED'
                    elif cell['kills'] == expected:
                        t['correct'] += 1
                        status = 'ok'
                    else:
                        t['wrong'] += 1
                        status = 'WRONG'
                    if verbose and status != 'ok':
                        print(f"  {match['id']} frame {key} place {place} cell {ci}: expected {expected}, got {cell['kills']} ({status}) votes={cell['votes']}")
            if verbose:
                print(match['id'], key, 'panels', [(p['placement'], p['placementSource']) for p in result['panels']], result['warnings'])
    for name, t in totals.items():
        print(f"{name}: {t['fields']} fields | correct {t['correct']} ({100*t['correct']/max(1,t['fields']):.1f}%) | wrong {t['wrong']} | unresolved {t['unresolved']} | {t['secs']/max(1,t['frames']):.1f}s per screenshot")

    print(f"teams: {team_stats['panels']} panels | correct {team_stats['correct']} | wrong {team_stats['wrong']} | unmatched {team_stats['unmatched']}")


if __name__ == '__main__':
    main()
