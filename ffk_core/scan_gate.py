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


STARTUP_SECONDS = 180  # a fresh worker also loads the models (and on a new install may download one)
_ERRORS = {'ValueError': ValueError, 'KeyError': KeyError, 'TypeError': TypeError}


def _serve(conn, warm=None):
    """Worker loop: receive (function, args, kwargs), send back (ok, result or error).

    `warm` (a top-level function) runs before the worker reports ready: loading the models and one tiny read
    happen here, while nobody is waiting, instead of inside the first real screenshot."""
    if warm is not None:
        try:
            warm()
        except Exception:  # a failed warm-up only means the first real read loads the models itself
            pass
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
    def __init__(self, warm=None):
        self.process = None
        self.conn = None
        self.warm = warm
        self.start_seconds = 0.0
        self._starting = threading.Lock()

    def ensure_started(self):
        """Start (and warm) the worker process unless it is already running. Returns the seconds spent."""
        with self._starting:
            if self.process is not None and self.process.is_alive():
                return 0.0
            began = time.perf_counter()
            self.stop()
            self._start()
            return time.perf_counter() - began

    def warm_in_background(self):
        def start():
            try:
                self.ensure_started()
            except Exception:
                pass  # the next read tries again and reports the failure
        threading.Thread(target=start, daemon=True, name='ffk-reader-warmup').start()

    def _start(self):
        context = multiprocessing.get_context('spawn')  # same behaviour on Windows, macOS and Linux
        parent, child = context.Pipe()
        process = context.Process(target=_serve, args=(child, self.warm), daemon=True, name='ffk-screenshot-reader')
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
        # Time spent launching (or waiting for a warm-up of) a fresh worker for this call; 0 when it was ready.
        self.start_seconds = self.ensure_started()
        self.conn.send((fn, args, kwargs))
        if not self.conn.poll(timeout):
            self.stop()
            self.warm_in_background()  # the replacement loads its models now, not during the next read
            raise TimedOut()
        try:
            ok, payload = self.conn.recv()
        except (EOFError, OSError):
            self.stop()
            self.warm_in_background()
            raise RuntimeError('The screenshot reader stopped unexpectedly; try again.')
        if ok:
            return payload
        name, message = payload
        raise _ERRORS.get(name, RuntimeError)(message)


class ScanGate:
    """`workers` reader processes (isolate=True only; a thread-run read is always one at a time)."""

    def __init__(self, wait_seconds=25.0, run_seconds=120.0, isolate=False, workers=1, warm=None):
        self.workers = max(1, workers) if isolate else 1
        self._gate = threading.Semaphore(self.workers)
        self.wait_seconds = wait_seconds
        self.run_seconds = run_seconds
        self.isolate = isolate
        self._free = [_Worker(warm) for _ in range(self.workers)] if isolate else []
        self._lock = threading.Lock()
        self._local = threading.local()
        self._warm = warm

    def prewarm(self):
        """Start every reader now, in the background, so the first screenshot does not wait for start-up.

        Without isolation the warm-up runs once on a background thread in this process."""
        if self.isolate:
            for worker in list(self._free):
                worker.warm_in_background()
        elif self._warm is not None:
            threading.Thread(target=self._warm, daemon=True, name='ffk-reader-warmup').start()

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


def warm_reader():
    """Warm-up for the screenshot reader, imported inside the worker so the server itself stays light."""
    import ocr_engine
    if ocr_engine.available():
        ocr_engine.warm()


# Small top-level functions the isolation checks run in the worker process.
def _sleep(seconds):
    import time
    time.sleep(seconds)
    return 'slept'


def _fail(message):
    raise ValueError(message)
