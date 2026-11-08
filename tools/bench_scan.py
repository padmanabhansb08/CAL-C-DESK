"""Benchmark the screenshot reader on the labelled screenshots in ocr-data/: time per stage, and accuracy.

  python tools/bench_scan.py                     warm reads with the current settings (3 runs of every screenshot)
  python tools/bench_scan.py --runs 5 --split held-out
  python tools/bench_scan.py --cold              a fresh process per read: start-up + first read, as after a deploy
  python tools/bench_scan.py --compare           the default and each speed switch side by side, in separate processes
  python tools/bench_scan.py --compare --degrade blur     the same on damaged copies (half-size, upscaled, jpeg-q30, blur)

Accuracy uses the same labels and rules as tools/evaluate_ocr.py. A speed switch is only worth enabling when
--compare shows no new wrong or unresolved kill counts and no team mistakes. The labelled set is small (10
screenshots, one style), so "no change" here is evidence, not proof; see the README before trusting it further.
"""
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

VARIANTS = [
    ('default', {}),
    ('no-cls', {'OCR_USE_CLS': '0'}),
    ('cascade', {'OCR_DIGIT_MODE': 'cascade'}),
    ('page-trust', {'OCR_DIGIT_MODE': 'page-trust'}),
    ('cascade+no-cls', {'OCR_DIGIT_MODE': 'cascade', 'OCR_USE_CLS': '0'}),
    ('det960', {'OCR_DET_SIZE': '960'}),
    ('det960+rec-tiny', {'OCR_DET_SIZE': '960', 'OCR_REC_MODEL': 'tiny'}),
    ('det960+det-tiny', {'OCR_DET_SIZE': '960', 'OCR_DET_MODEL': 'tiny'}),
    ('det-tiny', {'OCR_DET_MODEL': 'tiny'}),
    ('det1280+det-tiny', {'OCR_DET_SIZE': '1280', 'OCR_DET_MODEL': 'tiny'}),
    ('all-tiny', {'OCR_DET_SIZE': '960', 'OCR_DET_MODEL': 'tiny', 'OCR_REC_MODEL': 'tiny'}),
    ('det-small', {'OCR_DET_MODEL': 'small'}),
    ('rec-medium', {'OCR_REC_MODEL': 'medium'}),
    ('det-small+rec-medium', {'OCR_DET_MODEL': 'small', 'OCR_REC_MODEL': 'medium'}),
    ('det-medium+rec-medium', {'OCR_DET_MODEL': 'medium', 'OCR_REC_MODEL': 'medium'}),
    ('ort-threads', {'OCR_THREADS': '0'}),
    ('threads-1', {'OCR_THREADS': '1'}),
    ('threads-2', {'OCR_THREADS': '2'}),
    ('threads-4', {'OCR_THREADS': '4'}),
    ('threads-8', {'OCR_THREADS': '8'}),
]


def percentile(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))] if ordered else 0.0


