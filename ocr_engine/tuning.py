"""Speed/accuracy switches for the reader, read from the environment once per process.

Apart from the thread count below, every default reproduces the reader's long-standing behaviour. A faster
setting is only worth turning on after tools/bench_scan.py shows, on the labelled screenshots, that it is as
accurate as the default.

SCAN_WORKERS     unset (default): reader processes by CPU count (1 below 4 CPUs, 2 from 4, 3 from 12; 1 when
                 SCAN_ISOLATE=0). The browser reads that many screenshots of a match at the same time. Each
                 reader holds about 400 MB. A number (1-6) sets it.
OCR_USE_CLS      1 (default) runs the text-angle classifier on every detected line; 0 skips it.
OCR_THREADS      unset (default): this reader's share of the CPUs the server can really use (a container's
                 quota, not the host's core count), at most 4. A number sets it; 0 or "default" leaves ONNX Runtime to size its own
                 pool, which on a busy or CPU-limited host was measured 3x slower (more threads than the CPU
                 can run make every step wait for the slowest one).
OCR_DIGIT_MODE   full (default): every kill count is read three independent ways (page line, label
                 re-read, isolated-digit re-read) before it can be settled.
                 cascade: stop after the page line and the label re-read when those two agree strongly.
                 page-trust: accept the page-line reading alone when its confidence is at least
                 OCR_PAGE_TRUST (default 0.99); otherwise fall back to the full set of reads.
"""
import os


def _flag(name, default):
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() not in ('0', 'false', 'no', '')


def _read_number(path):
    try:
        with open(path) as handle:
            return handle.read().split()
    except OSError:
        return []


def usable_cpus():
    """CPUs this process can really use: the container's quota when it has one, else its core count.

    Inside a container os.cpu_count() reports the HOST's cores, so a library that sizes its thread pool from it
    starts far more threads than the container's CPU share can run."""
    cpus = os.cpu_count() or 1
    try:
        cpus = min(cpus, len(os.sched_getaffinity(0)))
    except AttributeError:
        pass
    try:
        quota = _read_number('/sys/fs/cgroup/cpu.max')  # cgroup v2: "<quota|max> <period>"
        if len(quota) == 2 and quota[0] != 'max':
            cpus = min(cpus, max(1, -(-int(quota[0]) // int(quota[1]))))
        else:
            old = _read_number('/sys/fs/cgroup/cpu/cpu.cfs_quota_us')  # cgroup v1
            period = _read_number('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
            if old and period and int(old[0]) > 0:
                cpus = min(cpus, max(1, -(-int(old[0]) // int(period[0]))))
    except ValueError:
        pass
    return max(1, cpus)


MAX_AUTO_THREADS = 4
USE_CLS = _flag('OCR_USE_CLS', True)


def _auto_workers(cpus):
    # A match is usually two screenshots (up to six). Measured: one read takes 17.6 s on 2 threads and 11.5 s on 4
    # (threads scale poorly), so two readers sharing 4 CPUs finish a pair sooner than one reader on all 4.
    if not _flag('SCAN_ISOLATE', True):
        return 1
    return 3 if cpus >= 12 else 2 if cpus >= 4 else 1


_workers = os.environ.get('SCAN_WORKERS', '').strip()
WORKERS = max(1, min(6, int(_workers))) if _workers.isdigit() else _auto_workers(usable_cpus())
# 0 = leave ONNX Runtime's own choice; unset = this reader's share of the CPUs we can really use, at most MAX_AUTO_THREADS.
_threads = os.environ.get('OCR_THREADS', '').strip().lower()
THREADS = 0 if _threads in ('0', 'default') else int(_threads) if _threads.isdigit() else min(MAX_AUTO_THREADS, max(1, usable_cpus() // WORKERS))
DIGIT_MODE = os.environ.get('OCR_DIGIT_MODE', 'full').strip().lower()
if DIGIT_MODE not in ('full', 'cascade', 'page-trust'):
    DIGIT_MODE = 'full'
PAGE_TRUST = float(os.environ.get('OCR_PAGE_TRUST', '0.99'))


def describe():
    return (f'workers={WORKERS} use_cls={int(USE_CLS)} digit_mode={DIGIT_MODE} threads={THREADS or "default"}'
            + (f' page_trust={PAGE_TRUST}' if DIGIT_MODE == 'page-trust' else ''))
