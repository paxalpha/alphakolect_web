#!/usr/bin/env bash
# Runs once, when the local compose database volume is first initialised (docker-entrypoint-initdb.d).
# Creates the application roles and per-database privileges from packages/db/sql/bootstrap.
# To re-run it (e.g. after changing passwords in infrastructure/.env), see packages/db/README.md.
set -euo pipefail

psql --no-psqlrc -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$DB_MIGRATOR_PASSWORD" \
  -v app_password="$DB_APP_PASSWORD" \
  -v worker_password="$DB_WORKER_PASSWORD" \
  -v readonly_password="$DB_READONLY_PASSWORD" \
  -f /alphakolect/bootstrap/bootstrap.psql
