"""Run a few screenshot reads at a time (one per reader process), with a wait limit and a hard time limit.

The OCR engine is CPU-heavy (about 400 MB and several seconds per screenshot), so the number of reader
processes follows the CPUs the server really has (see ocr_engine/tuning.py). Reads queue up briefly
and are refused with a clear "busy" answer if the queue does not clear.

With isolate=True (what the server uses) the reader runs in its own worker process. A read that
passes the time limit is stopped for real: the process is ended, the queue is free again at once,
and the next read starts a fresh worker. Without isolation (tests, or SCAN_ISOLATE=0) the read runs on a
thread; a thread cannot be stopped, so a timed-out read keeps the queue until it finishes.
"""
import multiprocessing
import threading
import time


class Busy(Exception):
    pass


class TimedOut(Exception):
    pass


STARTUP_SECONDS = 60
_ERRORS = {'ValueError': ValueError, 'KeyError': KeyError, 'TypeError': TypeError}


def _serve(conn):
    """Worker loop: receive (function, args, kwargs), send back (ok, result or error)."""
    conn.send('ready')
    while True:
        try:
            fn, args, kwargs = conn.recv()
        except (EOFError, OSError):
            return
        try:
            reply = (True, fn(*args, **kwargs))
        except BaseException as error:  # reported to the caller, the worker stays up
            reply = (False, (type(error).__name__, str(error)))
        try:
            conn.send(reply)
        except Exception:
            return


class _Worker:
    def __init__(self):
        self.process = None
        self.conn = None

    def _start(self):
        context = multiprocessing.get_context('spawn')  # same behaviour on Windows, macOS and Linux
        parent, child = context.Pipe()
        process = context.Process(target=_serve, args=(child,), daemon=True, name='ffk-screenshot-reader')
        process.start()
        child.close()
        self.process, self.conn = process, parent
        # Starting a worker (a fresh Python) is not part of a read's time limit.
        if not parent.poll(STARTUP_SECONDS) or parent.recv() != 'ready':
            self.stop()
            raise RuntimeError('The screenshot reader could not start.')

    def stop(self):
        if self.process is not None:
            self.process.kill()
            self.process.join(5)
        if self.conn is not None:
            self.conn.close()
        self.process = self.conn = None

    def call(self, fn, args, kwargs, timeout):
        self.start_seconds = 0.0  # time spent launching a fresh worker for this call (0 when it was already running)
        if self.process is None or not self.process.is_alive():
            began = time.perf_counter()
            self.stop()
            self._start()
            self.start_seconds = time.perf_counter() - began
        self.conn.send((fn, args, kwargs))
        if not self.conn.poll(timeout):
            self.stop()
            raise TimedOut()
        try:
            ok, payload = self.conn.recv()
        except (EOFError, OSError):
            self.stop()
            raise RuntimeError('The screenshot reader stopped unexpectedly; try again.')
        if ok:
            return payload
        name, message = payload
        raise _ERRORS.get(name, RuntimeError)(message)


class ScanGate:
    """`workers` reader processes (isolate=True only; a thread-run read is always one at a time)."""

    def __init__(self, wait_seconds=25.0, run_seconds=120.0, isolate=False, workers=1):
        self.workers = max(1, workers) if isolate else 1
        self._gate = threading.Semaphore(self.workers)
        self.wait_seconds = wait_seconds
        self.run_seconds = run_seconds
        self.isolate = isolate
        self._free = [_Worker() for _ in range(self.workers)] if isolate else []
        self._lock = threading.Lock()
        self._local = threading.local()

    def last(self):
        """Queue wait and worker start time of this thread's most recent run(), in seconds."""
        return {'queue': getattr(self._local, 'queue', 0.0), 'worker_start': getattr(self._local, 'worker_start', 0.0)}

    def busy(self):
        if self._gate.acquire(blocking=False):
            self._gate.release()
            return False
        return True

    def run(self, fn, *args, **kwargs):
        queued = time.perf_counter()
        if not self._gate.acquire(timeout=self.wait_seconds):
            raise Busy()
        self._local.queue, self._local.worker_start = time.perf_counter() - queued, 0.0
        if self.isolate:
            with self._lock:
                worker = self._free.pop()
            try:
                return worker.call(fn, args, kwargs, self.run_seconds)
            finally:
                self._local.worker_start = worker.start_seconds
                with self._lock:
                    self._free.append(worker)
                self._gate.release()
        box = {}

        def work():
            try:
                box['value'] = fn(*args, **kwargs)
            except BaseException as error:  # handed back to the caller
                box['error'] = error
            finally:
                self._gate.release()

        thread = threading.Thread(target=work, daemon=True, name='scan')
        thread.start()
        thread.join(self.run_seconds)
        if thread.is_alive():
            raise TimedOut()
        if 'error' in box:
            raise box['error']
        return box['value']

    def close(self):
        for worker in self._free:
            worker.stop()


# Small top-level functions the isolation checks run in the worker process.
def _sleep(seconds):
    import time
    time.sleep(seconds)
    return 'slept'


def _fail(message):
    raise ValueError(message)
