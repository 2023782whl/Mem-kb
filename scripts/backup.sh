#!/usr/bin/env bash
set -euo pipefail

backup_root="${AITEAM_BACKUP_DIR:-./backups-runtime}"
database_url="${DATABASE_URL:?DATABASE_URL is required}"
storage_root="${STORAGE_ROOT:-./backend/storage}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$backup_root"
backup_root="$(cd "$backup_root" && pwd -P)"
if [[ "$backup_root" == "/" || "$backup_root" == "$HOME" ]]; then
  printf 'AITEAM_BACKUP_DIR must be a dedicated backup directory\n' >&2
  exit 2
fi
destination="${backup_root%/}/${stamp}"
mkdir -p "$destination"
pg_dump --format=custom --no-owner --no-acl --file "$destination/database.dump" "$database_url"
if [[ -d "$storage_root" ]]; then
  resolved_storage="$(cd "$storage_root" && pwd -P)"
  if [[ "$resolved_storage" == "/" || "$resolved_storage" == "$HOME" ]]; then
    printf 'STORAGE_ROOT must be a dedicated application directory\n' >&2
    exit 2
  fi
  tar -C "$resolved_storage" -czf "$destination/storage.tar.gz" .
fi
printf '{"createdAt":"%s","database":"database.dump","storage":"%s"}\n' \
  "$stamp" "$([[ -f "$destination/storage.tar.gz" ]] && printf 'storage.tar.gz' || printf 'not-present')" \
  > "$destination/manifest.json"

find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime +"${AITEAM_BACKUP_RETENTION_DAYS:-14}" -exec rm -rf -- {} +
printf 'Backup created: %s\n' "$destination"
