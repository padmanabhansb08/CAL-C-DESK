#!/bin/sh
# Container start. Hosts such as Railway mount the data volume owned by root, while the desk runs as the
# unprivileged "app" user, which then could not write its database. Starting as root, this makes the database
# folder the app's, then drops to "app" for the server itself. Started as any other user, it just runs the server.
set -e
if [ "$(id -u)" = "0" ]; then
  dir="$(dirname "${DB_PATH:-/data/war.sqlite3}")"
  mkdir -p "$dir"
  chown -R app:app "$dir" || echo "warning: could not take ownership of $dir" >&2
  exec gosu app "$@"
fi
exec "$@"
