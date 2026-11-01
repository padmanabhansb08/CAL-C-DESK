"""Scoreboard OCR: real text recognition plus geometric and roster reasoning."""
from . import timing
from .engine import available, read_page
from .scoreboard import parse_scoreboard
from .roster import match_rosters
from .verify import verify_rows


def _clip(page, regions):
    """Keep only words inside the organizer's chosen regions (original-pixel rectangles)."""
    boxes = []
    for r in regions or []:
        try:
            x, y, w, h = (float(r[k]) * page.scale for k in ('x', 'y', 'width', 'height'))
        except (KeyError, TypeError, ValueError):
            continue
        if w > 0 and h > 0:
            boxes.append((x, y, x + w, y + h))
    if boxes:
        page.words = [w for w in page.words if any(b[0] <= w.cx <= b[2] and b[1] <= w.cy <= b[3] for b in boxes)]


def scan(image_bytes, roster=None, regions=None):
    """Read one screenshot and return structured, reasoned rows (JSON-serialisable).

    result['timing'] says where the time went: milliseconds and call counts per stage."""
    timing.begin()
    try:
        page = read_page(image_bytes)
        _clip(page, regions)
        with timing.stage('parse'):  # includes read_kills, which is also listed on its own
            result = parse_scoreboard(page)
        if roster:
            with timing.stage('roster'):
                match_rosters(result, roster)
        with timing.stage('verify'):
            verify_rows(result)
    finally:
        report = timing.finish()
    result['timing'] = report
    return result
