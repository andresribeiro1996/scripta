#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
PATH="$PWD/bin:$PATH"

fail() {
  echo "start-with-litestream: $1" >&2
  exit 1
}

for name in R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BACKUPS_BUCKET; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || fail "$name is not set, refusing to start without backups"
done

command -v litestream >/dev/null || fail "bin/litestream is missing, run scripts/install-litestream.sh"

databases=$(litestream databases -config litestream.yml | awk 'NR > 1 { print $1 }')

for path in $(env | sed -n 's/^[A-Z_]*_DB_PATH=//p'); do
  echo "$databases" | grep -qxF "$path" || fail "$path is a *_DB_PATH but is not in litestream.yml"
done

restore_dir="${RAILWAY_VOLUME_MOUNT_PATH:-/data}/restore"

if [ -d "$restore_dir" ]; then
  rm -f "$restore_dir"/*-wal "$restore_dir"/*-shm

  for staged in "$restore_dir"/*; do
    [ -e "$staged" ] || continue
    for path in $databases; do
      [ "$(basename "$path")" = "$(basename "$staged")" ] && continue 2
    done
    fail "$staged is not a database in litestream.yml, refusing to roll back"
  done

  for path in $databases; do
    staged="$restore_dir/$(basename "$path")"
    [ -f "$staged" ] || continue
    rm -f "$path" "$path-wal" "$path-shm"
    rm -rf "$(dirname "$path")/.$(basename "$path")-litestream"
    mv "$staged" "$path"
    echo "start-with-litestream: rolled back $path to the staged restore"
  done

  rmdir "$restore_dir"
fi

for path in $databases; do
  litestream restore -config litestream.yml -if-db-not-exists -if-replica-exists "$path"
done

exec litestream replicate -config litestream.yml -exec "node dist/server.js"
