#!/usr/bin/env bash
# Read-only service and socket inventory for Neural Core. Requires no sudo.
set -euo pipefail
export LC_ALL=C

section() { printf '\n== %s ==\n' "$1"; }

section "Target services and their real state"
if command -v systemctl >/dev/null 2>&1; then
  for unit in \
    minecraft@plexoncraft.service \
    minecraft@tonimsmp.service \
    plexonpanel-host@plexoncraft.service \
    plexonpanel-host@tonimsmp.service \
    plexonpanel-relay.service \
    caddy.service \
    postgresql.service \
    'postgresql@*.service' \
    neural-core-api.service \
    neural-core-postgres.service; do
      printf '%-45s ' "$unit"
      if [[ "$unit" == *\*\.* ]]; then
        systemctl list-units --all --plain --no-legend --no-pager "$unit" 2>/dev/null \
          | awk '{print $1, $3, $4}' || true
      else
        systemctl show "$unit" --no-pager \
          --property=LoadState,ActiveState,SubState,MainPID 2>/dev/null \
          | tr '\n' ' '
        echo
      fi
  done
fi

section "TCP listening addresses (no processes, command arguments, credentials)"
if command -v ss >/dev/null 2>&1; then
  ss -H -ltn | awk '{print $4}' | sort -u || true
else
  echo 'ss not installed'
fi

section "Existing PostgreSQL clusters if pg_lsclusters is installed"
if command -v pg_lsclusters >/dev/null 2>&1; then
  pg_lsclusters
else
  echo 'pg_lsclusters unavailable; not proof that PostgreSQL is absent'
fi

section "Memory and CPU pressure"
awk '/^(MemTotal|MemAvailable|SwapTotal):/ {printf "%-18s %.0f MiB\n", $1, $2 / 1024}' /proc/meminfo || true
for f in /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io; do
  if [[ -r "$f" ]]; then printf '%s: ' "$f"; head -n 1 "$f"; fi
done

section "Filesystem usage"
df -hP / || true

printf '\nDone. Read-only inventory; no services, network settings, files or permissions modified.\n'
