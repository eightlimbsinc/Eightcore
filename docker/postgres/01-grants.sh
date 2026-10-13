#!/bin/sh
# Grants that must run inside the eightcore database.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname eightcore -f /docker-entrypoint-initdb.d/sql/grants.sql
