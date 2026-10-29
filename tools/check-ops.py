"""Check the operational safety nets: one-at-a-time screenshot reads, and backup / restore."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ffk_core import backup
from ffk_core.scan_gate import ScanGate, Busy, TimedOut


def main():
    global running, peak
    # --- scan gate: reads never overlap, a waiting caller is told "busy", a slow read is cut off
    running, peak, lock = 0, 0, threading.Lock()


    def slow(seconds):
        global running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        time.sleep(seconds)
        with lock:
            running -= 1
        return 'done'


    gate = ScanGate(wait_seconds=5, run_seconds=5)
    out = []
    threads = [threading.Thread(target=lambda: out.append(gate.run(slow, 0.15))) for _ in range(4)]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert out == ['done'] * 4 and peak == 1, (out, peak)

    gate = ScanGate(wait_seconds=0.1, run_seconds=5)
    holder = threading.Thread(target=lambda: gate.run(slow, 0.6)); holder.start(); time.sleep(0.1)
    try:
        gate.run(slow, 0.01); raise AssertionError('second caller should have been refused')
    except Busy:
        pass
    holder.join()

    gate = ScanGate(wait_seconds=0.1, run_seconds=0.2)
    try:
        gate.run(slow, 0.8); raise AssertionError('slow read should time out')
    except TimedOut:
        pass
    try:
        gate.run(slow, 0.01); raise AssertionError('gate is still held by the abandoned read')
    except Busy:
        pass
    time.sleep(0.8)
    assert gate.run(slow, 0.01) == 'done', 'gate frees once the abandoned read really finishes'


    def boom():
        raise ValueError('bad image')


    gate = ScanGate(1, 1)
    try:
        gate.run(boom); raise AssertionError
    except ValueError:
        pass
    assert gate.run(slow, 0.01) == 'done', 'an error releases the gate'

    # --- isolated reader: a stuck read is stopped for real and the queue is free again at once
    from ffk_core import scan_gate as gate_module
    if True:
        isolated = ScanGate(wait_seconds=0.2, run_seconds=1.5, isolate=True)
        try:
            assert isolated.run(gate_module._sleep, 0.01) == 'slept'
            started = time.time()
            try:
                isolated.run(gate_module._sleep, 30); raise AssertionError('a stuck read must time out')
            except TimedOut:
                pass
            assert time.time() - started < 6, 'the timeout must not wait for the stuck read'
            assert not isolated.busy(), 'a stopped read frees the queue immediately'
            assert isolated.run(gate_module._sleep, 0.01) == 'slept', 'the next read starts a fresh worker'
            try:
                isolated.run(gate_module._fail, 'bad image'); raise AssertionError
            except ValueError as error:
                assert 'bad image' in str(error)
        finally:
            isolated.close()


    def state_of(path):
        # Close every connection: Windows cannot delete a database file that is still open.
        con = sqlite3.connect(path)
        try:
            return con.execute("SELECT value FROM settings WHERE key='state'").fetchone()[0]
        finally:
            con.close()


    # --- backups
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        db = folder / 'war.sqlite3'
        con = sqlite3.connect(db)
        con.execute('PRAGMA journal_mode=WAL')
        con.execute('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        con.execute("INSERT INTO settings VALUES ('state','v1')"); con.commit()
        # a backup taken while the database is open and being written is consistent
        first = backup.make_backup(db, now=datetime(2026, 1, 1, tzinfo=timezone.utc))
        assert state_of(first) == 'v1'
        for day in range(2, 8):
            backup.make_backup(db, keep=3, now=datetime(2026, 1, day, tzinfo=timezone.utc))
        kept = backup.list_backups(backup.backup_dir(db))
        assert [p.name for p in kept] == ['war-20260105-000000.sqlite3', 'war-20260106-000000.sqlite3', 'war-20260107-000000.sqlite3'], kept
        assert not list((folder / 'backups').glob('*.partial'))
        assert backup.latest_backup_age(db) is not None

        # restore: bring back an older state, keep what was there, refuse junk
        con.execute("UPDATE settings SET value='v2' WHERE key='state'"); con.commit(); con.close()
        saved = backup.restore(kept[0], db)
        assert state_of(db) == 'v1'
        assert state_of(saved) == 'v2'
        junk = folder / 'junk.sqlite3'; junk.write_bytes(b'not a database' * 50)
        for bad in (junk,):
            try:
                backup.restore(bad, db); raise AssertionError('junk must be refused')
            except (RuntimeError, sqlite3.DatabaseError):
                pass
        other = folder / 'other.sqlite3'; con = sqlite3.connect(other); con.execute('CREATE TABLE x (a)'); con.commit(); con.close()
        try:
            backup.restore(other, db); raise AssertionError('a foreign database must be refused')
        except RuntimeError:
            pass
        assert state_of(db) == 'v1', 'failed restores leave the database alone'
    print('PASS: screenshot reads run one at a time with busy and timeout answers; a stuck isolated read is stopped and the queue freed; backups are consistent, rotated, restorable and refuse bad files.')


if __name__ == '__main__':  # the isolated reader re-imports this file in its worker process
    main()
