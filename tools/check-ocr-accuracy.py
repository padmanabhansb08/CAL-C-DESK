"""Accuracy gate on the labelled screenshots in ocr-data/ (needs the rapidocr package).

Fails if any wrong kill count is accepted, if held-out coverage drops below 98%, or if a
registered team is matched to the wrong panel. Skips when the OCR engine is not installed.
"""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
from ocr_engine import available  # noqa: E402

if not available():
    print('SKIP: rapidocr is not installed (pip install -r requirements-docker.txt)')
    sys.exit(0)
out = subprocess.run([sys.executable, str(root / 'tools' / 'evaluate_ocr.py')], capture_output=True, text=True, cwd=root)
text = out.stdout + out.stderr
print('\n'.join(l for l in text.splitlines() if l.startswith(('train', 'held-out', 'teams'))))
import re
for name, line in ((l.split(':')[0], l) for l in text.splitlines() if l.startswith(('train', 'held-out'))):
    wrong = int(re.search(r'wrong (\d+)', line).group(1))
    pct = float(re.search(r'\((\d+(?:\.\d+)?)%\)', line).group(1))
    assert wrong == 0, f'{name}: {wrong} wrong kill counts were accepted'
    assert pct >= 98.0, f'{name}: only {pct}% of kill counts correct'
teams = re.search(r'teams: (\d+) panels \| correct (\d+) \| wrong (\d+)', text)
assert teams and teams.group(3) == '0', 'a team was matched to the wrong panel'
print('PASS: accepted kill counts are all correct and team matching is clean on the labelled screenshots.')
