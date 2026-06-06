#!/bin/sh
set -e

mkdir -p "$(dirname "$DB_PATH")"

if [ -n "$REPLICA_URL" ]; then
  # GCS のレプリカから DB を復元（DB が無く、レプリカが存在する場合のみ）
  litestream restore -if-db-not-exists -if-replica-exists "$DB_PATH"
  # レプリケートしながらアプリを起動
  exec litestream replicate -exec "node dist/app.js"
else
  # ローカル開発など、レプリカなしで起動
  exec node dist/app.js
fi
