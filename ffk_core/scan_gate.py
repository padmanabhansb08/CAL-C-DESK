"""Run at most one screenshot read at a time, with a wait limit and a time limit.

The OCR engine is CPU-heavy (about 400 MB and several seconds per screenshot). Letting every request
start its own read would let a few people stall the whole desk, so reads queue up briefly and are
refused with a clear "busy" answer if the queue does not clear. The gate is held until the read really
finishes, even after a caller has given up on it, so abandoned reads cannot pile up.
"""
import threading


class Busy(Exception):
    pass


class TimedOut(Exception):
    pass


class ScanGate:
    def __init__(self, wait_seconds=25.0, run_seconds=120.0):
        self._gate = threading.Semaphore(1)
        self.wait_seconds = wait_seconds
        self.run_seconds = run_seconds

    def run(self, fn, *args, **kwargs):
        if not self._gate.acquire(timeout=self.wait_seconds):
            raise Busy()
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
