"""Consistent, rotating backups of the SQLite database (safe while the server is running)."""
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

PATTERN = re.compile(r'^war-(\d{8}-\d{6})\.sqlite3$')


def backup_dir(db_path):
    return Path(os.environ.get('BACKUP_DIR') or Path(db_path).parent / 'backups')


def make_backup(db_path, dest_dir=None, keep=None, now=None):
    """Copy the live database with SQLite's online backup API. Returns the new file's path."""
    dest = Path(dest_dir or backup_dir(db_path))
    dest.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.now(timezone.utc)).strftime('%Y%m%d-%H%M%S')
    target = dest / f'war-{stamp}.sqlite3'
    partial = target.with_suffix('.partial')
    source = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=30)
    try:
        copy = sqlite3.connect(partial)
        try:
            source.backup(copy)
        finally:
            copy.close()
    finally:
        source.close()
    check = sqlite3.connect(partial)
    try:
        ok = check.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    finally:
        check.close()
    if not ok:
        partial.unlink(missing_ok=True)
        raise RuntimeError('Backup failed its integrity check and was discarded.')
    os.replace(partial, target)
    rotate(dest, keep if keep is not None else int(os.environ.get('BACKUP_KEEP', '30')))
    return target


def list_backups(dest_dir):
    dest = Path(dest_dir)
    return sorted((p for p in dest.glob('war-*.sqlite3') if PATTERN.match(p.name)), key=lambda p: p.name) if dest.exists() else []


def rotate(dest_dir, keep):
    for old in list_backups(dest_dir)[:-keep] if keep > 0 else []:
        old.unlink(missing_ok=True)


def latest_backup_age(db_path):
    """Seconds since the newest backup, or None if there is none."""
    files = list_backups(backup_dir(db_path))
    return max(0, time.time() - files[-1].stat().st_mtime) if files else None


def restore(backup_file, db_path):
    """Replace the database with a backup after checking it. The current file is kept as *.before-restore."""
    backup_file, db_path = Path(backup_file), Path(db_path)
    check = sqlite3.connect(f'file:{backup_file}?mode=ro', uri=True)
    try:
        if check.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('That backup is damaged and was not restored.')
        if not check.execute("SELECT 1 FROM sqlite_master WHERE name='settings'").fetchone():
            raise RuntimeError('That file is not a War Desk backup.')
    finally:
        check.close()
    saved = None
    if db_path.exists():
        saved = db_path.with_name(db_path.name + '.before-restore')
        os.replace(db_path, saved)
    for extra in ('-wal', '-shm'):
        Path(str(db_path) + extra).unlink(missing_ok=True)
    source = sqlite3.connect(f'file:{backup_file}?mode=ro', uri=True)
    try:
        target = sqlite3.connect(db_path)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()
    return saved


def start_scheduler(db_path, log=print):
    """Back up now and then every BACKUP_HOURS (default 6; 0 turns it off). Returns the thread or None."""
    hours = float(os.environ.get('BACKUP_HOURS', '6'))
    if hours <= 0:
        return None

    def loop():
        while True:
            try:
                if Path(db_path).exists():
                    log('backup written: %s' % make_backup(db_path))
            except Exception as error:
                log('backup FAILED: %s' % error)
            time.sleep(hours * 3600)

    thread = threading.Thread(target=loop, daemon=True, name='backup')
    thread.start()
    return thread
