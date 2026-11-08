"""Lobby reading gate on the labelled room-lobby screenshots in ocr-data/lobby/ (needs the rapidocr package).

Fails if a slot number is wrong or missing, if any read name is not recognisably the labelled player,
or if the three screenshots do not merge into 12 complete slots. Damaged copies (half-size, jpeg-q30,
blur) must still give every slot number right and at least 90% of the names. Skips without the engine.
"""
import io
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
from ocr_engine import available  # noqa: E402

if not available():
    print('SKIP: rapidocr is not installed (pip install -r requirements-docker.txt)')
    sys.exit(0)

from ocr_engine.engine import read_page  # noqa: E402
from ocr_engine.lobby import merge_lobbies, parse_lobby  # noqa: E402
from ocr_engine.roster import similarity  # noqa: E402

CLOSE = 0.75  # a read name this similar to the label identifies the player (same rule family as roster matching)
folder = root / 'ocr-data' / 'lobby'
labels = json.loads((folder / 'labels.json').read_text(encoding='utf-8'))


def degrade(data, kind):
    from PIL import Image, ImageFilter
    im = Image.open(io.BytesIO(data)).convert('RGB')
    if kind == 'half-size':
        im = im.resize((im.width // 2, im.height // 2), Image.BILINEAR)
    elif kind == 'blur':
        im = im.filter(ImageFilter.GaussianBlur(1.2))
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=30 if kind == 'jpeg-q30' else 85)
    return out.getvalue()


def score(kind):
    reads, names, good, problems = [], 0, 0, []
    for name, expected_slots in labels['files'].items():
        data = (folder / name).read_bytes()
        result = parse_lobby(read_page(degrade(data, kind) if kind else data))
        reads.append(result)
        got = [s['slot'] for s in result['slots']]
        if got != expected_slots:
            problems.append(f'{name}: slots {got}, expected {expected_slots}')
        for s in result['slots']:
            truth = labels['slots'].get(str(s['slot']), [])
            for i, label in enumerate(truth):
                names += 1
                read = s['players'][i] if i < len(s['players']) else ''
                if read and similarity(read, label) >= CLOSE:
                    good += 1
                else:
                    problems.append(f'{name}: slot {s["slot"]} player {i + 1} read {read!r}, label {label!r}')
    return reads, names, good, problems


failed = False
reads, names, good, problems = score(None)
merged = merge_lobbies(reads)
complete = sum(1 for s in merged['slots'] if s['complete'])
print(f'original: {good}/{names} names, {complete}/12 complete slots after merging')
if problems or complete != 12 or [s['slot'] for s in merged['slots']] != list(range(1, 13)):
    failed = True
    print('\n'.join('  ' + p for p in problems))
for kind in ('half-size', 'jpeg-q30', 'blur'):
    _, names, good, problems = score(kind)
    slot_errors = [p for p in problems if ': slots ' in p]
    print(f'{kind}: {good}/{names} names, slot numbers {"ok" if not slot_errors else "WRONG"}')
    if slot_errors or good < 0.9 * names:
        failed = True
        print('\n'.join('  ' + p for p in problems))
if failed:
    sys.exit('FAIL: lobby reading regressed on the labelled screenshots')
print('PASS: every slot number and player name read from the lobby screenshots, also on damaged copies.')
