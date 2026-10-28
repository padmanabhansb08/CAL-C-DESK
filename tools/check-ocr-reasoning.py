"""Check the OCR reasoning layer on synthetic word layouts. No OCR model is needed.

The text recogniser is replaced by the words it would have produced; what is tested is
everything after it: label/digit pairing, column and panel grouping, placement inference,
partial panels, name extraction, roster assignment and verification.
"""
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ocr_engine import engine, scoreboard, roster, verify
from ocr_engine.engine import Word, Page


def box(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def echo_reader(page, region, views=None, **_):
    """Stands in for the crop re-readers: returns the digit word that sits inside the region."""
    x0, y0, x1, y1 = region
    out = []
    for w in page.words:
        fused = re.match(r'(\d{1,2})Eliminations$', w.text)
        text = w.text if re.fullmatch(r'\d{1,2}', w.text) else (fused.group(1) if fused else None)
        if text and x0 - 4 <= w.x0 + 6 <= x1 + 4 and y0 - 4 <= w.cy <= y1 + 4:
            out.append((text, 0.95, 'fake'))
    return out


scoreboard.read_label_numbers = echo_reader
scoreboard.read_isolated_digits = echo_reader

LEFT_COLS, RIGHT_COLS = (512, 757), (1045, 1227)


def cell(words, x, cy, name, kills, fused_next=None):
    """One player cell: name words left of 'N Eliminations'."""
    words.append(Word('FFK', .97, box(x - 120, cy - 12, x - 96, cy + 12)))
    words.append(Word(name, .95, box(x - 90, cy - 12, x - 12, cy + 12)))
    if kills is not None:
        words.append(Word(str(kills), .99, box(x, cy - 12, x + 8, cy + 12)))
    words.append(Word('Eliminations', .96, box(x + 12, cy - 12, x + 84, cy + 12)))


def board(left, right, left_ranks, right_ranks, right_offset=0):
    """left/right: list of panels; panel = [[(name,kills),(name,kills)], [(name,kills),(name,kills)]]."""
    words = []
    for side, panels, cols, x_rank, ranks, offset in (
            (0, left, LEFT_COLS, 330, left_ranks, 0), (1, right, RIGHT_COLS, 890, right_ranks, right_offset)):
        for i, rows in enumerate(panels):
            top = 160 + offset + i * 81
            for r, row in enumerate(rows):
                if row is None:
                    continue
                cy = top + r * 33
                for c, (name, kills) in enumerate(row):
                    cell(words, cols[c], cy, name, kills)
            if i in ranks:
                words.append(Word(str(ranks[i]), 1.0, box(x_rank, top + 4, x_rank + 18, top + 30)))
    return Page(None, words, 1600, 720)


def parse(page):
    return scoreboard.parse_scoreboard(page)


# ---- 1. full screen: ranks 4/5 and 6.. readable, 1-3 inferred from order
P = lambda a, b, c, d: [[a, b], [c, d]]
left = [P(('NONAME', 7), ('Naruto', 9), ('DEEPAK', 7), ('XEBEC', 11)),
        P(('BABIN', 0), ('XPRIME', 2), ('LORD', 0), ('ZOROX', 1)),
        P(('Ram', 1), ('Zoro', 1), ('Vegito', 1), ('Bala', 1)),
        P(('SANJAY', 4), ('NIVASH', 3), ('DINESH', 1), ('SPEED', 2)),
        P(('ART', 3), ('DEVIL', 0), ('KAIPULLA', 2), ('ZEN', 2))]
right = [P((f'R{i}A', i), (f'R{i}B', 1), (f'R{i}C', 0), (f'R{i}D', 2)) for i in range(6)]
result = parse(board(left, right, {3: 4, 4: 5}, {0: 6, 1: 7, 2: 8, 3: 9, 4: 10, 5: 11}))
places = {(p['side'], p['index']): (p['placement'], p['placementSource']) for p in result['panels']}
assert [places[(0, i)][0] for i in range(5)] == [1, 2, 3, 4, 5], places
assert [places[(0, i)][1] for i in range(5)] == ['sequence'] * 3 + ['read'] * 2
assert [places[(1, i)][0] for i in range(6)] == [6, 7, 8, 9, 10, 11]
first = result['panels'][0]
assert [c['kills'] for c in first['cells']] == [7, 9, 7, 11], first['cells']
assert [c['name'] for c in first['cells']] == ['NONAME', 'Naruto', 'DEEPAK', 'XEBEC'], 'clan tag must be stripped'
assert all(c['kills'] is not None for p in result['panels'] for c in p['cells'])

# ---- 2. scrolled right list: only the bottom row of its first panel is visible, rank 7 labels it
scrolled_right = [[None, [('Crim', 2), ('Shadow', 0)]]] + [P((f'S{i}A', i), (f'S{i}B', 1), (f'S{i}C', 0), (f'S{i}D', 2)) for i in range(4)]
result = parse(board(left, scrolled_right, {3: 4, 4: 5}, {0: 7, 1: 8, 2: 9, 3: 10, 4: 11}, right_offset=-20))
partial = [p for p in result['panels'] if p['side'] == 1][0]
assert partial['partial'] == 'bottom' and partial['placement'] == 7, partial
assert partial['cells'][0] is None and partial['cells'][1] is None
assert [c['kills'] for c in partial['cells'][2:]] == [2, 0]
verify.verify_rows(result)
assert any('part of this panel' in n for n in partial['review'])

# ---- 3. a digit the recogniser missed stays unresolved instead of being guessed
gap = board([P(('A', 3), ('B', 4), ('C', 5), ('D', 6))] , [], {}, {})
gap.words = [w for w in gap.words if w.text != '4']
result = parse(gap)
cells = result['panels'][0]['cells']
assert cells[1]['kills'] is None and cells[0]['kills'] == 3 and cells[3]['kills'] == 6

# ---- 4. a digit fused to its label ("1Eliminations") and a name fused behind it ("EliminationsFK")
words = [Word('FFK', .9, box(380, 148, 404, 172)), Word('PRAGA', .99, box(410, 148, 470, 172)),
         Word('1Eliminations', .9, box(512, 148, 596, 172)),
         Word('FFK', .9, box(640, 148, 664, 172)), Word('NINJA', .99, box(668, 148, 730, 172)),
         Word('4', .99, box(757, 148, 765, 172)), Word('Eliminations', .96, box(770, 148, 842, 172))]
result = parse(Page(None, words, 1600, 720))
c = result['panels'][0]['cells']
assert c[0]['kills'] == 1 and c[0]['name'] == 'PRAGA' and c[1]['kills'] == 4 and c[1]['name'] == 'NINJA', c

# ---- 5. rosters: global assignment, decorative names, one team per panel
teams = [
    {'id': 'ram', 'name': 'FFK RAM', 'players': [{'id': n, 'name': 'FFK ' + n} for n in ('RAM', 'BALA', 'ZORO', 'VEGITO')]},
    {'id': 'obito', 'name': 'FFK KO OBITO', 'players': [{'id': n, 'name': 'FFK ' + n} for n in ('KO OBITO', 'TOM', 'ERDOR', 'BANKAI', 'KO TOBI')]},
    {'id': 'bobby', 'name': 'FFK BOBBY', 'players': [{'id': n, 'name': 'FFK ' + n} for n in ('BOBBY', 'SCARY05', 'WHITE', 'PRAVIN')]},
]
def panel_with(names):
    return {'placement': 1, 'review': [], 'cells': [{'name': n, 'rawName': n, 'kills': 1, 'killsConf': .9, 'killAlternatives': [], 'votes': []} for n in names]}
res = {'panels': [panel_with(['Ram01', 'FK”UT ぷ', 'VEGIT07', '']), panel_with(['KO ②BI', 'FKTOM', 'BANKAI', 'KTOBI']),
                  panel_with(['βOBBY', 'drK SCARYO5', '', ''])], 'warnings': []}
roster.match_rosters(res, {'teams': teams})
assert [p['team']['id'] for p in res['panels']] == ['ram', 'obito', 'bobby'], [p['team'] for p in res['panels']]
assert res['panels'][1]['cells'][1]['playerId'] == 'TOM' and res['panels'][0]['cells'][2]['playerId'] == 'VEGITO'
# the same weak panel cannot claim a team that a stronger panel holds
dup = {'panels': [panel_with(['Ram01', 'BALA', 'ZORO', 'VEGITO']), panel_with(['Ram01', '', '', ''])], 'warnings': []}
roster.match_rosters(dup, {'teams': teams})
assert dup['panels'][0]['team']['id'] == 'ram' and dup['panels'][1]['team']['id'] == '', dup['panels'][1]['team']
# similar names must not be merged: RAMBO is not RAM
assert roster.similarity('RAMBO', 'RAM') == 0 and roster.similarity('Ram01', 'RAM') > .9

# ---- 6. verification
bad = {'panels': [{'placement': 3, 'cells': [None] * 4, 'review': []}, {'placement': 3, 'cells': [None] * 4, 'review': []},
                  {'placement': 6, 'cells': [None] * 4, 'review': []}], 'warnings': []}
verify.verify_rows(bad)
assert any('Placement 3 was assigned to 2 panels' in w for w in bad['warnings']) and any('4, 5' in w for w in bad['warnings'])
print('PASS: label/digit pairing, column and panel grouping, placement inference, partial panels, fused words, name cleanup, roster assignment and verification.')
