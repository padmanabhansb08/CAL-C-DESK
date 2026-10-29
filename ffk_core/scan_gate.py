"""Run at most one screenshot read at a time, with a wait limit and a hard time limit.

The OCR engine is CPU-heavy (about 400 MB and several seconds per screenshot). Reads queue up briefly
and are refused with a clear "busy" answer if the queue does not clear.

With isolate=True (what the server uses) the reader runs in its own worker process. A read that
passes the time limit is stopped for real: the process is ended, the queue is free again at once,
and the next read starts a fresh worker. Without isolation (tests, or SCAN_ISOLATE=0) the read runs on a
thread; a thread cannot be stopped, so a timed-out read keeps the queue until it finishes.
"""
import multiprocessing
import threading


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
        if self.process is None or not self.process.is_alive():
            self.stop()
            self._start()
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
    def __init__(self, wait_seconds=25.0, run_seconds=120.0, isolate=False):
        self._gate = threading.Semaphore(1)
        self.wait_seconds = wait_seconds
        self.run_seconds = run_seconds
        self.isolate = isolate
        self._worker = _Worker() if isolate else None

    def busy(self):
        if self._gate.acquire(blocking=False):
            self._gate.release()
            return False
        return True

    def run(self, fn, *args, **kwargs):
        if not self._gate.acquire(timeout=self.wait_seconds):
            raise Busy()
        if self.isolate:
            try:
                return self._worker.call(fn, args, kwargs, self.run_seconds)
            finally:
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
        if self._worker:
            self._worker.stop()


# Small top-level functions the isolation checks run in the worker process.
def _sleep(seconds):
    import time
    time.sleep(seconds)
    return 'slept'


def _fail(message):
    raise ValueError(message)
