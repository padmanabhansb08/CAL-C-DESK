"""Read a custom-room lobby screenshot: numbered slot cards, four player names each, two cards per row.

The lobby lists the teams by slot number, so a slot number is a team's identity for the whole tournament,
whatever its name or players are. This reads each visible slot's number and four names from the row
positions; slot numbers the reader misses are inferred from the layout (cards run left to right, then down).
Several screenshots (the lobby scrolls) are merged by slot number.
"""
import re
import statistics
from collections import Counter

COLUMN_CENTRES = (0.369, 0.671)   # slot-number labels, as a fraction of the image width
SLOT_PITCH = 4.12                 # a slot card is this many name rows tall (rows are ~equal in height)
_NOISE = re.compile(r'^(spectator|list|\(?\d+/\d+\)?|invite|friends|not|in|team|start)$', re.I)


def _is_icon(text):
    return len(text) == 1 and ord(text) >= 0x2E80 or bool(re.fullmatch(r'[\W_]{1,2}', text))


def _rows(words, split):
    rows = []
    for w in sorted(words, key=lambda w: w.cy):
        if rows and w.cy - statistics.fmean(x.cy for x in rows[-1]) <= split:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [{'cy': statistics.fmean(x.cy for x in r), 'text': _join(sorted(r, key=lambda x: x.x0))} for r in rows]


def _join(words):
    """Words of one row; single letters set tightly together (a widely spaced name) are one word."""
    text = ''
    for i, w in enumerate(words):
        glued = i and len(w.text) == 1 and len(words[i - 1].text) == 1 and w.x0 - words[i - 1].x1 < 0.8 * max(w.h, 1)
        text += ('' if glued or not i else ' ') + w.text
    return re.sub(r'\s+', ' ', text).strip()


def parse_lobby(page):
    """Return {'slots': [{'slot': n, 'players': [4 names, '' when not visible], 'complete': bool}], 'warnings': [...]}."""
    W, H = page.width, page.height
    spectator = [w for w in page.words if w.text.upper().startswith('SPECTATOR')]
    top = 0.17 * H
    bottom = min([w.cy for w in spectator] + [0.78 * H + 8]) - 8
    words = [w for w in page.words if w.conf >= 0.3 and top <= w.cy <= bottom and w.cx >= 0.33 * W]

    # Slot-number labels: small digit-only words near the two label columns.
    anchors, columns = [], []
    for c, centre in enumerate(COLUMN_CENTRES):
        found = [w for w in words if re.fullmatch(r'\d{1,2}', w.text) and abs(w.cx - centre * W) <= 0.03 * W and w.w < 0.04 * W]
        columns.append(statistics.median([w.cx for w in found]) if found else centre * W)
        anchors += [(c, w.cy, int(w.text), w.conf) for w in found if 1 <= int(w.text) <= 99]
    anchors = [a for a in anchors if a[2] > 0]
    if not anchors:
        return {'slots': [], 'warnings': ['No slot numbers could be read in this lobby screenshot']}

    bounds = [(columns[0] + 0.015 * W, columns[1] - 0.015 * W), (columns[1] + 0.015 * W, 0.98 * W)]
    name_words = [w for w in words if not _NOISE.match(w.text) and not _is_icon(w.text)
                  and not (re.fullmatch(r'\d{1,2}', w.text) and w.w < 0.04 * W and any(abs(w.cx - c) <= 0.03 * W for c in columns))]
    per_column = [_rows([w for w in name_words if lo <= w.cx <= hi], 0.035 * H) for lo, hi in bounds]

    gaps = [b['cy'] - a['cy'] for rows in per_column for a, b in zip(rows, rows[1:])]
    pitch = statistics.median([g for g in gaps if g < 0.09 * H] or [0.07 * H])
    slot_h = SLOT_PITCH * pitch
    same = sorted(a for a in anchors if a[0] == anchors[0][0])
    if len(same) >= 2:
        steps = [(b[1] - a[1]) / max(1, round((b[1] - a[1]) / slot_h)) for a, b in zip(same, same[1:])]
        slot_h = statistics.median(steps)
    ncols = len(COLUMN_CENTRES)

    slots = {}
    for c, rows in enumerate(per_column):
        for row in rows:
            votes = Counter()
            for ac, acy, an, conf in anchors:
                k = round((row['cy'] - acy) / slot_h)
                votes[(an - ac + ncols * k + c, acy + k * slot_h)] += conf
            if not votes:
                continue
            (number, centre), _ = votes.most_common(1)[0]
            if number < 1:
                continue
            j = min(3, max(0, round((row['cy'] - centre) / pitch + 1.5)))
            entry = slots.setdefault(number, ['', '', '', ''])
            while j < 3 and entry[j]:
                j += 1
            if not entry[j]:
                entry[j] = row['text']
    out = [{'slot': n, 'players': p, 'complete': all(p)} for n, p in sorted(slots.items())]
    warnings = [f'Slot {s["slot"]} is partly hidden: scroll the lobby so all four names show' for s in out if not s['complete']]
    return {'slots': out, 'warnings': warnings}


def merge_lobbies(results):
    """Combine the slots of several lobby screenshots: for each slot, the fullest reading wins and
    names missing there are filled from the other screenshots."""
    merged = {}
    for result in results:
        for s in result.get('slots', []):
            cur = merged.setdefault(s['slot'], ['', '', '', ''])
            if sum(map(bool, s['players'])) > sum(map(bool, cur)):
                cur[:] = [n or cur[i] for i, n in enumerate(s['players'])]
            else:
                cur[:] = [cur[i] or n for i, n in enumerate(s['players'])]
    slots = [{'slot': n, 'players': p, 'complete': all(p)} for n, p in sorted(merged.items())]
    return {'slots': slots, 'warnings': [f'Slot {s["slot"]} is missing some players' for s in slots if not s['complete']]}


def scan_lobby(image_bytes):
    from .engine import read_page
    return parse_lobby(read_page(image_bytes))
