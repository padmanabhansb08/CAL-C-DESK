"""Back up or restore the War Desk database.

  python tools/backup.py                    write a backup now (to <db folder>/backups, or BACKUP_DIR)
  python tools/backup.py --list             show existing backups
  python tools/backup.py --restore FILE     restore FILE (stop the server first; the current database is kept)
DB_PATH selects the database (default: war.sqlite3 next to server.py).
"""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
from ffk_core import backup  # noqa: E402

db = Path(os.environ.get('DB_PATH', root / 'war.sqlite3'))
args = sys.argv[1:]
if args[:1] == ['--list']:
    for f in backup.list_backups(backup.backup_dir(db)):
        print(f, f.stat().st_size, 'bytes')
elif args[:1] == ['--restore'] and len(args) == 2:
    saved = backup.restore(args[1], db)
    print('Restored.' + (f' The previous database was kept as {saved}.' if saved else ''))
else:
    print(backup.make_backup(db) if db.exists() else f'No database at {db}')
