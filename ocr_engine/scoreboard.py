"""Turn recognised words into scoreboard structure.

Nothing here is tied to pixel coordinates. Every threshold is relative to the
measured text height, so the same code handles other resolutions and crops.
The reasoning steps are:

1. find every "N Eliminations" label (the anchor for a player cell);
2. re-read each digit several independent ways and vote;
3. cluster anchors into columns, then panels (two rows x two columns);
4. read the large placement numbers and use panel order to fill the gaps;
5. attach the name text that sits to the left of each anchor.
"""
import re
import statistics

from .engine import Word, read_label_numbers, read_isolated_digits

LABEL = re.compile(r'elim(?:inat(?:ions|ion|io|i)?)?', re.I)
CLAN_TAG = re.compile(r'^[fF][fF]?[kK]\w{0,1}$')


class Anchor:
    def __init__(self, digit_box, label_box, line_text, line_conf, cy, h):
        self.digit_box = digit_box          # (x0, y0, x1, y1)
        self.label_box = label_box
        self.line_text = line_text          # digits as the full-page read saw them, or None
        self.line_conf = line_conf
        self.cy, self.h = cy, h
        self.kills = None
        self.kill_conf = 0.0
        self.alternatives = []
        self.votes = []

    @property
    def x0(self):
        return self.digit_box[0]

    @property
    def x1(self):
        return self.label_box[2]


# ---------------------------------------------------------------- anchors

def _split_label_words(words):
    """Return (anchors-without-digits, remaining words, tail words)."""
    labels, rest, tails = [], [], []
    for w in words:
        m = LABEL.search(w.text)
        if not m:
            rest.append(w)
            continue
        n = len(w.text)
        prefix, tail = w.text[:m.start()], w.text[m.end():]
        width = w.x1 - w.x0
        char = width / max(n, 1)
        label_x0 = w.x0 + char * m.start()
        label_x1 = w.x0 + char * m.end()
        digit = None
        if prefix:
            # Digit fused to the label: estimate its box from the character share (slightly wide).
            digit = (w.x0, w.y0, min(label_x0 + char * 0.6, w.x0 + char * len(prefix) * 1.6), w.y1)
            label_x0 = max(label_x0, digit[2])
        labels.append({'word': w, 'prefix': prefix, 'conf': w.conf,
                       'digit': digit, 'label': (label_x0, w.y0, label_x1, w.y1)})
        if len(tail) >= 2:
            tails.append(Word(tail, w.conf, [(label_x1, w.y0), (w.x1, w.y0), (w.x1, w.y1), (label_x1, w.y1)]))
    return labels, rest, tails


def find_anchors(words):
    labels, rest, tails = _split_label_words(words)
    anchors, used = [], set()
    digit_words = [w for w in rest if re.fullmatch(r'[0-9OoIl|]{1,2}', w.text)]
    for lab in labels:
        w = lab['word']
        if lab['digit'] is not None:
            line_text = lab['prefix']
            digit_box, line_conf = lab['digit'], lab['conf']
        else:
            # Nearest digit word immediately left of the label, on the same line.
            best = None
            for d in digit_words:
                if id(d) in used:
                    continue
                gap = lab['label'][0] - d.x1
                if -4 <= gap <= 1.4 * w.h and abs(d.cy - w.cy) <= 0.55 * w.h:
                    if best is None or gap < best[0]:
                        best = (gap, d)
            if best:
                d = best[1]
                used.add(id(d))
                digit_box, line_text, line_conf = (d.x0, d.y0, d.x1, d.y1), d.text, d.conf
            else:
                # The digit was not detected at all: look where it should be.
                x1 = lab['label'][0] - 1
                digit_box, line_text, line_conf = (x1 - 1.1 * w.h, w.y0, x1, w.y1), None, 0.0
        anchors.append(Anchor(digit_box, lab['label'], line_text, line_conf, w.cy, w.h))
    leftovers = [w for w in rest if id(w) not in used]
    return anchors, leftovers + tails