def measure(runs, split, degrade=None):
    """Read every labelled screenshot `runs` times (after one untimed warm-up read) and score the last read.

    degrade: re-encode each screenshot the way damaged uploads are (half-size, upscaled, jpeg-q30, blur)."""
    import ocr_engine
    from ocr_engine import tuning
    import evaluate_ocr as ev

    labels = json.loads((ROOT / 'ocr-data' / 'labels.json').read_text())
    frames = json.loads((ROOT / 'ocr-data' / 'team-labels.json').read_text())['frames']
    roster = ev.default_roster()
    jobs = [(match, key) for match in labels['matches'] if not split or match['split'] == split for key in match['files']]
    load = lambda key: ev.degrade(ev.image_path(key).read_bytes(), degrade) if degrade else ev.image_path(key).read_bytes()
    ocr_engine.scan(load(jobs[0][1]), roster)  # warm-up: models and caches, not timed

    walls, stages, calls = [], {}, {}
    fields = {'correct': 0, 'wrong': 0, 'unresolved': 0}
    teams = {'correct': 0, 'wrong': 0, 'unmatched': 0}
    readings = {}
    # What the desk would approve without the host (public/app.js rowStatus 'ready'): a named team, all four
    # kill counts read with confidence >= 0.7 and no flags. "auto_wrong" is the number that must stay 0.
    auto = {'panels': 0, 'approved': 0, 'approved_wrong': 0, 'approved_team_wrong': 0}
    for match, key in jobs:
        data = load(key)
        for run in range(runs):
            started = time.perf_counter()
            result = ocr_engine.scan(data, roster)
            walls.append(time.perf_counter() - started)
            for name, info in (result.get('timing') or {}).get('stages', {}).items():
                stages.setdefault(name, []).append(info['ms'] / 1000)
                calls[name] = info['calls']
        for panel in result['panels']:  # accuracy of the last run; reads are deterministic
            place = panel['placement']
            truth = frames.get(key, {}).get(str(place))
            if truth:
                got = (panel.get('team') or {}).get('id')
                if not got:
                    teams['unmatched'] += 1
                elif got.upper().startswith(truth.upper().replace(' ', '')[:4]) or truth.upper().startswith(got.upper()[:4]):
                    teams['correct'] += 1
                else:
                    teams['wrong'] += 1
            if not place or place > 12:
                continue
            auto['panels'] += 1
            cells = panel['cells']
            if (panel.get('team') or {}).get('id') and not panel.get('flags') and all(
                    c is not None and c['kills'] is not None and c['killsConf'] >= 0.7 for c in cells):
                auto['approved'] += 1
                bad = [(i, c['kills'], match['kills'][place - 1][i], c['killsConf'], [(v[0], round(v[1], 2), v[2]) for v in c.get('votes', [])])
                       for i, c in enumerate(cells) if c['kills'] != match['kills'][place - 1][i]]
                if bad:
                    auto['approved_wrong'] += 1
                    auto.setdefault('wrong_detail', []).append({'frame': key, 'placement': place, 'cells': bad})
                if truth and not (got.upper().startswith(truth.upper().replace(' ', '')[:4]) or truth.upper().startswith(got.upper()[:4])):
                    auto['approved_team_wrong'] += 1
            for index, cell in enumerate(panel['cells']):
                if cell is None:
                    continue
                expected = match['kills'][place - 1][index]
                readings[f'{key}:{place}:{index}'] = cell['kills']
                if cell['kills'] is None:
                    fields['unresolved'] += 1
                elif cell['kills'] == expected:
                    fields['correct'] += 1
                else:
                    fields['wrong'] += 1
    return {'settings': tuning.describe(), 'reads': len(walls), 'wall_median': statistics.median(walls), 'wall_p95': percentile(walls, .95),
            'wall_mean': statistics.mean(walls), 'stages': {k: statistics.median(v) for k, v in stages.items()}, 'calls': calls,
            'fields': fields, 'teams': teams, 'auto': auto, 'readings': readings}


def cold_child():
    """One fresh process: import, build the engine and read one screenshot, reporting each part."""
    started = time.perf_counter()
    import ocr_engine
    from ocr_engine import engine
    import evaluate_ocr as ev
    imported = time.perf_counter() - started
    began = time.perf_counter()
    engine._get_engine()
    loaded = time.perf_counter() - began
    began = time.perf_counter()
    ocr_engine.scan(ev.image_path('21').read_bytes(), ev.default_roster())
    print(json.dumps({'import': imported, 'engine_init': loaded, 'first_read': time.perf_counter() - began}))


def run_child(extra, env_extra):
    env = {**os.environ, **env_extra, 'PYTHONIOENCODING': 'utf-8'}
    done = subprocess.run([sys.executable, '-I', str(Path(__file__).resolve()), *extra], capture_output=True, text=True, env=env, cwd=ROOT)
    lines = [line for line in done.stdout.splitlines() if line.startswith('{')]
    if done.returncode or not lines:
        raise SystemExit('benchmark child failed:\n' + (done.stderr or done.stdout)[-1500:])
    return json.loads(lines[-1])


