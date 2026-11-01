"""Per-read stage timings, so a slow screenshot can be explained instead of guessed at.

scan() starts a recording, the engine wraps its stages in `stage(...)`, and the finished numbers travel
back in the scan result as `timing`. Outside a recording every call is a no-op, so the cost is negligible.
A read runs one at a time (see ffk_core/scan_gate.py), so one module-level recording is enough.
"""
import time
from contextlib import contextmanager

_current = None


class _Recording:
    def __init__(self):
        self.started = time.perf_counter()
        self.seconds = {}
        self.calls = {}

    def add(self, name, seconds, calls=1):
        self.seconds[name] = self.seconds.get(name, 0.0) + seconds
        self.calls[name] = self.calls.get(name, 0) + calls


def begin():
    global _current
    _current = _Recording()


@contextmanager
def stage(name, calls=1):
    if _current is None:
        yield
        return
    recording, started = _current, time.perf_counter()
    try:
        yield
    finally:
        recording.add(name, time.perf_counter() - started, calls)


def finish():
    """Return {'total': ms, 'stages': {name: {'ms': ..., 'calls': ...}}} and stop recording."""
    global _current
    recording, _current = _current, None
    if recording is None:
        return None
    return {
        'total': round((time.perf_counter() - recording.started) * 1000, 1),
        'stages': {name: {'ms': round(seconds * 1000, 1), 'calls': recording.calls[name]}
                   for name, seconds in recording.seconds.items()},
    }
