#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--confirm" || -z "${2:-}" ]]; then
  printf 'Usage: DATABASE_URL=... STORAGE_ROOT=... %s --confirm /absolute/path/to/backup\n' "$0" >&2
  exit 2
fi

source_dir="$2"
database_url="${DATABASE_URL:?DATABASE_URL is required}"
storage_root="${STORAGE_ROOT:?STORAGE_ROOT is required}"

if [[ "$source_dir" != /* || ! -f "$source_dir/database.dump" ]]; then
  printf 'Backup must be an absolute directory containing database.dump\n' >&2
  exit 2
fi
if [[ "$storage_root" == "/" || "$storage_root" == "$HOME" || "$storage_root" != /* ]]; then
  printf 'STORAGE_ROOT must be an explicit absolute application storage path\n' >&2
  exit 2
fi

pg_restore --clean --if-exists --no-owner --no-acl --dbname "$database_url" "$source_dir/database.dump"
if [[ -f "$source_dir/storage.tar.gz" ]]; then
  if tar -tzf "$source_dir/storage.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    printf 'Storage archive contains unsafe paths\n' >&2
    exit 2
  fi
  mkdir -p "$storage_root"
  tar -C "$storage_root" -xzf "$source_dir/storage.tar.gz"
fi
printf 'Restore complete from: %s\n' "$source_dir"