def show(result):
    f, t = result['fields'], result['teams']
    total = f['correct'] + f['wrong'] + f['unresolved']
    print(f"settings: {result['settings']}")
    print(f"{result['reads']} reads | median {result['wall_median']:.1f}s | mean {result['wall_mean']:.1f}s | p95 {result['wall_p95']:.1f}s")
    for name, seconds in sorted(result['stages'].items(), key=lambda kv: -kv[1]):
        print(f"  {name:18s} {seconds:6.2f}s  ({result['calls'][name]} calls)")
    print(f"kill counts: {f['correct']}/{total} correct | {f['wrong']} wrong | {f['unresolved']} unresolved")
    print(f"teams: {t['correct']} correct | {t['wrong']} wrong | {t['unmatched']} unmatched")
    a = result['auto']
    print(f"auto-approved without the host: {a['approved']}/{a['panels']} panels | with a wrong kill count: {a['approved_wrong']} | with a wrong team: {a['approved_team_wrong']}")
    for item in a.get('wrong_detail', []):
        for index, read, expected, conf, votes in item['cells']:
            print(f"  WRONG AND APPROVED: frame {item['frame']} placement {item['placement']} player {index + 1}: read {read}, label {expected}, confidence {conf}, votes {votes}")


def main():
    args = sys.argv[1:]
    value = lambda flag, default=None: args[args.index(flag) + 1] if flag in args else default
    runs, split, degrade = int(value('--runs', 3)), value('--split'), value('--degrade')
    if '--cold-child' in args:
        return cold_child()
    if '--json' in args:
        print(json.dumps(measure(runs, split, degrade)))
        return
    if '--cold' in args:
        n = int(value('--cold-runs', 3))
        rows = [run_child(['--cold-child'], {}) for _ in range(n)]
        for i, r in enumerate(rows, 1):
            print(f"cold {i}: import {r['import']:.1f}s + engine {r['engine_init']:.1f}s + first read {r['first_read']:.1f}s = {sum(r.values()):.1f}s")
        return
    if '--compare' in args:
        extra = ['--json', '--runs', str(runs)] + (['--split', split] if split else []) + (['--degrade', degrade] if degrade else [])
        print(f'condition: {degrade or "original screenshots"}')
        results = []
        only = value('--only')
        for name, env in VARIANTS:
            if only and name not in only.split(',') and name != 'default':
                continue
            print(f'running {name} ...', flush=True)
            results.append((name, run_child(extra, env)))
        base = results[0][1]
        print(f"\n{'variant':16s} {'median':>7s} {'p95':>6s} {'detect':>7s} {'digits':>7s} {'kills ok/wrong/unres':>21s} {'teams ok/wrong':>14s} {'auto-approved':>14s} {'AUTO WRONG':>10s} {'changed':>8s}")
        for name, r in results:
            s, c = r['stages'], r['calls']
            digits = s.get('digit_label_rec', 0) + s.get('digit_iso_rec', 0)
            f, t, a = r['fields'], r['teams'], r['auto']
            changed = sum(1 for k, v in r['readings'].items() if base['readings'].get(k) != v)
            wrong = f"{a['approved_wrong']}" + (f" (+{a['approved_team_wrong']} team)" if a['approved_team_wrong'] else '')
            print(f"{name:16s} {r['wall_median']:6.1f}s {r['wall_p95']:5.1f}s {s.get('detect_recognize', 0):6.2f}s {digits:6.2f}s {f['correct']:>9d}/{f['wrong']}/{f['unresolved']:<8d} {t['correct']:>7d}/{t['wrong']:<6d} {a['approved']:>6d}/{a['panels']:<7d} {wrong:>10s} {changed:>8d}")
        return
    show(measure(runs, split, degrade))


if __name__ == '__main__':
    main()
