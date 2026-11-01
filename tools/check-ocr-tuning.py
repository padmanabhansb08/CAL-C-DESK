"""Reader thread count: container quotas are respected, overrides work, defaults stay safe."""
import importlib
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ocr_engine import tuning  # noqa: E402


def with_files(files, cpus=32, affinity=None):
    """Run usable_cpus() as if the host had `cpus` cores and these cgroup files existed."""
    saved = (tuning._read_number, os.cpu_count, getattr(os, 'sched_getaffinity', None))
    tuning._read_number = lambda path: files.get(path, '').split()
    os.cpu_count = lambda: cpus
    if affinity is not None:
        os.sched_getaffinity = lambda pid: set(range(affinity))
    elif hasattr(os, 'sched_getaffinity'):
        os.sched_getaffinity = lambda pid: set(range(cpus))
    try:
        return tuning.usable_cpus()
    finally:
        tuning._read_number, os.cpu_count = saved[0], saved[1]
        if saved[2] is not None:
            os.sched_getaffinity = saved[2]
        elif hasattr(os, 'sched_getaffinity'):
            del os.sched_getaffinity


assert with_files({}) == 32, 'no limit: the host core count'
assert with_files({'/sys/fs/cgroup/cpu.max': 'max 100000'}) == 32, 'cgroup v2 without a quota'
assert with_files({'/sys/fs/cgroup/cpu.max': '200000 100000'}) == 2, 'cgroup v2: 2 CPUs of quota on a 32-core host'
assert with_files({'/sys/fs/cgroup/cpu.max': '150000 100000'}) == 2, 'a fractional quota rounds up'
assert with_files({'/sys/fs/cgroup/cpu.max': '50000 100000'}) == 1, 'half a CPU is one thread, never zero'
assert with_files({'/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '300000', '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000'}) == 3, 'cgroup v1'
assert with_files({'/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '-1', '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000'}) == 32, 'cgroup v1 without a quota'
assert with_files({'/sys/fs/cgroup/cpu.max': 'garbage'}) == 32, 'unreadable limits are ignored'
assert with_files({}, cpus=1) == 1


def reloaded(value, cpus_available=None):
    """tuning.THREADS as it would be computed at process start with OCR_THREADS=value."""
    old = os.environ.get('OCR_THREADS')
    if value is None:
        os.environ.pop('OCR_THREADS', None)
    else:
        os.environ['OCR_THREADS'] = value
    try:
        return importlib.reload(tuning).THREADS
    finally:
        if old is None:
            os.environ.pop('OCR_THREADS', None)
        else:
            os.environ['OCR_THREADS'] = old
        importlib.reload(tuning)


assert reloaded('0') == 0 and reloaded('default') == 0, 'explicit opt-out leaves ONNX Runtime to decide'
assert reloaded('3') == 3 and reloaded('8') == 8, 'an explicit number is used as given'
auto = reloaded(None)
assert 1 <= auto <= tuning.MAX_AUTO_THREADS, f'auto is capped ({auto})'
assert reloaded('nonsense') == auto, 'an unreadable value falls back to the automatic choice'
print('PASS: container CPU quotas (cgroup v1 and v2) limit the reader threads, explicit overrides and the opt-out work, automatic choice is capped.')