def _page_vote(a):
    if a.line_text is None:
        return []
    mapped = ''.join({'O': '0', 'o': '0', 'I': '1', 'l': '1', '|': '1'}.get(c, c) for c in a.line_text)
    if re.fullmatch(r'\d{1,2}', mapped):
        return [(mapped, a.line_conf * (1.0 if mapped == a.line_text else 0.8), 'page')]
    return []


def _tally(votes):
    """Weighted plurality over real readings. Abstentions lower confidence but never cancel a reading."""
    weights, counts = {}, {}
    for digits, conf, _ in votes:
        if digits is not None:
            weights[digits] = weights.get(digits, 0.0) + conf
            counts[digits] = counts.get(digits, 0) + 1
    if not weights:
        return None
    ranked = sorted(weights.items(), key=lambda kv: -kv[1])
    best, weight = ranked[0]
    share = weight / sum(weights.values())
    mean_conf = weight / counts[best]
    participation = sum(counts.values()) / max(1, len(votes))
    return {'value': best, 'share': share, 'mean': mean_conf, 'support': counts[best],
            'participation': participation, 'others': [int(d) for d, _ in ranked[1:]]}


def read_kills(page, anchors):
    """Read each kill count several independent ways and vote.

    A quick first pass (full-page read, one in-context re-read, one isolated
    re-read) settles easy digits. Anything contested gets every view.
    """
    for a in anchors:
        label_region = (a.digit_box[0], min(a.digit_box[1], a.label_box[1]), a.label_box[2], max(a.digit_box[3], a.label_box[3]))
        right = a.label_box[0] - 1.5
        left = a.digit_box[0] if a.line_text is not None else right - 1.0 * a.h
        iso_region = (min(left, right - 4), a.digit_box[1], right, a.digit_box[3])
        votes = _page_vote(a)
        votes += read_label_numbers(page, label_region, views={'raw'})
        votes += read_isolated_digits(page, iso_region, views={'raw'})
        t = _tally(votes)
        settled = (t and t['support'] >= 3 and t['share'] == 1.0 and t['mean'] >= 0.8) or (t and t['support'] >= 2 and not t['others'] and t['mean'] >= 0.9 and not a.line_text is None)
        if not settled:
            votes += read_label_numbers(page, label_region, views={'contrast', 'inverted', 'sharp'})
            votes += read_isolated_digits(page, iso_region, views={'contrast', 'inverted', 'sharp'})
            t = _tally(votes)
        a.votes = votes
        if not t:
            continue
        a.alternatives = t['others']
        a.kill_conf = round(t['share'] * t['mean'] * (0.6 + 0.4 * t['participation']), 3)
        # Accept a clear weighted majority backed by at least two independent readings.
        if t['share'] >= 0.6 and t['mean'] >= 0.5 and t['support'] >= 2:
            a.kills = int(t['value'])


# ---------------------------------------------------------------- clustering

def _cluster_1d(values, gap):
    order = sorted(range(len(values)), key=lambda i: values[i])
    groups, cur = [], [order[0]]
    for i in order[1:]:
        if values[i] - values[cur[-1]] > gap:
            groups.append(cur)
            cur = [i]
        else:
            cur.append(i)
    groups.append(cur)
    return groups


def _columns(anchors, height):
    groups = _cluster_1d([a.x0 for a in anchors], 1.5 * height)
    cols = [[anchors[i] for i in g] for g in groups]
    cols.sort(key=lambda c: statistics.mean(a.x0 for a in c))
    return cols


def _group_columns(cols, height, warnings):
    """Pair columns into panel sides (each side has two columns of cells)."""
    n = len(cols)
    if n == 0:
        return []
    if n == 1:
        warnings.append('Only one column of results was detected.')
        return [[cols[0]]]
    if n == 2:
        return [[cols[0], cols[1]]]
    centers = [statistics.mean(a.x0 for a in c) for c in cols]
    if n == 3:
        warnings.append('Three result columns were detected; one side is partly cut off.')
        if centers[1] - centers[0] <= centers[2] - centers[1]:
            return [[cols[0], cols[1]], [cols[2]]]
        return [[cols[0]], [cols[1], cols[2]]]
    if n > 4:
        warnings.append(f'{n} result columns were detected; check the grouping.')
    # Split at the widest inter-column gap that leaves two columns on each side where possible.
    return [cols[0:2], cols[2:4]] if n == 4 else [cols[: n // 2], cols[n // 2:]]


def _bands(anchors, height):
    anchors = sorted(anchors, key=lambda a: a.cy)
    bands = []
    for a in anchors:
        if bands and abs(a.cy - statistics.mean(x.cy for x in bands[-1])) <= 0.5 * height:
            bands[-1].append(a)
        else:
            bands.append([a])
    return bands


def _band_cy(band):
    return statistics.mean(a.cy for a in band)


def _pair_bands(bands, rank_cys, height):
    """Pair consecutive text rows into two-row panels, choosing the phase that best fits."""
    n = len(bands)
    cys = [_band_cy(b) for b in bands]
    if n == 1:
        return [[0]]
    best = None
    for phase in (0, 1):
        pairs, i = [], 0
        if phase == 1:
            pairs.append([0])
            i = 1
        while i < n:
            if i + 1 < n:
                pairs.append([i, i + 1])
                i += 2
            else:
                pairs.append([i])
                i += 1
        gaps = [cys[p[1]] - cys[p[0]] for p in pairs if len(p) == 2]
        cost = statistics.mean(gaps) if gaps else 1e9
        centers = [statistics.mean(cys[k] for k in p) for p in pairs]
        matched = 0
        for r in rank_cys:
            if any(abs(r - c) <= 0.6 * height for c, p in zip(centers, pairs) if len(p) == 2):
                matched += 1
        # More rank numbers sitting on panel centres wins; otherwise the tighter pairing.
        key = (-matched, cost)
        if best is None or key < best[0]:
            best = (key, pairs)
    return best[1]


# ---------------------------------------------------------------- names

def _clean_name(words):
    toks = [w for w in sorted(words, key=lambda w: w.x0)]
    raw = ' '.join(w.text for w in toks)
    texts = [w.text for w in toks]
    while texts and CLAN_TAG.match(texts[0]):
        texts.pop(0)
        toks = toks[1:]
    name = ' '.join(texts).strip()
    conf = 0.0
    if toks:
        total = sum(max(1, len(w.text)) for w in toks)
        conf = sum(w.conf * max(1, len(w.text)) for w in toks) / total
    return name, raw, round(conf, 3)


def _cell_name(words, anchor, lo, height, taken):
    """Words chained leftwards from the anchor, on the same text row, after bound lo."""
    row = [w for w in words if id(w) not in taken and abs(w.cy - anchor.cy) <= 0.7 * height
           and w.x1 <= anchor.x0 + 2 and w.x0 >= lo - 2]
    row.sort(key=lambda w: -w.x1)
    chain, edge = [], anchor.x0
    for w in row:
        if edge - w.x1 <= 2.6 * height:
            chain.append(w)
            edge = w.x0
        else:
            break
    for w in chain:
        taken.add(id(w))
    return chain


# ---------------------------------------------------------------- main

def parse_scoreboard(page):
    result = _parse(page)
    _to_original_pixels(result, page)
    return result


def _to_original_pixels(result, page):
    k = 1.0 / page.scale
    if k == 1.0:
        return
    result['width'], result['height'] = round(page.width * k), round(page.height * k)
    result['textHeight'] = round(result.get('textHeight', 0) * k, 1)
    for panel in result['panels']:
        panel['top'], panel['bottom'] = round(panel['top'] * k), round(panel['bottom'] * k)
        for cell in panel['cells']:
            if cell:
                for key in ('digits', 'name'):
                    cell['boxes'][key] = [round(v * k) for v in cell['boxes'][key]]


def _parse(page):
    words = page.words
    warnings = []
    anchors, others = find_anchors(words)
    if not anchors:
        return {'width': page.width, 'height': page.height, 'panels': [],
                'warnings': ['No "Eliminations" labels were found. Is this a results screen?']}
    height = statistics.median(a.h for a in anchors)
    read_kills(page, anchors)

    # Rank numbers: 1-2 digit words that are not part of a label.
    rank_words = []
    for w in others:
        if re.fullmatch(r'\d{1,2}', w.text) and 1 <= int(w.text) <= 12 and w.conf >= 0.6 and w.h >= 0.8 * height:
            rank_words.append(w)

    cols = _columns(anchors, height)
    sides = _group_columns(cols, height, warnings)
    panels = []
    taken = set(id(w) for w in rank_words)
    for side_index, side_cols in enumerate(sides):
        side_anchors = [a for c in side_cols for a in c]
        left = min(a.x0 for a in side_anchors)
        right = max(a.x1 for a in side_anchors)
        # A side's rank numbers sit just left of its first column.
        stride = (side_cols[-1][0].x0 - side_cols[0][0].x0) if len(side_cols) > 1 else 6 * height
        side_ranks = [w for w in rank_words if left - 1.4 * stride <= w.x0 and w.x1 <= left - 0.2 * stride + 4 * height]
        # Keep only the rank words closest to this side (avoid the neighbouring side's numbers).
        side_ranks = [w for w in side_ranks if _nearest_side(w, sides) == side_index]
        bands = _bands(side_anchors, height)
        pair_idx = _pair_bands(bands, [w.cy for w in side_ranks], height)
        panel_rows = []
        for p in pair_idx:
            rows = [bands[i] for i in p]
            panel_rows.append(rows)
        centers = []
        for rows in panel_rows:
            if len(rows) == 2:
                centers.append(statistics.mean(_band_cy(r) for r in rows))
            else:
                centers.append(None)
        gaps = [centers[i + 1] - centers[i] for i in range(len(centers) - 1) if centers[i] and centers[i + 1]]
        pitch = statistics.median(gaps) if gaps else 3.2 * height
        # Singles: decide whether the visible row is the top or bottom row of its panel.
        for i, rows in enumerate(panel_rows):
            if len(rows) == 1:
                cy = _band_cy(rows[0])
                near = [w for w in side_ranks if abs(w.cy - cy) <= 0.9 * pitch / 2 + 0.3 * height]
                if near:
                    top = near[0].cy > cy
                else:
                    # A lone first row is the bottom of a panel scrolled off the top;
                    # a lone last row is the top of one scrolled off the bottom.
                    top = i != 0 or len(panel_rows) == 1
                centers[i] = cy + (pitch * 0.2 if top else -pitch * 0.2)
                rows.append(('top' if top else 'bottom'))
        ranks = _assign_ranks(panel_rows, centers, side_ranks, pitch, side_index, height, warnings)
        group_left_bound = min([w.x1 for w in side_ranks], default=None)
        for i, rows in enumerate(panel_rows):
            kind = None
            real = [r for r in rows if isinstance(r, list)]
            if len(real) == 1:
                kind = rows[-1]
                grid = {(0 if kind == 'top' else 1): real[0]}
            else:
                grid = {0: real[0], 1: real[1]}
            cells = []
            for r in (0, 1):
                band = grid.get(r)
                band_cells = _band_cells(band, side_cols, words, others, height, group_left_bound, taken) if band else [None, None]
                for c in (0, 1):
                    cells.append(band_cells[c] if band else None)
            top_y = min(a.cy for r in real for a in r) - height
            bottom_y = max(a.cy for r in real for a in r) + height
            panels.append({
                'side': side_index, 'index': i,
                'placement': ranks[i][0], 'placementSource': ranks[i][1],
                'placementRead': ranks[i][2] if len(ranks[i]) > 2 else None,
                'top': round(top_y), 'bottom': round(bottom_y),
                'partial': kind, 'cells': cells,
            })
    panels.sort(key=lambda p: (p['side'], p['index']))
    return {'width': page.width, 'height': page.height, 'textHeight': round(height, 1),
            'panels': panels, 'warnings': warnings}


def _nearest_side(word, sides):
    best, best_d = 0, 1e9
    for i, cols in enumerate(sides):
        left = min(a.x0 for c in cols for a in c)
        d = abs(left - word.x1)
        if word.x1 <= left + 4 and d < best_d:
            best, best_d = i, d
    return best


def _assign_ranks(panel_rows, centers, side_ranks, pitch, side_index, height, warnings):
    n = len(panel_rows)
    observed = []
    for i, c in enumerate(centers):
        if c is None:
            continue
        near = [w for w in side_ranks if abs(w.cy - c) <= 0.45 * pitch]
        if near:
            w = min(near, key=lambda w: abs(w.cy - c))
            observed.append((i, int(w.text)))
    offsets = {}
    for i, r in observed:
        offsets[r - i] = offsets.get(r - i, 0) + 1
    result = [(None, None)] * n
    if offsets:
        ranked = sorted(offsets.items(), key=lambda kv: -kv[1])
        if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
            warnings.append('Placement numbers disagree about the order of the rows.')
            for i, r in observed:
                result[i] = (r, 'read')
            return result
        base = ranked[0][0]
        for i in range(n):
            read_here = next((r for j, r in observed if j == i), None)
            value = base + i
            if 1 <= value <= 12:
                if read_here is not None and read_here != value:
                    # The row order outvoted a number that was actually read here. Keep the order's value,
                    # but say so: either reading could be the wrong one.
                    result[i] = (value, 'disputed', read_here)
                    warnings.append(f'A placement number reads {read_here} where the row order says {value}; check placement {value}.')
                else:
                    result[i] = (value, 'read' if read_here == value else 'sequence')
        return result
    if side_index == 0:
        warnings.append('No placement numbers could be read; assuming the first panel is placement 1.')
        for i in range(n):
            result[i] = (1 + i, 'assumed')
    else:
        warnings.append('No placement numbers could be read on the right-hand side; review placements.')
    return result


def _band_cells(band, side_cols, words, others, height, left_bound, taken):
    """Return [cell0, cell1] for one text row of a panel."""
    cells = [None, None]
    by_col = {}
    for a in band:
        col_index = min(range(len(side_cols)), key=lambda k: abs(statistics.mean(x.x0 for x in side_cols[k]) - a.x0))
        by_col[col_index] = a
    lo = left_bound if left_bound is not None else -1e9
    prev_end = lo
    for col in sorted(by_col):
        a = by_col[col]
        chain = _cell_name(others, a, prev_end, height, taken)
        name, raw, conf = _clean_name(chain)
        clipped = a.h < 0.72 * height
        cells[col if col < 2 else 1] = {
            'name': name, 'rawName': raw, 'nameConf': conf,
            'kills': None if clipped else a.kills,
            'killsConf': a.kill_conf,
            'killAlternatives': a.alternatives,
            'clipped': clipped,
            'votes': [[d, round(c, 2), v] for d, c, v in a.votes],
            'boxes': {
                'digits': [round(a.digit_box[0]), round(a.digit_box[1]), round(a.digit_box[2] - a.digit_box[0]), round(a.digit_box[3] - a.digit_box[1])],
                'name': _name_box(chain, a),
            },
        }
        prev_end = a.x1
    return cells


def _name_box(chain, anchor):
    if chain:
        x0 = min(w.x0 for w in chain)
        x1 = max(w.x1 for w in chain)
        y0 = min(w.y0 for w in chain)
        y1 = max(w.y1 for w in chain)
    else:
        x0, x1 = anchor.x0 - 6 * anchor.h, anchor.x0 - 2
        y0, y1 = anchor.digit_box[1], anchor.digit_box[3]
    return [round(x0), round(y0), round(max(1, x1 - x0)), round(max(1, y1 - y0))]
